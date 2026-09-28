/**
 * @file Loading a project: its config, its Python sources under their module names,
 * and a check run over them. The engine does no I/O (ADR-006), so all file
 * reading happens here, through the injected `ProjectIo`: paths are probed,
 * files read and trees walked by whatever the caller wired in.
 */
import { dirname, join, relative, resolve } from "node:path";
import {
  checkLinks,
  checkNestedProjects,
  checkPrefixes,
  checkRequired,
  checkRuleOptions,
  checkSelectors,
  type Diagnostic,
  Engine,
  type InwardsConfig,
  type ListDir,
  layerPackages,
  membersFrom,
  moduleNameFor,
  type PathKind,
  type ProjectFiles,
  type ProjectIndex,
  packagesOf,
  parseConfig,
  probeMembers,
  type Report,
  rootPathOf,
  type SourceFile,
} from "@inwards/core";
import { isInside, posix } from "../paths/lexical.ts";
import type { PathProbe, Runtime } from "../platform/contracts.ts";
import { applyBaseline, readBaseline } from "./baseline.ts";
import type { ProjectIo } from "./contracts.ts";
import { layerLinks, linksUnder } from "./links.ts";
import { otherPortions, workspacePackages } from "./workspace.ts";

/** A loaded project: its config, where its root is, and an engine for it. */
interface Project {
  engine: Engine;
  config: InwardsConfig;
  /** The pyproject.toml, as found and as text, for findings about the config itself. */
  configPath: string;
  configText: string;
  /** The config root as written. */
  lexicalRoot: string;
  /** The config root with symlinks resolved. */
  realRoot: string;
  /** The layer package directories (as written and real), walked without skips. */
  layerDirs: string[];
  /** Probes the other uv workspace members' import roots and the project's site-packages, for namespace package portions. */
  portions: ((rel: string) => ReturnType<PathKind>) | undefined;
}

/**
 * Tells whether a command may use the extraction cache on disk: yes unless
 * `--no-cache` or `INWARDS_NO_CACHE` says otherwise.
 *
 * @param runtime - the environment, for `INWARDS_NO_CACHE`.
 * @param flag - the command's `--no-cache`, if given.
 * @returns true to pass `cache: true` to the check.
 */
export function diskCacheWanted(
  runtime: Pick<Runtime, "noCache">,
  flag: boolean | undefined,
): boolean {
  return !(flag === true || runtime.noCache);
}

/**
 * Reads the config and builds an engine for it.
 *
 * @param io - reads the config, loads the grammars and opens the extraction cache.
 * @param configPath - absolute path of the pyproject.toml to use.
 * @param cache - true to give the engine the disk cache, when `io` has one.
 * @param parsed - the config to use instead of the one in `configPath`, whose
 *   text still places findings about the config itself.
 * @returns the engine and the config root, as written and resolved.
 * @throws {ConfigError} when the config is invalid.
 */
async function openProject(
  io: ProjectIo,
  configPath: string,
  cache = false,
  parsed?: InwardsConfig,
): Promise<Project> {
  const configText = io.read.text(configPath);
  const config = parsed ?? parseConfig(configText);
  const lexicalRoot = resolve(dirname(configPath), config.root);
  const wasm = await io.grammars();
  const dir = dirname(configPath);
  const store = cache ? io.extractionCache?.(io.probe.realpath(dir) ?? dir, wasm) : undefined;
  const options = { workspacePackages: workspacePackages(io, dir) };
  return {
    engine: await Engine.create(wasm, config, store ? { ...options, cache: store } : options),
    config,
    configPath,
    configText,
    lexicalRoot,
    realRoot: io.probe.realpath(lexicalRoot) ?? lexicalRoot,
    layerDirs: layerDirs(io.probe, configPath, config),
    portions: otherPortions(io, dir),
  };
}

/**
 * Finds the top-level package directory of every layer entry, e.g.
 * `<root>/shop` for `shop.domain` or `shop.*.domain` (`layerPackages`). The
 * file walk skips nothing inside them, so a virtualenv marker or a
 * node_modules name can't hide layer code, nor code moved out of a layer
 * next to it.
 *
 * @param probe - resolves real paths.
 * @param configPath - absolute path of the pyproject.toml.
 * @param config - its parsed config.
 * @returns each existing layer package, as written and as its real path.
 */
export function layerDirs(
  probe: Pick<PathProbe, "realpath">,
  configPath: string,
  config: InwardsConfig,
): string[] {
  const root = resolve(dirname(configPath), config.root);
  return layerPackages(config).flatMap((pkg) => {
    // The whole top-level package: code moved from shop/domain to a
    // disguised shop/core must still be seen.
    const dir = join(root, pkg);
    const real = probe.realpath(dir);
    return real === undefined ? [] : [...new Set([dir, real])];
  });
}

/**
 * Reads the Python files under the targets, once per module name they have.
 * Files outside the config root are dropped: they have no module name in the
 * project, and `notCheckedOf` tells the user about a named path that lost all
 * of them. A file reached through an alias and through its real path gets one
 * entry per distinct (module, real file), so it is never reported twice.
 *
 * @param io - walks the targets and reads the files.
 * @param project - the loaded project.
 * @param what - which files, and how to name and read them.
 * @param what.targets - absolute files or directories; undefined means the config root.
 * @param what.base - directory that report paths are made relative to.
 * @param what.texts - content to check instead of what is on disk, by absolute path.
 * @param what.exclude - directories whose files another config checks (uv workspace members).
 * @returns the source files, with forward-slash paths on every OS, and the
 *   walked paths that gave at least one of them.
 */
function loadSources(
  io: ProjectIo,
  project: Project,
  {
    targets,
    base,
    texts,
    exclude,
  }: {
    targets: string[] | undefined;
    base: string;
    texts: ReadonlyMap<string, string> | undefined;
    exclude: readonly string[];
  },
): { files: SourceFile[]; loaded: string[] } {
  const { lexicalRoot, realRoot } = project;
  const files: SourceFile[] = [];
  const loaded: string[] = [];
  const seen = new Set<string>();
  for (const abs of io.walk.pythonFiles(targets ?? [lexicalRoot], project.layerDirs)) {
    const names = moduleNames(io.probe, abs, lexicalRoot, realRoot);
    if (names.length === 0 || exclude.some((dir) => atOrInside(dir, abs))) {
      continue; // outside the root, or a workspace member's own config checks it: not read at all
    }
    loaded.push(abs);
    const text = texts?.get(abs) ?? io.read.text(abs);
    const real = io.probe.realpath(abs) ?? abs;
    for (const { rel, shown } of names) {
      const named = moduleNameFor(rel);
      // Keyed on the real file too: order.py and order.pyi are one module, two files.
      const key = `${named.module}\u0000${real}`;
      if (!seen.has(key)) {
        seen.add(key);
        files.push({ path: posix(relative(base, shown)), text, ...named });
      }
    }
  }
  return { files, loaded };
}

/**
 * Tells whether a path is a directory or lies below it, by the text alone.
 *
 * @param dir - the directory.
 * @param path - the path to test.
 * @returns true when `path` is `dir` or inside it.
 */
function atOrInside(dir: string, path: string): boolean {
  return path === dir || isInside(dir, path);
}

/**
 * Lists the named paths that gave no file to check, each with the line that
 * says why: outside the config root (#200), or holding no Python file. A
 * directory that holds the root, such as `.`, counts as checked when any file
 * under the root came from it.
 *
 * @param probe - resolves real paths.
 * @param project - the loaded project.
 * @param base - directory the reported paths are made relative to.
 * @param walked - what was named, and what gave files.
 * @param walked.targets - the absolute paths named on the command line.
 * @param walked.loaded - the walked paths that gave at least one source file.
 * @returns one entry per target that gave nothing, in the order named.
 */
function notCheckedOf(
  probe: Pick<PathProbe, "realpath">,
  project: Project,
  base: string,
  { targets, loaded }: { targets: readonly string[]; loaded: readonly string[] },
): { path: string; message: string }[] {
  return targets
    .filter((target) => !loaded.some((abs) => atOrInside(target, abs)))
    .map((target) => {
      const path = posix(relative(base, target)) || ".";
      const real = probe.realpath(target);
      const inRoot =
        atOrInside(project.lexicalRoot, target) ||
        (real !== undefined && atOrInside(project.realRoot, real));
      const message = inRoot
        ? `${path} has no Python files to check.`
        : `${path} is outside root "${project.config.root}" and was not checked.`;
      return { path, message };
    });
}

/**
 * Gives the engine the project's files under the config root, for its module
 * index. Nothing is touched until the engine asks; the listing uses the same
 * walk as `inwards check`, and `listDir` reads one directory (INW010), as
 * `portions` does the other uv workspace members' import roots and the
 * project virtualenv's site-packages.
 *
 * @param io - probes, walks and reads the project.
 * @param project - the loaded project.
 * @returns the probe, listing and reader, with root-relative forward-slash paths.
 */
function projectFiles(io: ProjectIo, project: Project): ProjectFiles {
  const root = project.lexicalRoot;
  return {
    kind: (rel: string): ReturnType<PathKind> => io.probe.kind(join(root, rel)),
    list: (): string[] =>
      io.walk.pythonFiles([root], project.layerDirs).map((abs) => posix(relative(root, abs))),
    read: (rel: string): string => io.read.text(join(root, rel)),
    listDir: (rel: string): ReturnType<ListDir> => io.read.list(join(root, rel)),
    ...(project.portions ? { portions: project.portions } : {}),
  };
}

/**
 * Loads the config and engine, then checks the Python files under the targets.
 * A whole-project run (no targets) also checks the layer prefixes and shape
 * selectors against the modules found (INW006, INW007), warns about nested
 * projects such as uv workspace members (INW006), reports symlinks in layers
 * that hide code from the rules (INW006, `checkLinks`), every shaped
 * package's required members (INW008) and the import cycles among the
 * checked files (INW004). With `required`, a partial run checks
 * the required members of each target's package, listing its directory once.
 * Errors the config's baseline accepts are left out, unless `baseline` is
 * false; findings inline comments suppress go in `suppressed`, and a target
 * that gave no file to check goes in `notChecked` (#200). The duration
 * covers config, grammar loading, reading and checking.
 *
 * @param io - reads, walks and probes the project, loads the grammars, and times the run.
 * @param configPath - absolute path of the pyproject.toml to use.
 * @param targets - absolute files or directories; undefined means the config root.
 * @param options - `base`, the directory report paths are made relative to;
 *   `baseline: false` reports every violation (for `inwards baseline`),
 *   `required: true` adds INW008 for the targets' packages (for the hook), `texts`
 *   checks the given content instead of a file's (a file as it was at session start).
 * @param options.base - directory that report paths are made relative to.
 * @param options.baseline - false to report violations the baseline accepts.
 * @param options.required - true to add INW008 for the targets' packages.
 * @param options.edit - true for a per-edit check (the PostToolUse hook): FAPI003
 *   keeps only what one file shows, and leaves unmounted routers to the Stop gate.
 * @param options.texts - content to check instead of a file's, by absolute path.
 * @param options.cache - true to read and fill the extraction cache on disk
 *   (`inwards check` and `inwards baseline`); the hooks never pass it (#56).
 * @param options.config - the config to check with instead of the one in
 *   `configPath` (the Stop gate's session-start config, after the agent changed it).
 * @param options.exclude - directories whose files are left out because their own
 *   config checks them: the uv workspace members under a workspace root's config (#57).
 * @returns the report, with forward-slash paths on every OS.
 * @throws {ConfigError} when the config or the baseline is invalid.
 */
export async function runCheck(
  io: ProjectIo,
  configPath: string,
  targets: string[] | undefined,
  {
    base,
    baseline = true,
    required = false,
    edit = false,
    texts,
    cache = false,
    config,
    exclude = [],
  }: {
    base: string;
    baseline?: boolean | undefined;
    required?: boolean | undefined;
    edit?: boolean | undefined;
    texts?: ReadonlyMap<string, string> | undefined;
    cache?: boolean | undefined;
    config?: InwardsConfig | undefined;
    exclude?: readonly string[] | undefined;
  },
): Promise<Report> {
  const started = io.clock.elapsed();
  const project = await openProject(io, configPath, cache, config);
  const { files, loaded } = loadSources(io, project, { targets, base, texts, exclude });
  // Read first: the engine skips the confirming parse where the baseline accepts everything.
  const accepted = baseline ? readBaseline(io, configPath, project.config.rules) : undefined;
  const listing = projectFiles(io, project);
  const index = project.engine.index(listing);
  // A whole-project run also looks for import cycles (INW004), which one file can't show.
  const whole = targets === undefined;
  const { diagnostics, suppressed } = project.engine.check(files, index, accepted, {
    whole,
    edit,
  });
  const shownRoot = posix(relative(base, project.lexicalRoot));
  if (targets === undefined) {
    const modules = new Set(files.map((file) => file.module));
    const pyproject = { path: posix(relative(base, project.configPath)), text: project.configText };
    const paths = files.map(rootPathOf);
    const packages = packagesOf(paths);
    diagnostics.unshift(
      ...checkPrefixes(project.config, modules, pyproject),
      ...checkSelectors(project.config, packages, pyproject),
      ...checkRuleOptions(project.config.rules, pyproject),
      ...checkNestedProjects(project.config, pyproject, { modules, kind: listing.kind, shownRoot }),
      ...checkLinks(project.config, {
        links: linksUnder(
          io.probe,
          layerLinks(io, project.configPath, project.config),
          project.lexicalRoot,
          project.config,
        ),
        modules,
        shownRoot,
      }),
    );
    diagnostics.push(...checkRequired(project.config, packages, membersFrom(paths), shownRoot));
  } else if (required) {
    diagnostics.push(...requiredAround(io, project, files, shownRoot));
  }
  const notChecked =
    targets === undefined ? [] : notCheckedOf(io.probe, project, base, { targets, loaded });
  const report = {
    diagnostics,
    suppressed,
    filesChecked: files.length,
    ...(notChecked.length === 0 ? {} : { notChecked }),
    durationMs: io.clock.elapsed() - started,
  };
  return accepted ? applyBaseline(accepted, report, targets === undefined) : report;
}

/**
 * Checks the required members of the packages that hold some files (INW008),
 * reading each package's directory listing at most once.
 *
 * @param io - lists directories.
 * @param project - the loaded project.
 * @param files - the checked files.
 * @param shownRoot - the config root as report paths show it.
 * @returns the missing-member errors.
 */
function requiredAround(
  io: Pick<ProjectIo, "read">,
  project: Project,
  files: SourceFile[],
  shownRoot: string,
): Diagnostic[] {
  const parents = new Set(files.map((f) => rootPathOf(f).split("/").slice(0, -1).join(".")));
  const members = probeMembers((dir) => io.read.list(join(project.lexicalRoot, dir)));
  return checkRequired(project.config, parents, members, shownRoot);
}

/**
 * Builds the module index `runCheck` gives the engine, for a caller that
 * wants the index itself (the tests, and the language server parity test).
 * Nothing is listed or read until the index is asked.
 *
 * @param io - reads, walks and probes the project and loads the grammars.
 * @param configPath - absolute path of the pyproject.toml to use.
 * @returns a lazy index of the project's modules, for lookups by name.
 * @throws {ConfigError} when the config is invalid.
 */
export async function indexProject(io: ProjectIo, configPath: string): Promise<ProjectIndex> {
  const project = await openProject(io, configPath);
  return project.engine.index(projectFiles(io, project));
}

/**
 * Lists every module name Python could import a file by.
 * Python names a module after the path it was imported through, so a file
 * reached through a symlinked alias has two names: the alias path and the
 * real path. Both are checked, so an alias can't hide a file from its layer.
 * Names that fall outside the config root are dropped.
 *
 * @param probe - resolves real paths.
 * @param abs - the file as found.
 * @param lexicalRoot - the config root as written.
 * @param realRoot - the config root with symlinks resolved.
 * @returns each name as a root-relative path, with the path to show for it.
 */
function moduleNames(
  probe: Pick<PathProbe, "realpath">,
  abs: string,
  lexicalRoot: string,
  realRoot: string,
): { rel: string; shown: string }[] {
  const names: { rel: string; shown: string }[] = [];
  if (isInside(lexicalRoot, abs)) {
    names.push({ rel: relative(lexicalRoot, abs), shown: abs });
  }
  const real = probe.realpath(abs);
  if (real !== undefined && isInside(realRoot, real)) {
    const rel = relative(realRoot, real);
    if (!names.some((n) => n.rel === rel)) {
      names.push({ rel, shown: real });
    }
  }
  return names;
}
