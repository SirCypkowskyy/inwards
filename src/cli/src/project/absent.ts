/**
 * @file Hides top-level modules from a project's module index, so a check can
 * see the project as it was before they appeared. The Stop gate uses it to
 * check a file as it was at session start without a top-level package the
 * agent added since (#86). It wraps the adapter's `ProjectFiles` and does no
 * I/O of its own.
 */
import type { ListDir, PathKind, ProjectFiles } from "@inwards/core";

/**
 * Wraps a project's files so that some top-level names don't exist: their
 * paths probe as nothing, their files aren't listed, and the root's listing
 * leaves them out.
 *
 * @param files - the adapter's view of the project, rooted at the config root.
 * @param absent - top-level module names to hide, e.g. `requests`.
 * @returns the same view without them; `files` itself when there is nothing to hide.
 */
export function hideTopLevel(files: ProjectFiles, absent: readonly string[]): ProjectFiles {
  if (absent.length === 0) {
    return files;
  }
  return {
    ...files,
    kind: (rel: string): ReturnType<PathKind> =>
      hidden(absent, rel) ? undefined : files.kind(rel),
    list: (): string[] => files.list().filter((rel) => !hidden(absent, rel)),
    listDir: (rel: string): ReturnType<ListDir> =>
      hidden(absent, rel)
        ? undefined
        : files.listDir(rel)?.filter((e) => rel !== "" || !hidden(absent, e.name)),
  };
}

/**
 * Tells whether a root-relative path lies in a hidden top-level name.
 *
 * @param absent - the hidden names.
 * @param rel - a forward-slash path relative to the config root.
 * @returns true for `name`, `name.py`, `name.cpython-313-x86_64-linux-gnu.so` or anything under `name/`.
 */
function hidden(absent: readonly string[], rel: string): boolean {
  const first = rel.split("/")[0] ?? rel;
  return absent.includes(first.split(".")[0] ?? first);
}
