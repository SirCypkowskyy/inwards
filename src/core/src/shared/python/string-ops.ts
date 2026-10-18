/**
 * @file The string operations Python applies to constants, computed the way CPython
 * computes them: `%` formatting, `str.format`, format specs, slicing and
 * repetition. `literals.ts` folds a constant expression with these once it has
 * read the operands.
 *
 * Only the subset whose result is certain is supported: `%s`, plain `{}`
 * fields with `!s`, and the fill, alignment, width and precision of a `str`
 * format spec. Anything else (other conversions, `!r`, numeric formats,
 * attribute or index lookups in a field) returns null, which leaves the
 * expression unread rather than guessed. No parsing of Python here: the caller
 * passes values.
 */

/** Longest folded value; a bigger `"x" * n` or width is left unread. */
const MAX_LENGTH = 100_000;

/**
 * Repeats a value, as `s * n` does.
 *
 * @param value - the string.
 * @param times - the count; zero or less gives "".
 * @returns the repeated string, or null when it would exceed the length cap.
 */
export function repeated(value: string, times: number): string | null {
  if (times <= 0) {
    return "";
  }
  return value.length * times > MAX_LENGTH ? null : value.repeat(times);
}

/**
 * Slices a string by code points, with Python's rules for negative and
 * missing bounds and for steps.
 *
 * @param value - the string.
 * @param start - the start bound, or null when omitted.
 * @param stop - the stop bound, or null when omitted.
 * @param step - the step, or null when omitted.
 * @returns the slice, or null for a zero step (a ValueError in Python).
 */
export function sliced(
  value: string,
  start: number | null,
  stop: number | null,
  step: number | null,
): string | null {
  const chars = Array.from(value);
  const by = step ?? 1;
  if (by === 0) {
    return null;
  }
  const out: string[] = [];
  const from = clamp(start, chars.length, by, by > 0 ? 0 : chars.length - 1);
  const to = clamp(stop, chars.length, by, by > 0 ? chars.length : -1);
  for (let i = from; by > 0 ? i < to : i > to; i += by) {
    out.push(chars[i] ?? "");
  }
  return out.join("");
}

/**
 * Clamps a slice bound the way `slice.indices` does.
 *
 * @param bound - the bound as written, or null when omitted.
 * @param length - the string's length in code points.
 * @param step - the slice's step, not zero.
 * @param fallback - the index a missing bound stands for.
 * @returns the index to start or stop at.
 */
function clamp(bound: number | null, length: number, step: number, fallback: number): number {
  if (bound === null) {
    return fallback;
  }
  const at = bound < 0 ? bound + length : bound;
  return step > 0 ? Math.min(Math.max(at, 0), length) : Math.min(Math.max(at, -1), length - 1);
}

/** A `str` format spec without a sign, `#`, `0`, grouping or a non-`s` type. */
const STR_SPEC =
  /^(?:(?<fill>[\s\S])?(?<align>[<>^]))?(?<width>[1-9]\d*)?(?:\.(?<precision>\d+))?s?$/u;

/**
 * Applies a format spec to a string, as `format(value, spec)` does.
 *
 * @param value - the string.
 * @param spec - the text after `:` in a replacement field.
 * @returns the formatted string, or null for a spec outside the supported subset.
 */
export function formatted(value: string, spec: string): string | null {
  const groups = STR_SPEC.exec(spec)?.groups;
  if (!groups) {
    return null;
  }
  const precision = groups["precision"];
  const chars = Array.from(value);
  const kept = precision === undefined ? chars : chars.slice(0, Number(precision));
  const width = Number(groups["width"] ?? "0");
  if (width > MAX_LENGTH) {
    return null;
  }
  const pad = Math.max(width - kept.length, 0);
  const fill = groups["fill"] ?? " ";
  const text = kept.join("");
  switch (groups["align"]) {
    case ">":
      return fill.repeat(pad) + text;
    case "^": {
      const left = Math.floor(pad / 2);
      return fill.repeat(left) + text + fill.repeat(pad - left);
    }
    default:
      return text + fill.repeat(pad);
  }
}

/** One `%` directive: `%%`, or a conversion with optional flags, width and precision. */
const PERCENT = /%(?:%|[^%]*?[a-zA-Z%])/gu;

/**
 * Formats a template with `%`, as `template % args` does, for `%s` and `%%` only.
 *
 * @param template - the left operand.
 * @param args - the right operand's values: one for a single string, one per tuple entry.
 * @returns the formatted string, or null for another directive or a count mismatch.
 */
export function percentFormatted(template: string, args: readonly string[]): string | null {
  let next = 0;
  let failed = false;
  const out = template.replace(PERCENT, (directive) => {
    if (directive === "%%") {
      return "%";
    }
    const arg = directive === "%s" ? args[next] : undefined;
    next += 1;
    failed ||= arg === undefined;
    return arg ?? "";
  });
  return failed || next !== args.length ? null : out;
}

/** One replacement field of `str.format`, or a doubled brace. */
const FIELD =
  /\{\{|\}\}|\{(?<name>[^{}!:]*)(?:!(?<conversion>[^{}:]))?(?::(?<spec>[^{}]*))?\}|[{}]/gu;
const INDEX = /^\d+$/u;
const IDENTIFIER = /^[A-Za-z_]\w*$/u;

/**
 * Formats a template with `str.format`: `{}`, `{0}` and `{name}` fields, the
 * `!s` conversion, and a `str` format spec.
 *
 * @param template - the string `format` is called on.
 * @param positional - the positional arguments.
 * @param keyword - the keyword arguments.
 * @returns the formatted string, or null for a field, conversion or spec outside that subset.
 */
export function braceFormatted(
  template: string,
  positional: readonly string[],
  keyword: ReadonlyMap<string, string>,
): string | null {
  const names = [...template.matchAll(FIELD)].flatMap((m) => {
    const name = m.groups?.["name"];
    return name === undefined ? [] : [name];
  });
  if (names.includes("") && names.some((name) => INDEX.test(name))) {
    return null; // mixing `{}` and `{0}` is a ValueError
  }
  let auto = 0;
  let failed = false;
  const out = template.replace(FIELD, (match, ...rest: unknown[]) => {
    if (match === "{{" || match === "}}") {
      return match.charAt(0);
    }
    const last = rest.at(-1);
    const g = isRecord(last) ? last : {};
    const name = g["name"];
    let value: string | null = null;
    if (name === "") {
      value = positional[auto] ?? null;
      auto += 1;
    } else if (name !== undefined) {
      value = namedArgument(name, positional, keyword);
    }
    const text = value === null ? null : fieldText(value, g["conversion"], g["spec"] ?? "");
    failed ||= text === null;
    return text ?? "";
  });
  return failed ? null : out;
}

/**
 * Looks up a numbered or named field's argument.
 *
 * @param name - the field name: digits or an identifier.
 * @param positional - the positional arguments.
 * @param keyword - the keyword arguments.
 * @returns the argument, or null for a missing one or a name with `.` or `[`.
 */
function namedArgument(
  name: string,
  positional: readonly string[],
  keyword: ReadonlyMap<string, string>,
): string | null {
  if (INDEX.test(name)) {
    return positional[Number(name)] ?? null;
  }
  return IDENTIFIER.test(name) ? (keyword.get(name) ?? null) : null;
}

/**
 * Converts and formats one field's value.
 *
 * @param value - the argument.
 * @param conversion - the conversion letter after `!`, if any.
 * @param spec - the format spec after `:`.
 * @returns the text, or null for `!r`, `!a` or an unsupported spec.
 */
function fieldText(value: string, conversion: string | undefined, spec: string): string | null {
  return conversion === undefined || conversion === "s" ? formatted(value, spec) : null;
}

/**
 * Tells whether a replace callback's last argument is its named-groups object.
 *
 * @param value - the last argument passed to the callback.
 * @returns true when it is a record of group names to matched text.
 */
function isRecord(value: unknown): value is Record<string, string | undefined> {
  return typeof value === "object" && value !== null;
}
