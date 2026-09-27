/**
 * @file Finds the first-party module an import target lives in, by asking the
 * adapter what is at a path. The engine never touches the disk: an adapter
 * passes a `PathKind`, and `probeLookup` applies Python's import rules to it.
 */

/**
 * Finds the first-party module an import target lives in, what INW006 asks
 * the module index (`ProjectIndex.ownerOf`, built by `probeLookup`).
 *
 * @param target - a resolved dotted import target.
 * @returns the owning first-party module, or undefined for third-party code.
 */
export type ModuleLookup = (target: string) => string | undefined;

/** What an adapter's file system says is at a path: a file, a directory, or nothing. */
export type PathKind = (relPath: string) => "file" | "dir" | undefined;

/**
 * Builds a ModuleLookup from the adapter's file system, following Python's
 * import rules for a first-party module under the config root:
 *
 * - `a/b.py` or `a/b.pyi` is module `a.b`;
 * - a directory `a/b` below a top-level package is a package (a namespace
 *   package needs no `__init__.py`);
 * - a top-level directory counts only with an `__init__.py`: a bare `logging/`
 *   or `docker/` folder loses to the stdlib or site-packages module of that name.
 *
 * The longest existing prefix of a target wins.
 *
 * @param kind - tells what is at a forward-slash path relative to the config root.
 * @returns the lookup.
 */
export function probeLookup(kind: PathKind): ModuleLookup {
  return (target: string): string | undefined => {
    const parts = target.split(".");
    let end = parts.length;
    while (end > 0 && !isModule(kind, parts.slice(0, end))) {
      end -= 1;
    }
    return end === 0 ? undefined : parts.slice(0, end).join(".");
  };
}

/**
 * Tells whether a dotted name is a first-party module on disk (see `probeLookup`).
 *
 * @param kind - the adapter's view of the file system.
 * @param segments - the module name, split on dots.
 * @returns true for a module file, a nested package directory, or a top-level package with `__init__`.
 */
function isModule(kind: PathKind, segments: readonly string[]): boolean {
  const base = segments.join("/");
  if (kind(`${base}.py`) === "file" || kind(`${base}.pyi`) === "file") {
    return true;
  }
  if (kind(base) !== "dir") {
    return false;
  }
  return (
    segments.length > 1 ||
    kind(`${base}/__init__.py`) === "file" ||
    kind(`${base}/__init__.pyi`) === "file"
  );
}
