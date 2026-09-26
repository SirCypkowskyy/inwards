/**
 * `[[tool.inwards.shape]]` and `[[tool.inwards.names]]`: which members a
 * package may, must and must not hold, and where a member name may appear.
 *
 * Package selectors use import-linter's grammar (ADR-018): `a.b` is exact,
 * `a.*` is one segment, `a.**` is any depth below `a`. Member patterns are
 * fnmatch globs (`*`, `?`, `[seq]`, `[!seq]`): `name` is a module or a
 * subpackage, `name/` a subpackage only, `name.py` a module only.
 */

import { ConfigError, isRecord, rejectUnknownKeys } from "./toml.ts";
import type { Severity } from "./types.ts";

/** One `[[tool.inwards.shape]]` entry. */
export interface ShapeSpec {
  /** Package selectors. The first entry with a matching selector applies. */
  packages: string[];
  /** Members the packages may hold besides `require` and `__init__`; absent means any. */
  allow?: string[];
  /** Members every selected package must hold (INW008). */
  require?: string[];
  /** Members no selected package may hold. */
  forbid?: string[];
  /** Severity of a member `allow` doesn't cover (`extra`, default error). */
  extra: Severity;
}

/** One `[[tool.inwards.names]]` entry: members matching `pattern` belong only in `onlyIn`. */
export interface NameRule {
  pattern: string;
  /** Package selectors (`only-in`). */
  onlyIn: string[];
}

const SHAPE_KEYS: ReadonlySet<string> = new Set([
  "packages",
  "allow",
  "require",
  "forbid",
  "extra",
]);
const NAME_KEYS: ReadonlySet<string> = new Set(["pattern", "only-in"]);
/** A member name as a directory lists it: `x.py`, `x.pyi` or `x/`. */
const MEMBER = /^(?<stem>[^/]+?)(?<kind>\.pyi?|\/)$/u;
/** A member pattern: a glob stem, optionally ending in `.py` or `/`. */
const PATTERN = /^(?<stem>[^/.]+)(?<kind>\.py|\/)?$/u;
/** A Python identifier: one segment of a package name. */
const IDENTIFIER = /^[\p{L}_][\p{L}\p{N}_]*$/u;
/** Stands for one package segment no selector names, when comparing two selectors. */
const ANY_SEGMENT = "\u0001";
/** Up to how many segments `**` is tried with when comparing two selectors. */
const MAX_DEPTH = 3;
/** fnmatch characters that mean something in a regular expression but not in a glob. */
const REGEX_ONLY = /[.+^${}()|\\]/gu;

/**
 * Reads the optional `shape` and `names` arrays of `[tool.inwards]`.
 *
 * @param raw - the parsed `[tool.inwards]` table.
 * @returns the keys that are set.
 * @throws {ConfigError} naming the first bad entry, or an exact selector an earlier glob hides.
 */
export function parseShapeKeys(raw: Record<string, unknown>): {
  shape?: ShapeSpec[];
  names?: NameRule[];
} {
  const { shape, names } = raw;
  const shapes = shape === undefined ? undefined : tables(shape, "shape").map(parseShape);
  if (shapes !== undefined) {
    rejectShadowed(shapes);
  }
  const rules = names === undefined ? undefined : tables(names, "names").map(parseName);
  return {
    ...(shapes === undefined ? {} : { shape: shapes }),
    ...(rules === undefined ? {} : { names: rules }),
  };
}

/**
 * Tells whether a package selector matches a package.
 *
 * @param selector - e.g. `app.*` or `app.**.tests`.
 * @param pkg - a dotted package name.
 * @returns true when every segment matches, `*` one segment and `**` one or more.
 */
export function selects(selector: string, pkg: string): boolean {
  return pkg !== "" && matchSegments(selector.split("."), pkg.split("."));
}

/**
 * Tells whether a member pattern matches a member.
 *
 * @param pattern - e.g. `service`, `tests/` or `test_*.py`.
 * @param member - a listed member: `service.py`, `models.pyi` or `tests/`.
 * @returns true when the stems match and the kinds agree.
 */
export function memberMatches(pattern: string, member: string): boolean {
  const want = PATTERN.exec(pattern)?.groups;
  const have = MEMBER.exec(member)?.groups;
  if (!(want?.["stem"] && have?.["stem"])) {
    return false;
  }
  const dir = have["kind"] === "/";
  const kind = want["kind"];
  if ((kind === "/" && !dir) || (kind === ".py" && dir)) {
    return false;
  }
  return globRegex(want["stem"]).exec(have["stem"]) !== null;
}

/**
 * Finds the shape that applies to a package: the first entry that selects it.
 *
 * @param shapes - the configured shapes.
 * @param pkg - a dotted package name.
 * @returns the shape, or undefined when none selects the package.
 */
export function shapeFor(shapes: readonly ShapeSpec[], pkg: string): ShapeSpec | undefined {
  return shapes.find((shape) => shape.packages.some((selector) => selects(selector, pkg)));
}

/**
 * Matches selector segments against name segments, `**` taking one or more.
 *
 * @param selector - the selector's segments.
 * @param name - the package's segments.
 * @returns true on a full match.
 */
function matchSegments(selector: readonly string[], name: readonly string[]): boolean {
  const [head, ...rest] = selector;
  if (head === undefined) {
    return name.length === 0;
  }
  if (head === "**") {
    return name.some((_, i) => matchSegments(rest, name.slice(i + 1)));
  }
  return (
    name.length > 0 && (head === "*" || head === name[0]) && matchSegments(rest, name.slice(1))
  );
}

/**
 * Turns an fnmatch glob into an anchored regular expression.
 *
 * @param glob - e.g. `test_*`.
 * @returns the expression.
 */
function globRegex(glob: string): RegExp {
  const source = glob
    .replace(REGEX_ONLY, "\\$&")
    .replaceAll("*", ".*")
    .replaceAll("?", ".")
    .replaceAll("[!", "[^");
  return new RegExp(`^${source}$`, "u");
}

/**
 * Checks that a key holds an array of tables.
 *
 * @param value - the raw `shape` or `names` value.
 * @param key - the key, for messages.
 * @returns the tables.
 * @throws {ConfigError} when it isn't an array of tables.
 */
function tables(value: unknown, key: string): Record<string, unknown>[] {
  if (!(Array.isArray(value) && value.every(isRecord))) {
    throw new ConfigError(
      `tool.inwards.${key} must be an array of tables ([[tool.inwards.${key}]]).`,
    );
  }
  return value;
}

/**
 * Validates one `[[tool.inwards.shape]]` entry.
 *
 * @param entry - the raw table.
 * @param i - its index, for messages.
 * @returns the shape.
 * @throws {ConfigError} naming the bad key.
 */
function parseShape(entry: Record<string, unknown>, i: number): ShapeSpec {
  const where = `tool.inwards.shape[${i}]`;
  rejectUnknownKeys(entry, SHAPE_KEYS, where);
  const { extra = "error" } = entry;
  if (extra !== "error" && extra !== "warning") {
    throw new ConfigError(`${where}.extra must be "error" or "warning".`);
  }
  const shape: ShapeSpec = { packages: selectors(entry["packages"], `${where}.packages`), extra };
  for (const key of ["allow", "require", "forbid"] as const) {
    if (entry[key] !== undefined) {
      shape[key] = patterns(entry[key], `${where}.${key}`);
    }
  }
  return shape;
}

/**
 * Validates one `[[tool.inwards.names]]` entry.
 *
 * @param entry - the raw table.
 * @param i - its index, for messages.
 * @returns the rule.
 * @throws {ConfigError} naming the bad key.
 */
function parseName(entry: Record<string, unknown>, i: number): NameRule {
  const where = `tool.inwards.names[${i}]`;
  rejectUnknownKeys(entry, NAME_KEYS, where);
  const { pattern } = entry;
  if (typeof pattern !== "string") {
    throw new ConfigError(`${where}.pattern must be one member pattern, such as "test_*".`);
  }
  patterns([pattern], `${where}.pattern`);
  return { pattern, onlyIn: selectors(entry["only-in"], `${where}.only-in`) };
}

/**
 * Validates a non-empty list of package selectors.
 *
 * @param value - the raw list.
 * @param where - the key's dotted path.
 * @returns the selectors.
 * @throws {ConfigError} when the list is empty or a selector is malformed.
 */
function selectors(value: unknown, where: string): string[] {
  const list = strings(value, where);
  const bad = list.find((s) =>
    s.split(".").some((seg) => seg !== "*" && seg !== "**" && !IDENTIFIER.test(seg)),
  );
  if (list.length === 0 || bad !== undefined) {
    throw new ConfigError(
      `${where} must list package selectors: a.b (exact), a.* (one level) or a.** (any depth)${bad === undefined ? "" : `, not "${bad}"`}.`,
    );
  }
  return list;
}

/**
 * Validates a list of member patterns.
 *
 * @param value - the raw list.
 * @param where - the key's dotted path.
 * @returns the patterns.
 * @throws {ConfigError} naming a pattern that isn't `name`, `name/` or `name.py`.
 */
function patterns(value: unknown, where: string): string[] {
  const list = strings(value, where);
  const bad = list.find((p) => !(PATTERN.test(p) && validGlob(p)));
  if (bad !== undefined) {
    throw new ConfigError(
      `${where}: "${bad}" is not a member pattern. Use name (module or subpackage), name/ or name.py.`,
    );
  }
  return list;
}

/**
 * Tells whether a pattern's glob compiles.
 *
 * @param pattern - a member pattern.
 * @returns false for an unbalanced `[`.
 */
function validGlob(pattern: string): boolean {
  try {
    globRegex(pattern);
    return true;
  } catch {
    return false;
  }
}

/**
 * Checks that a value is a list of non-empty strings.
 *
 * @param value - the raw value.
 * @param where - the key's dotted path.
 * @returns the list.
 * @throws {ConfigError} otherwise.
 */
function strings(value: unknown, where: string): string[] {
  if (!(Array.isArray(value) && value.every((s) => typeof s === "string" && s !== ""))) {
    throw new ConfigError(`${where} must be a list of non-empty strings.`);
  }
  return value;
}

/**
 * Throws when a selector can never apply: an earlier entry's selector already
 * matches every package it matches, so the first-match rule would always pick
 * the earlier shape. That covers an exact entry after a glob (`app.*` then
 * `app.orders`), a repeated selector, and a glob inside an earlier one
 * (`app.**` then `app.*`).
 *
 * @param shapes - the parsed shapes, in order.
 * @throws {ConfigError} naming both entries.
 */
function rejectShadowed(shapes: readonly ShapeSpec[]): void {
  shapes.forEach((shape, i) => {
    for (const selector of shape.packages) {
      const earlier = shapes
        .slice(0, i)
        .findIndex((s) => s.packages.some((g) => covers(g, selector)));
      if (earlier === -1) {
        continue;
      }
      const where = `tool.inwards.shape[${i}]`;
      throw new ConfigError(
        shapes[earlier]?.packages.includes(selector)
          ? `${where} repeats "${selector}" from shape[${earlier}]. The first match wins, so the second can never apply; remove it.`
          : `${where} selects "${selector}", but shape[${earlier}] already matches every package it does and the first match wins. Put the narrower entry first.`,
      );
    }
  });
}

/**
 * Tells whether one selector matches every package another matches. Each `*`
 * of the narrower one is tried as a segment no selector names, and each `**`
 * as 1, 2 and 3 such segments.
 *
 * @param wide - the earlier selector.
 * @param narrow - the later one.
 * @returns true when `wide` matches all of `narrow`'s packages.
 */
function covers(wide: string, narrow: string): boolean {
  return Array.from({ length: MAX_DEPTH }, (_, i) => i + 1).every((depth) => {
    const expanded = narrow
      .split(".")
      .flatMap((seg) => {
        if (seg === "**") {
          return Array.from({ length: depth }, () => ANY_SEGMENT);
        }
        return [seg === "*" ? ANY_SEGMENT : seg];
      })
      .join(".");
    return selects(wide, expanded);
  });
}
