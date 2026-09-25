/**
 * Loading a project: its config, its Python sources under their module names,
 * and a check run over them. The engine does no I/O (ADR-006), so all file
 * reading happens here.
 */
import { readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import {
  Engine,
  moduleNameFor,
  type ProjectIndex,
  parseConfig,
  type Report,
  type SourceFile,
} from "@inwards/core";
import { collectPythonFiles } from "./files.ts";
import { loadGrammars } from "./grammars.ts";
import { isInside, posix, realpath } from "./paths.ts";

/** A loaded project: its config, where its root is, and an engine for it. */
interface Project {
  engine: Engine;
  /** The config root as written. */
  lexicalRoot: string;
  /** The config root with symlinks resolved. */
  realRoot: string;
}

/**
 * Reads the config and builds an engine for it.
 *
 * @param configPath - absolute path of the pyproject.toml to use.
 * @returns the engine and the config root, as written and resolved.
 * @throws {ConfigError} when the config is invalid.
 */
async function openProject(configPath: string): Promise<Project> {
  const config = parseConfig(readFileSync(configPath, "utf8"));
  const lexicalRoot = resolve(dirname(configPath), config.root);
  return {
    engine: await Engine.create(await loadGrammars(), config),
    lexicalRoot,
    realRoot: realpath(lexicalRoot) ?? lexicalRoot,
  };
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
  for (const abs of collectPythonFiles(targets ?? [lexicalRoot])) {
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
 * Loads the config and engine, then checks the Python files under the targets.
 * The duration covers config, grammar loading, reading and checking.
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
  const diagnostics = project.engine.checkFiles(files);
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
