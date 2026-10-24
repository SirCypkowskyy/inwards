/**
 * @file What makes a first-party module private by its name (ADR-046): a
 * segment below the top-level package that starts with an underscore and
 * isn't a dunder, as PEP 8's "single leading underscore" and Ruff's PLC2701
 * read it. INW021 uses it, and so do contexts made public by the same
 * convention (`public-by-name`, #331). Names only: no I/O, and no view of which
 * modules exist.
 */

/** A dunder name such as `__init__` or `__main__`, which isn't private. */
const DUNDER = /^__.+__$/u;

/**
 * Tells whether one name segment is private: `_user` or `_internal`, but not
 * `__init__` or `__main__`.
 *
 * @param segment - one segment of a dotted module name.
 * @returns true when it starts with `_` and isn't a dunder.
 */
export function isPrivateSegment(segment: string): boolean {
  return segment.startsWith("_") && !DUNDER.test(segment);
}

/**
 * Finds the package a module is private to: the parent of its deepest
 * private segment below the top-level package. The deepest one decides,
 * since a module inside that package is inside every package above it too.
 *
 * @param module - a dotted first-party module name.
 * @returns the package, e.g. `app.users.services` for
 *   `app.users.services._user`; undefined when the module is public.
 */
export function privateTo(module: string): string | undefined {
  const segments = module.split(".");
  for (let i = segments.length - 1; i >= 1; i -= 1) {
    if (isPrivateSegment(segments[i] ?? "")) {
      return segments.slice(0, i).join(".");
    }
  }
  return undefined;
}
