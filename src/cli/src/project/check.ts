/**
 * Loading a project: its config, its Python sources under their module names,
 * and a check run over them. The engine does no I/O (ADR-006), so all file
 * reading happens here.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
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
import { collectPythonFiles } from "../adapters/file-walk.ts";
import { loadGrammars } from "../adapters/grammars.ts";
import { isInside, posix, realpath } from "../paths/lexical.ts";
import { applyBaseline, readBaseline } from "./baseline.ts";

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
 * Reads the config and builds an engine for it.
 *
 * @param configPath - absolute path of the pyproject.toml to use.
 * @returns the engine and the config root, as written and resolved.
 * @throws {ConfigError} when the config is invalid.
 */
async function openProject(configPath: string): Promise<Project> {
  const configText = readFileSync(configPath, "utf8");
  const config = parseConfig(configText);
  const lexicalRoot = resolve(dirname(configPath), config.root);
  return {
    engine: await Engine.create(await loadGrammars(), config),
    config,
    configPath,
    configText,
    lexicalRoot,
    realRoot: realpath(lexicalRoot) ?? lexicalRoot,
    layerDirs: layerDirs(configPath, config),
  };
}

/**
 * Finds the top-level package directory of every layer prefix, e.g.
 * `<root>/shop` for `shop.domain`. The file walk skips nothing inside them,
 * so a virtualenv marker or a node_modules name can't hide layer code, nor
 * code moved out of a layer next to it.
 *
 * @param configPath - absolute path of the pyproject.toml.
 * @param config - its parsed config.
 * @returns each existing layer package, as written and as its real path.
 */
export function layerDirs(configPath: string, config: InwardsConfig): string[] {
  const root = resolve(dirname(configPath), config.root);
  return config.layers
    .flatMap((layer) => layer.modules)
    .flatMap((prefix) => {
      // The whole top-level package: code moved from shop/domain to a
      // disguised shop/core must still be seen.
      const dir = join(root, prefix.split(".")[0] ?? prefix);
      const real = realpath(dir);
      return real === undefined ? [] : [...new Set([dir, real])];
    });
}

/**
 * Reads the Python files under the targets, once per module name they have.
 * Files outside the config root are dropped: they have no module name in the
 * project. A file reached through an alias and through its real path gets one
 * entry per distinct (module, real file), so it is never reported twice.
 *
 * @param project - the loaded project.
 * @param targets - absolute files or directories; undefined means the config root.
 * @param base - directory that report paths are made relative to.
 * @param texts - content to check instead of what is on disk, by absolute path.
 * @returns the source files, with forward-slash paths on every OS.
 */
function loadSources(
  project: Project,
  targets: string[] | undefined,
  base: string,
  texts?: ReadonlyMap<string, string>,
): SourceFile[] {
  const { lexicalRoot, realRoot } = project;
  const files: SourceFile[] = [];
  const seen = new Set<string>();
  for (const abs of collectPythonFiles(targets ?? [lexicalRoot], project.layerDirs)) {
    const text = texts?.get(abs) ?? readFileSync(abs, "utf8");
    const real = realpath(abs) ?? abs;
    for (const { rel, shown } of moduleNames(abs, lexicalRoot, realRoot)) {
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
 * @param project - the loaded project.
 * @returns the probe, listing and reader, with root-relative forward-slash paths.
 */
function projectFiles(project: Project): ProjectFiles {
  const root = project.lexicalRoot;
  return {
    kind: (rel: string): ReturnType<PathKind> => {
      const stat = statSync(join(root, rel), { throwIfNoEntry: false });
      if (stat?.isDirectory()) {
        return "dir";
      }
      return stat?.isFile() ? "file" : undefined;
    },
    list: (): string[] =>
      collectPythonFiles([root], project.layerDirs).map((abs) => posix(relative(root, abs))),
    read: (rel: string): string => readFileSync(join(root, rel), "utf8"),
    listDir: (rel: string): ReturnType<ListDir> => listDir(root, rel),
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
 * @param configPath - absolute path of the pyproject.toml to use.
 * @param targets - absolute files or directories; undefined means the config root.
 * @param base - directory that report paths are made relative to.
 * @param options - `baseline: false` reports every violation (for `inwards baseline`),
 *   `required: true` adds INW008 for the targets' packages (for the hook), `texts`
 *   checks the given content instead of a file's (a file as it was at session start).
 * @returns the report, with forward-slash paths on every OS.
 * @throws {ConfigError} when the config or the baseline is invalid.
 */
export async function runCheck(
  configPath: string,
  targets: string[] | undefined,
  base: string,
  {
    baseline = true,
    required = false,
    texts,
  }: { baseline?: boolean; required?: boolean; texts?: ReadonlyMap<string, string> } = {},
): Promise<Report> {
  const started = performance.now();
  const project = await openProject(configPath);
  const files = loadSources(project, targets, base, texts);
  // Read first: the engine skips the confirming parse where the baseline accepts everything.
  const accepted = baseline ? readBaseline(configPath, project.config.rules) : undefined;
  const index = project.engine.index(projectFiles(project));
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
    diagnostics.push(...requiredAround(project, files, shownRoot));
  }
  const report = {
    diagnostics,
    suppressed,
    filesChecked: files.length,
    durationMs: performance.now() - started,
  };
  return accepted ? applyBaseline(accepted, report, targets === undefined) : report;
}

/**
 * Checks the required members of the packages that hold some files (INW008),
 * reading each package's directory listing at most once.
 *
 * @param project - the loaded project.
 * @param files - the checked files.
 * @param shownRoot - the config root as report paths show it.
 * @returns the missing-member errors.
 */
function requiredAround(project: Project, files: SourceFile[], shownRoot: string): Diagnostic[] {
  const parents = new Set(files.map((f) => rootPathOf(f).split("/").slice(0, -1).join(".")));
  const members = probeMembers((dir) => listDir(project.lexicalRoot, dir));
  return checkRequired(project.config, parents, members, shownRoot);
}

/**
 * Lists a directory under the config root, the `ListDir` port.
 *
 * @param root - the config root.
 * @param dir - a forward-slash directory relative to it.
 * @returns its entries, or undefined when it isn't a directory.
 */
function listDir(root: string, dir: string): ReturnType<ListDir> {
  const path = join(root, dir);
  if (!statSync(path, { throwIfNoEntry: false })?.isDirectory()) {
    return;
  }
  return readdirSync(path, { withFileTypes: true }).map((entry) => ({
    name: entry.name,
    dir: entry.isDirectory(),
  }));
}

/**
 * Builds the module index `runCheck` gives the engine, for a caller that
 * wants the index itself (the tests, and the language server parity test).
 * Nothing is listed or read until the index is asked.
 *
 * @param configPath - absolute path of the pyproject.toml to use.
 * @returns the project index.
 * @throws {ConfigError} when the config is invalid.
 */
export async function indexProject(configPath: string): Promise<ProjectIndex> {
  const project = await openProject(configPath);
  return project.engine.index(projectFiles(project));
}

/**
 * Lists every module name Python could import a file by.
 * Python names a module after the path it was imported through, so a file
 * reached through a symlinked alias has two names: the alias path and the
 * real path. Both are checked, so an alias can't hide a file from its layer.
 * Names that fall outside the config root are dropped.
 *
 * @param abs - the file as found.
 * @param lexicalRoot - the config root as written.
 * @param realRoot - the config root with symlinks resolved.
 * @returns each name as a root-relative path, with the path to show for it.
 */
function moduleNames(
  abs: string,
  lexicalRoot: string,
  realRoot: string,
): { rel: string; shown: string }[] {
  const names: { rel: string; shown: string }[] = [];
  if (isInside(lexicalRoot, abs)) {
    names.push({ rel: relative(lexicalRoot, abs), shown: abs });
  }
  const real = realpath(abs);
  if (real !== undefined && isInside(realRoot, real)) {
    const rel = relative(realRoot, real);
    if (!names.some((n) => n.rel === rel)) {
      names.push({ rel, shown: real });
    }
  }
  return names;
}
