/**
 * @file Loading a project: its config, its Python sources under their module names,
 * and a check run over them. The engine does no I/O (ADR-006), so all file
 * reading happens here, through the injected `ProjectIo`: paths are probed,
 * files read and trees walked by whatever the caller wired in.
 */
import { dirname, join, relative, resolve } from "node:path";
import {
  checkPrefixes,
  checkRequired,
  checkSelectors,
  type Diagnostic,
  Engine,
  type InwardsConfig,
  type ListDir,
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
 * @returns the engine and the config root, as written and resolved.
 * @throws {ConfigError} when the config is invalid.
 */
async function openProject(io: ProjectIo, configPath: string, cache = false): Promise<Project> {
  const configText = io.read.text(configPath);
  const config = parseConfig(configText);
  const lexicalRoot = resolve(dirname(configPath), config.root);
  const wasm = await io.grammars();
  const dir = dirname(configPath);
  const store = cache ? io.extractionCache?.(io.probe.realpath(dir) ?? dir, wasm) : undefined;
  return {
    engine: await Engine.create(wasm, config, store ? { cache: store } : {}),
    config,
    configPath,
    configText,
    lexicalRoot,
    realRoot: io.probe.realpath(lexicalRoot) ?? lexicalRoot,
    layerDirs: layerDirs(io.probe, configPath, config),
  };
}

/**
 * Finds the top-level package directory of every layer prefix, e.g.
 * `<root>/shop` for `shop.domain`. The file walk skips nothing inside them,
 * so a virtualenv marker or a node_modules name can't hide layer code, nor
 * code moved out of a layer next to it.
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
  return config.layers
    .flatMap((layer) => layer.modules)
    .flatMap((prefix) => {
      // The whole top-level package: code moved from shop/domain to a
      // disguised shop/core must still be seen.
      const dir = join(root, prefix.split(".")[0] ?? prefix);
      const real = probe.realpath(dir);
      return real === undefined ? [] : [...new Set([dir, real])];
    });
}

/**
 * Reads the Python files under the targets, once per module name they have.
 * Files outside the config root are dropped: they have no module name in the
 * project. A file reached through an alias and through its real path gets one
 * entry per distinct (module, real file), so it is never reported twice.
 *
 * @param io - walks the targets and reads the files.
 * @param project - the loaded project.
 * @param what - which files, and how to name and read them.
 * @param what.targets - absolute files or directories; undefined means the config root.
 * @param what.base - directory that report paths are made relative to.
 * @param what.texts - content to check instead of what is on disk, by absolute path.
 * @returns the source files, with forward-slash paths on every OS.
 */
function loadSources(
  io: ProjectIo,
  project: Project,
  {
    targets,
    base,
    texts,
  }: {
    targets: string[] | undefined;
    base: string;
    texts: ReadonlyMap<string, string> | undefined;
  },
): SourceFile[] {
  const { lexicalRoot, realRoot } = project;
  const files: SourceFile[] = [];
  const seen = new Set<string>();
  for (const abs of io.walk.pythonFiles(targets ?? [lexicalRoot], project.layerDirs)) {
    const text = texts?.get(abs) ?? io.read.text(abs);
    const real = io.probe.realpath(abs) ?? abs;
    for (const { rel, shown } of moduleNames(io.probe, abs, lexicalRoot, realRoot)) {
      const named = moduleNameFor(rel);
      // Keyed on the real file too: order.py and order.pyi are one module, two files.
      const key = `${named.module}\u0000${real}`;
      if (!seen.has(key)) {
        seen.add(key);
        files.push({ path: posix(relative(base, shown)), text, ...named });
      }
    }
  }
  return files;
}

/**
 * Gives the engine the project's files under the config root, for its module
 * index. Nothing is touched until the engine asks; the listing uses the same
 * walk as `inwards check`, and `listDir` reads one directory (INW010).
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
  };
}

/**
 * Loads the config and engine, then checks the Python files under the targets.
 * A whole-project run (no targets) also checks the layer prefixes and shape
 * selectors against the modules found (INW006, INW007) and every shaped
 * package's required members (INW008). With `required`, a partial run checks
 * the required members of each target's package, listing its directory once.
 * Errors the config's baseline accepts are left out, unless `baseline` is
 * false; findings inline comments suppress go in `suppressed`. The duration
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
 * @param options.texts - content to check instead of a file's, by absolute path.
 * @param options.cache - true to read and fill the extraction cache on disk
 *   (`inwards check` and `inwards baseline`); the hooks never pass it (#56).
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
    texts,
    cache = false,
  }: {
    base: string;
    baseline?: boolean | undefined;
    required?: boolean | undefined;
    texts?: ReadonlyMap<string, string> | undefined;
    cache?: boolean | undefined;
  },
): Promise<Report> {
  const started = io.clock.elapsed();
  const project = await openProject(io, configPath, cache);
  const files = loadSources(io, project, { targets, base, texts });
  // Read first: the engine skips the confirming parse where the baseline accepts everything.
  const accepted = baseline ? readBaseline(io, configPath, project.config.rules) : undefined;
  const index = project.engine.index(projectFiles(io, project));
  const { diagnostics, suppressed } = project.engine.check(files, index, accepted);
  const shownRoot = posix(relative(base, project.lexicalRoot));
  if (targets === undefined) {
    const modules = new Set(files.map((file) => file.module));
    const pyproject = { path: posix(relative(base, project.configPath)), text: project.configText };
    const paths = files.map(rootPathOf);
    const packages = packagesOf(paths);
    diagnostics.unshift(
      ...checkPrefixes(project.config, modules, pyproject),
      ...checkSelectors(project.config, packages, pyproject),
    );
    diagnostics.push(...checkRequired(project.config, packages, membersFrom(paths), shownRoot));
  } else if (required) {
    diagnostics.push(...requiredAround(io, project, files, shownRoot));
  }
  const report = {
    diagnostics,
    suppressed,
    filesChecked: files.length,
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
