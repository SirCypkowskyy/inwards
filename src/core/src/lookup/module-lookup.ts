/**
 * @file Finds the first-party module an import target lives in, by asking the
 * adapter what is at a path. The engine never touches the disk: an adapter
 * passes a `PathKind` and a `ListDir`, and `probeLookup` applies Python's
 * import rules to them, sourceless and compiled modules included.
 */
import type { ListDir } from "./directory-listing.ts";

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
 * What follows a module's name in a file Python imports without a `.py`: an
 * extension (`.so`, `.cpython-313-x86_64-linux-gnu.so`, `.pyd`), Cython
 * source a build step compiles, or bytecode left without its source.
 */
const COMPILED_SUFFIX: RegExp = /^(?:\.[\w-]+)?\.(?:so|pyd)$|^\.(?:pyx|pyc)$/u;

/**
 * Builds a ModuleLookup from the adapter's file system, following Python's
 * import rules for a first-party module under the config root:
 *
 * - `a/b.py` or `a/b.pyi` is module `a.b`;
 * - so is a compiled or sourceless file in `a/` (`b.cpython-313-x86_64-linux-gnu.so`,
 *   `b.pyd`, `b.pyc`, `b.pyx`), found in the listing of `a/` when the
 *   adapter gives `listDir` (#86);
 * - a directory `a/b` below a top-level package is a package (a namespace
 *   package needs no `__init__.py`);
 * - a top-level directory counts only with an `__init__` (source, stub or
 *   compiled): a bare `logging/` or `docker/` folder loses to the stdlib or
 *   site-packages module of that name.
 *
 * The longest existing prefix of a target wins.
 *
 * @param kind - tells what is at a forward-slash path relative to the config root.
 * @param listDir - lists a directory relative to the config root (`""` is the
 *   root), for compiled modules; without it only source files count.
 * @returns a function from an import target to the first-party module that holds it.
 */
export function probeLookup(kind: PathKind, listDir?: ListDir): ModuleLookup {
  return (target: string): string | undefined => {
    const parts = target.split(".");
    let end = parts.length;
    while (end > 0 && !isModule(kind, listDir, parts.slice(0, end))) {
      end -= 1;
    }
    return end === 0 ? undefined : parts.slice(0, end).join(".");
  };
}

/**
 * Tells whether a dotted name is a first-party module on disk (see `probeLookup`).
 *
 * @param kind - the adapter's view of the file system.
 * @param listDir - lists a directory, for compiled modules; optional.
 * @param segments - the module name, split on dots.
 * @returns true for a module file, a nested package directory, or a top-level package with `__init__`.
 */
function isModule(
  kind: PathKind,
  listDir: ListDir | undefined,
  segments: readonly string[],
): boolean {
  const base = segments.join("/");
  if (kind(`${base}.py`) === "file" || kind(`${base}.pyi`) === "file") {
    return true;
  }
  const parent = segments.slice(0, -1).join("/");
  const name = segments.at(-1) ?? base;
  if ((parent === "" || kind(parent) === "dir") && compiledIn(listDir, parent, name)) {
    return true;
  }
  if (kind(base) !== "dir") {
    return false;
  }
  return (
    segments.length > 1 ||
    kind(`${base}/__init__.py`) === "file" ||
    kind(`${base}/__init__.pyi`) === "file" ||
    compiledIn(listDir, base, "__init__")
  );
}

/**
 * Tells whether a directory holds a compiled or sourceless module of a name.
 *
 * @param listDir - lists the directory; undefined means no listing, so no.
 * @param dir - the directory relative to the config root, `""` for the root.
 * @param name - the module's last name segment.
 * @returns true when a file such as `name.cpython-313-x86_64-linux-gnu.so` or `name.pyc` is there.
 */
function compiledIn(listDir: ListDir | undefined, dir: string, name: string): boolean {
  return (listDir?.(dir) ?? []).some(
    (e) =>
      !e.dir && e.name.startsWith(`${name}.`) && COMPILED_SUFFIX.test(e.name.slice(name.length)),
  );
}

/** A Python identifier, the only top-level name an import can spell. */
const IDENTIFIER = /^[\p{ID_Start}_][\p{ID_Continue}]*$/u;
/** A Python source or stub file, with its stem. */
const SOURCE_FILE = /^(?<stem>[^.]+)\.pyi?$/u;

/**
 * Lists the top-level first-party module names under the config root, by the
 * probe's rules: a source, stub, compiled or sourceless module file, or a
 * directory with an `__init__` in any of those forms. Nothing is skipped, so a
 * directory that holds a `pyvenv.cfg` still counts. The Stop gate compares
 * this list at session start and now to find a package that appeared (#86).
 *
 * @param listDir - lists a directory relative to the config root, `""` for the root.
 * @returns the names, sorted; empty when the root can't be listed.
 */
export function topLevelModules(listDir: ListDir): string[] {
  const names = new Set<string>();
  for (const entry of listDir("") ?? []) {
    const stem = entry.name.split(".")[0] ?? entry.name;
    const module = entry.dir
      ? entry.name === stem && hasInit(listDir, entry.name)
      : SOURCE_FILE.test(entry.name) || COMPILED_SUFFIX.test(entry.name.slice(stem.length));
    if (module && IDENTIFIER.test(stem)) {
      names.add(stem);
    }
  }
  return [...names].sort();
}

/**
 * Tells whether a directory holds an `__init__` Python would import it by.
 *
 * @param listDir - lists a directory relative to the config root.
 * @param dir - the directory.
 * @returns true for `__init__.py`, `__init__.pyi` or a compiled `__init__`.
 */
function hasInit(listDir: ListDir, dir: string): boolean {
  return (listDir(dir) ?? []).some(
    (e) =>
      !e.dir &&
      (e.name === "__init__.py" ||
        e.name === "__init__.pyi" ||
        (e.name.startsWith("__init__.") && COMPILED_SUFFIX.test(e.name.slice("__init__".length)))),
  );
}
