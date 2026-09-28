/**
 * @file Planning what `inwards init --style --scaffold` creates without touching
 * anything it shouldn't: a scaffold file never replaces an existing entry (a
 * dangling symlink included) and never lands outside the project through a
 * symlinked directory. Writing the plan, with rollback, is the `InitFiles`
 * contract's job (`adapters/init-files.ts`).
 */
import { dirname, join } from "node:path";
import { isInside } from "../paths/lexical.ts";
import type { PathProbe } from "../platform/contracts.ts";
import type { Change } from "./contracts.ts";
import { scaffoldFiles } from "./example.ts";
import type { Style } from "./styles.ts";

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
 * @param probe - looks at what is already there.
 * @param project - the project directory.
 * @param preset - what to scaffold.
 * @param preset.style - the layer preset, e.g. layered.
 * @param preset.pkg - the import package.
 * @param preset.root - the config root.
 * @returns the files to create and the refused paths.
 */
export function planScaffold(
  probe: Pick<PathProbe, "realpath" | "isLink" | "kind">,
  project: string,
  { style, pkg, root }: { style: Style; pkg: string; root: string },
): ScaffoldPlan {
  const realProject = probe.realpath(project) ?? project;
  const plan: ScaffoldPlan = { files: [], refused: [] };
  for (const [rel, after] of scaffoldFiles(style, pkg, root)) {
    const path = join(project, ...rel.split("/"));
    const entry = entryAt(probe, path);
    if (entry === "keep" && rel.endsWith("/__init__.py")) {
      continue;
    }
    if (entry !== undefined || !landsInside(probe, realProject, dirname(path))) {
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
 * @param probe - looks at the path.
 * @param path - the path to look at.
 * @returns undefined when nothing can be looked at there (a parent that is a
 *   file is caught by `landsInside`), "keep" for a regular file, "other" for
 *   anything else, a symlink included.
 */
function entryAt(
  probe: Pick<PathProbe, "isLink" | "kind">,
  path: string,
): "keep" | "other" | undefined {
  const link = probe.isLink(path);
  if (link === undefined) {
    return undefined;
  }
  return !link && probe.kind(path) === "file" ? "keep" : "other";
}

/**
 * Tells whether files created in a directory stay in the project: the
 * directory's nearest existing ancestor (itself included) must resolve, with
 * symlinks followed, to a directory inside the project or to the project.
 *
 * @param probe - resolves and looks at the directories.
 * @param realProject - the project directory with symlinks resolved.
 * @param dir - where a file would be created.
 * @returns false for a dangling symlink, a file in the way, or a path outside.
 */
function landsInside(
  probe: Pick<PathProbe, "realpath" | "isLink" | "kind">,
  realProject: string,
  dir: string,
): boolean {
  for (let d = dir; ; d = dirname(d)) {
    if (probe.isLink(d) !== undefined) {
      const real = probe.realpath(d);
      return (
        real !== undefined &&
        (real === realProject || isInside(realProject, real)) &&
        probe.kind(real) === "dir"
      );
    }
    if (dirname(d) === d) {
      return false;
    }
  }
}
