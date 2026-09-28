/**
 * @file Every rule's options table, `[tool.inwards.rules.<rule-name>]`: one
 * spec per rule, mapping each key the table may hold to the parser that
 * checks its value. `modules` is every rule's; a rule without its own entry
 * takes `modules` only. The config parser, its error messages and the schema
 * test all read these specs, so a new option is one line here (plus its
 * schema entry and docs). Values are kept as the TOML gave them, by key; each
 * rule reads its own with typed defaults. This module only validates.
 */
import { isSelector, selectorProblem } from "./layer-selector.ts";
import { ConfigError, isDottedName } from "./toml.ts";

/** A validated option value, as the TOML gave it. */
export type OptionValue = string | number | boolean | readonly string[];

/**
 * Checks one raw value and returns it as stored.
 *
 * @param value - the raw TOML value.
 * @param where - the key's dotted path, for the error message.
 * @returns the value to store.
 * @throws {ConfigError} naming the key when the value isn't allowed.
 */
type OptionParser = (value: unknown, where: string) => OptionValue;

/** HTTP methods FastAPI declares path operations for, lower-case. */
const HTTP_METHODS: readonly string[] = [
  "get",
  "post",
  "put",
  "delete",
  "patch",
  "options",
  "head",
  "trace",
];

/** The deepest `max-depth` FAPI002 accepts: each level is a lazy read per helper. */
const MAX_DEPTH = 8;

/** An entrypoint: a dotted module, a colon, and a name, e.g. `app.main:app`. */
const ENTRYPOINT =
  /^[\p{XID_Start}_]\p{XID_Continue}*(?:\.[\p{XID_Start}_]\p{XID_Continue}*)*:[\p{XID_Start}_]\p{XID_Continue}*$/u;

/**
 * Tells whether a raw value is a list of strings.
 *
 * @param value - a raw TOML value.
 * @returns true for an array whose entries are all strings, empty included.
 */
function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((e) => typeof e === "string");
}

/**
 * Parses `true` or `false`.
 *
 * @param value - the raw value.
 * @param where - the key's dotted path.
 * @returns the value, unchanged.
 * @throws {ConfigError} for anything else.
 */
function boolean(value: unknown, where: string): boolean {
  if (typeof value !== "boolean") {
    throw new ConfigError(`${where} must be true or false.`);
  }
  return value;
}

/**
 * Makes a parser for one of a few literal values.
 *
 * @param values - the allowed values.
 * @returns the parser.
 */
function oneOf(values: readonly (string | boolean)[]): OptionParser {
  return (value: unknown, where: string): OptionValue => {
    if (!((typeof value === "string" || typeof value === "boolean") && values.includes(value))) {
      const listed = values.map((v) => JSON.stringify(v)).join(", ");
      throw new ConfigError(`${where} must be one of ${listed}.`);
    }
    return value;
  };
}

/**
 * Makes a parser for a list of distinct strings drawn from a fixed set, empty included.
 *
 * @param values - the allowed entries.
 * @returns the parser.
 */
function listOf(values: readonly string[]): OptionParser {
  return (value: unknown, where: string): OptionValue => {
    const ok = isStringList(value) && value.every((e) => values.includes(e));
    if (!ok || new Set(value).size !== value.length) {
      const listed = values.map((v) => `"${v}"`).join(", ");
      throw new ConfigError(`${where} must be a list of distinct entries from ${listed}.`);
    }
    return value;
  };
}

/**
 * Parses an integer from 0 to `MAX_DEPTH`.
 *
 * @param value - the raw value.
 * @param where - the key's dotted path.
 * @returns the integer.
 * @throws {ConfigError} for anything else.
 */
function depth(value: unknown, where: string): number {
  if (!(typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MAX_DEPTH)) {
    throw new ConfigError(`${where} must be an integer from 0 to ${MAX_DEPTH}.`);
  }
  return value;
}

/**
 * Parses a non-empty list of module prefixes or selectors, checked like
 * `layers[].modules`: `modules` in every table, and FAPI003's `allow-unmounted`.
 *
 * @param value - the raw list.
 * @param where - the key's dotted path.
 * @returns the entries as written.
 * @throws {ConfigError} naming the first bad entry, or when the list is empty or not a list of strings.
 */
function moduleEntries(value: unknown, where: string): string[] {
  if (!(isStringList(value) && value.length > 0)) {
    throw new ConfigError(
      `${where} must be a non-empty list of module prefixes or selectors, such as ["shop.domain", "shop.*.api"].`,
    );
  }
  for (const entry of value) {
    let problem = isSelector(entry) ? selectorProblem(entry) : undefined;
    if (!(isSelector(entry) || isDottedName(entry))) {
      problem = "it isn't a dotted module name";
    }
    if (problem !== undefined) {
      throw new ConfigError(`${where}: "${entry}" is not a module prefix or selector: ${problem}.`);
    }
  }
  return value;
}

/**
 * Parses a non-empty list of `module:name` entrypoints.
 *
 * @param value - the raw list.
 * @param where - the key's dotted path.
 * @returns the entries.
 * @throws {ConfigError} when the list is empty or an entry isn't `module:name`.
 */
function entrypoints(value: unknown, where: string): string[] {
  if (!(isStringList(value) && value.length > 0 && value.every((e) => ENTRYPOINT.test(e)))) {
    throw new ConfigError(
      `${where} must be a non-empty list of "module:name" entries, such as ["app.main:app"].`,
    );
  }
  return value;
}

/** The keys every rule's table may hold. */
const SHARED: Readonly<Record<string, OptionParser>> = { modules: moduleEntries };

/** Each rule's own options, by rule name, then by key. */
const RULE_OPTIONS: Readonly<Record<string, Readonly<Record<string, OptionParser>>>> = {
  "endpoint-metadata": {
    "require-summary": oneOf(["summary-or-docstring", "summary", false]),
    "require-response-model": boolean,
    "require-status-code": listOf(HTTP_METHODS),
    "require-response-fields": listOf(["description", "model", "content"]),
    "require-tags": boolean,
    "require-operation-id": boolean,
  },
  "undocumented-error-response": {
    codes: oneOf(["4xx", "4xx-5xx"]),
    "max-depth": depth,
    "report-direct-raises": boolean,
    "handled-counts-as-documented": boolean,
    "explicit-422": oneOf(["ignore", "report"]),
  },
  "router-wiring": {
    entrypoints,
    "allow-unmounted": moduleEntries,
    "unresolved-includes": oneOf(["warn", "silent"]),
    "check-order": boolean,
  },
  "depends-called": { "check-defaults": boolean },
};

/**
 * Lists the keys a rule's options table may hold.
 *
 * @param rule - the rule's kebab-case name.
 * @returns `modules` and the rule's own keys.
 */
export function optionKeys(rule: string): ReadonlySet<string> {
  return new Set([...Object.keys(SHARED), ...Object.keys(RULE_OPTIONS[rule] ?? {})]);
}

/**
 * Validates a rule's options table, keys already known to `optionKeys`.
 *
 * @param rule - the rule's kebab-case name.
 * @param table - the raw options table.
 * @param where - the table's dotted path, for messages.
 * @returns the options, by key, in key order.
 * @throws {ConfigError} naming the first key whose value the rule doesn't accept.
 */
export function parseOptions(
  rule: string,
  table: Record<string, unknown>,
  where: string,
): Record<string, OptionValue> {
  const parsers = { ...SHARED, ...RULE_OPTIONS[rule] };
  const options: Record<string, OptionValue> = {};
  for (const key of Object.keys(table).sort()) {
    const parse = parsers[key];
    if (parse !== undefined) {
      options[key] = parse(table[key], `${where}.${key}`);
    }
  }
  return options;
}
