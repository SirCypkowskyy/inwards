/**
 * Writing what `inwards init --style` planned without touching anything it
 * shouldn't: a scaffold file never replaces an existing entry (a dangling
 * symlink included) and never lands outside the project through a symlinked
 * directory, and a failed write removes what this run created, so the
 * project is as it was and init can run again.
 */
import { lstatSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Change } from "./init.ts";
import { isInside, realpath } from "./paths.ts";
import { type Style, scaffoldFiles } from "./styles.ts";

/** The scaffold's files to create, and the paths that stop it. */
interface ScaffoldPlan {
  files: Change[];
  /** Existing entries it would replace, or files whose directory leads outside the project. */
  refused: string[];
}

/**
 * Lists the scaffold's files. An `__init__.py` that already exists as a
 * regular file is left out, so a package uv created stays as it is. Any
 * other existing entry, a symlink even when it dangles, is refused, and so
 * is a file whose nearest existing directory resolves outside the project.
 *
 * @param project - the project directory.
 * @param style - the preset.
 * @param pkg - the import package.
 * @param root - the config root.
 * @returns the files to create and the refused paths.
 */
export function planScaffold(
  project: string,
  style: Style,
  pkg: string,
  root: string,
): ScaffoldPlan {
  const realProject = realpath(project) ?? project;
  const plan: ScaffoldPlan = { files: [], refused: [] };
  for (const [rel, after] of scaffoldFiles(style, pkg, root)) {
    const path = join(project, ...rel.split("/"));
    const entry = entryAt(path);
    if (entry === "keep" && rel.endsWith("/__init__.py")) {
      continue;
    }
    if (entry !== undefined || !landsInside(realProject, dirname(path))) {
      plan.refused.push(path);
    } else {
      plan.files.push({ path, before: undefined, after });
    }
  }
  return plan;
}

/**
 * Tells what is at a path without following a symlink there.
 *
 * @param path - the path to look at.
 * @returns undefined when nothing is there, "keep" for a regular file, "other" for anything else.
 */
function entryAt(path: string): "keep" | "other" | undefined {
  try {
    const entry = lstatSync(path, { throwIfNoEntry: false });
    if (entry === undefined) {
      return undefined;
    }
    return entry.isFile() ? "keep" : "other";
  } catch {
    return "other"; // e.g. ENOTDIR: a parent is a file.
  }
}

/**
 * Tells whether files created in a directory stay in the project: the
 * directory's nearest existing ancestor (itself included) must resolve, with
 * symlinks followed, to a directory inside the project or to the project.
 *
 * @param realProject - the project directory with symlinks resolved.
 * @param dir - where a file would be created.
 * @returns false for a dangling symlink, a file in the way, or a path outside.
 */
function landsInside(realProject: string, dir: string): boolean {
  for (let d = dir; ; d = dirname(d)) {
    if (lstatSync(d, { throwIfNoEntry: false }) !== undefined) {
      const real = realpath(d);
      return (
        real !== undefined &&
        (real === realProject || isInside(realProject, real)) &&
        statSync(real).isDirectory()
      );
    }
    if (dirname(d) === d) {
      return false;
    }
  }
}

/**
 * Writes the scaffold's files, each with `wx` so nothing existing is
 * replaced, and pyproject.toml last. If any write fails, the files and
 * directories this run created are removed, and pyproject.toml is untouched
 * unless its own write was the one that failed.
 *
 * @param files - the files to create.
 * @param config - the pyproject.toml change, written last.
 * @returns undefined on success, or which file failed and why.
 */
export function writeAll(files: readonly Change[], config: Change): string | undefined {
  const created: string[] = [];
  const dirs: string[] = [];
  let current = config.path;
  try {
    for (const file of files) {
      current = file.path;
      const made = mkdirSync(dirname(file.path), { recursive: true });
      if (made !== undefined) {
        dirs.push(made);
      }
      writeFileSync(file.path, file.after, { flag: "wx" });
      created.push(file.path);
    }
    current = config.path;
    writeFileSync(config.path, config.after);
    return undefined;
  } catch (err) {
    for (const path of [...created].reverse()) {
      rmSync(path, { force: true });
    }
    // Each is the first directory one mkdir created: everything below it is this run's.
    for (const dir of [...dirs].reverse()) {
      rmSync(dir, { recursive: true, force: true });
    }
    const reason = err instanceof Error ? err.message : String(err);
    return `${current}: ${reason}`;
  }
}
