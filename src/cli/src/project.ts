/**
 * Loading a project: its config, its Python sources under their module names,
 * and a check run over them. The engine does no I/O (ADR-006), so all file
 * reading happens here.
 */
import { readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import {
  checkPrefixes,
  Engine,
  type InwardsConfig,
  type ModuleLookup,
  moduleNameFor,
  type ProjectIndex,
  parseConfig,
  probeLookup,
  type Report,
  type SourceFile,
} from "@inwards/core";
import { collectPythonFiles } from "./files.ts";
import { loadGrammars } from "./grammars.ts";
import { isInside, posix, realpath } from "./paths.ts";

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
 * @returns the source files, with forward-slash paths on every OS.
 */
function loadSources(project: Project, targets: string[] | undefined, base: string): SourceFile[] {
  const { lexicalRoot, realRoot } = project;
  const files: SourceFile[] = [];
  const seen = new Set<string>();
  for (const abs of collectPythonFiles(targets ?? [lexicalRoot], project.layerDirs)) {
    const text = readFileSync(abs, "utf8");
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
 * Finds first-party modules on disk under the config root, for INW006.
 *
 * @param root - the config root.
 * @returns a lookup over the files and directories under it.
 */
function moduleLookup(root: string): ModuleLookup {
  return probeLookup((rel) => {
    const stat = statSync(join(root, rel), { throwIfNoEntry: false });
    if (stat?.isDirectory()) {
      return "dir";
    }
    return stat?.isFile() ? "file" : undefined;
  });
}

/**
 * Loads the config and engine, then checks the Python files under the targets.
 * A whole-project run (no targets) also checks the layer prefixes against the
 * modules found (INW006). The duration covers config, grammar loading,
 * reading and checking.
 *
 * @param configPath - absolute path of the pyproject.toml to use.
 * @param targets - absolute files or directories; undefined means the config root.
 * @param base - directory that report paths are made relative to.
 * @returns the report, with forward-slash paths on every OS.
 * @throws {ConfigError} when the config is invalid.
 */
export async function runCheck(
  configPath: string,
  targets: string[] | undefined,
  base: string,
): Promise<Report> {
  const started = performance.now();
  const project = await openProject(configPath);
  const files = loadSources(project, targets, base);
  const diagnostics = project.engine.checkFiles(files, moduleLookup(project.lexicalRoot));
  if (targets === undefined) {
    const modules = new Set(files.map((file) => file.module));
    const pyproject = { path: posix(relative(base, project.configPath)), text: project.configText };
    diagnostics.unshift(...checkPrefixes(project.config, modules, pyproject));
  }
  return { diagnostics, filesChecked: files.length, durationMs: performance.now() - started };
}

/**
 * Indexes every module under the config root (for the Stop gate and INW006).
 * Reads every file now; the reverse-import map is built on first use.
 *
 * @param configPath - absolute path of the pyproject.toml to use.
 * @param base - directory that source paths are made relative to.
 * @returns the project index.
 * @throws {ConfigError} when the config is invalid.
 */
export async function indexProject(configPath: string, base: string): Promise<ProjectIndex> {
  const project = await openProject(configPath);
  return project.engine.index(loadSources(project, undefined, base));
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
