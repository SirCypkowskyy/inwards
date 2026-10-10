/**
 * @file The Python files a check reads: walking the targets for them and
 * the module names each is checked under (`planSources`), then reading them
 * (`readSources`), in one batch for a large check (#281). Nothing here
 * touches the disk itself; the walk and the reads come through `ProjectIo`.
 * Which files to check and how to name them is decided here; the check
 * itself is `check.ts`'s.
 */
import { relative } from "node:path";
import { moduleNameFor, type SourceFile } from "@inwards/core";
import { isInside, posix } from "../paths/lexical.ts";
import type { ProjectIo } from "./contracts.ts";
import { MIN_PARALLEL_FILES } from "./threads.ts";

/** Where a project's modules live: what naming and walking its files needs. */
interface Project {
  /** The config root as written. */
  lexicalRoot: string;
  /** The config root with symlinks resolved. */
  realRoot: string;
  /** The layer package directories (as written and real), walked without skips. */
  layerDirs: string[];
}

/** A walked file to read, and the source files it gives, each still without its text. */
export interface PlannedFile {
  abs: string;
  sources: Omit<SourceFile, "text">[];
}

/**
 * Lists the Python files under the targets and the module names each is
 * checked under, without reading any of them yet: the count decides whether
 * worker threads start, and they can start while the files are read.
 * Files outside the config root are dropped: they have no module name in the
 * project, and `notCheckedOf` tells the user about a named path that lost all
 * of them. A file reached through an alias and through its real path gets one
 * entry per distinct (module, real file), so it is never reported twice.
 *
 * @param io - walks the targets; the walk gives each file's real path.
 * @param project - the config root, as written and real, and the layer packages walked without skips.
 * @param what - which files, and how to name them.
 * @param what.targets - absolute files or directories; undefined means the config root.
 * @param what.base - directory that report paths are made relative to.
 * @param what.exclude - directories whose files another config checks (uv workspace members).
 * @returns the files to read with their source entries (forward-slash paths
 *   on every OS), and how many source files they give.
 */
export function planSources(
  io: Pick<ProjectIo, "walk">,
  project: Project,
  {
    targets,
    base,
    exclude,
  }: { targets: string[] | undefined; base: string; exclude: readonly string[] },
): { planned: PlannedFile[]; count: number } {
  const { lexicalRoot, realRoot } = project;
  const planned: PlannedFile[] = [];
  const seen = new Set<string>();
  let count = 0;
  for (const { path: abs, real: resolved } of io.walk.pythonSources(
    targets ?? [lexicalRoot],
    project.layerDirs,
  )) {
    const names = moduleNames(abs, resolved, lexicalRoot, realRoot);
    if (names.length === 0 || exclude.some((dir) => atOrInside(dir, abs))) {
      continue; // outside the root, or a workspace member's own config checks it: not read at all
    }
    const real = resolved ?? abs;
    const sources: Omit<SourceFile, "text">[] = [];
    for (const { rel, shown } of names) {
      const named = moduleNameFor(rel);
      // Keyed on the real file too: order.py and order.pyi are one module, two files.
      const key = `${named.module}\u0000${real}`;
      if (!seen.has(key)) {
        seen.add(key);
        sources.push({ path: posix(relative(base, shown)), ...named });
      }
    }
    planned.push({ abs, sources });
    count += sources.length;
  }
  return { planned, count };
}

/**
 * Reads the planned files, once each, and gives every source entry its
 * text. A check of `MIN_PARALLEL_FILES` files or more reads them several at a
 * time (`FileReader.texts`); a smaller one, such as a hook's, reads in turn.
 *
 * @param io - reads the files.
 * @param planned - the files from `planSources`, in order.
 * @param count - how many source files they give.
 * @param texts - content to check instead of what is on disk, by absolute path.
 * @returns the source files, in the planned order.
 * @throws when a file can't be read.
 */
export async function readSources(
  io: Pick<ProjectIo, "read">,
  planned: readonly PlannedFile[],
  count: number,
  texts: ReadonlyMap<string, string> | undefined,
): Promise<SourceFile[]> {
  const fromDisk = planned.map(({ abs }) => abs).filter((abs) => texts?.has(abs) !== true);
  const read =
    count >= MIN_PARALLEL_FILES
      ? await io.read.texts(fromDisk)
      : fromDisk.map((abs) => io.read.text(abs));
  const byPath = new Map<string, string>();
  for (const [n, abs] of fromDisk.entries()) {
    const text = read[n];
    if (text !== undefined) {
      byPath.set(abs, text);
    }
  }
  return planned.flatMap(({ abs, sources }) => {
    // A file the batch didn't give back, which a reader keeping its contract never does, is read alone.
    const text = texts?.get(abs) ?? byPath.get(abs) ?? io.read.text(abs);
    return sources.map((source) => ({ ...source, text }));
  });
}

/**
 * Tells whether a path is a directory or lies below it, by the text alone.
 *
 * @param dir - the directory.
 * @param path - the path to test.
 * @returns true when `path` is `dir` or inside it.
 */
export function atOrInside(dir: string, path: string): boolean {
  return path === dir || isInside(dir, path);
}

/**
 * Lists every module name Python could import a file by.
 * Python names a module after the path it was imported through, so a file
 * reached through a symlinked alias has two names: the alias path and the
 * real path. Both are checked, so an alias can't hide a file from its layer.
 * Names that fall outside the config root are dropped.
 *
 * @param abs - the file as found.
 * @param real - its real path, or undefined when it can't be resolved.
 * @param lexicalRoot - the config root as written.
 * @param realRoot - the config root with symlinks resolved.
 * @returns each name as a root-relative path, with the path to show for it.
 */
function moduleNames(
  abs: string,
  real: string | undefined,
  lexicalRoot: string,
  realRoot: string,
): { rel: string; shown: string }[] {
  const names: { rel: string; shown: string }[] = [];
  if (isInside(lexicalRoot, abs)) {
    names.push({ rel: relative(lexicalRoot, abs), shown: abs });
  }
  if (real !== undefined && isInside(realRoot, real)) {
    const rel = relative(realRoot, real);
    if (!names.some((n) => n.rel === rel)) {
      names.push({ rel, shown: real });
    }
  }
  return names;
}
