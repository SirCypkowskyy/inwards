/**
 * @file Every rule's options table, `[tool.inwards.rules.<rule-name>]`: one
 * spec per rule, mapping each key the table may hold to the parser that
 * checks its value. `modules` is every rule's; a rule without its own entry
 * takes `modules` only. The config parser, its error messages and the schema
 * test all read these specs, so a new option is one line here (plus its
 * schema entry and docs). Values are kept as the TOML gave them, by key; each
 * rule reads its own with typed defaults. This module only validates, apart
 * from `stringList` and `libraryDenies`, which read a list back with its type.
 */
import { isSelector, selectorProblem } from "./layer-selector.ts";
import { boolean, isStringList, listMatching, listOf, oneOf, suffix } from "./option-parsers.ts";
import { ConfigError, isDottedName, isRecord, rejectUnknownKeys } from "./toml.ts";

/**
 * One entry of `[tool.inwards.rules.pure-domain].deny` (INW005, #219): the
 * modules its entries match may not import its libraries, whichever layer
 * owns them, or none.
 */
export interface LibraryDeny {
  /** Module prefixes or selectors, in the grammar of `layers[].modules`. */
  readonly modules: readonly string[];
  /** Import names such as `django` or `http.client`; each covers its submodules. */
  readonly libraries: readonly string[];
}

/** A validated option value, as the TOML gave it. */
export type OptionValue = string | number | boolean | readonly string[] | readonly LibraryDeny[];

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
 * `layers[].modules`: `modules` in every table, FAPI003's `allow-unmounted`,
 * INW015's `role` and `allowed-in`. INW013's `follow-modules` may be empty.
 *
 * @param value - the raw list.
 * @param where - the key's dotted path.
 * @param empty - true when `[]` is allowed.
 * @returns the entries as written.
 * @throws {ConfigError} naming the first bad entry, or when the list is empty (unless allowed) or not a list of strings.
 */
function moduleEntries(value: unknown, where: string, empty = false): string[] {
  if (!(isStringList(value) && (empty || value.length > 0))) {
    throw new ConfigError(
      `${where} must be a ${empty ? "" : "non-empty "}list of module prefixes or selectors, such as ["shop.domain", "shop.*.api"].`,
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

/** The highest threshold INW012 accepts; a larger one would turn the signal off in all but name. */
const MAX_LIMIT = 1000;

/** A qualified-name pattern: dotted identifiers, with fnmatch's `*` and `?`. */
const NAME_PATTERN = /^[\p{XID_Continue}*?]+(?:\.[\p{XID_Continue}*?]+)*$/u;

/** A Python identifier. */
const IDENTIFIER = /^[\p{XID_Start}_]\p{XID_Continue}*$/u;

/**
 * Parses one of INW012's thresholds: an integer from 0 to `MAX_LIMIT`, or
 * `false` to turn the signal off.
 *
 * @param value - the raw value.
 * @param where - the key's dotted path.
 * @returns the integer, or false.
 * @throws {ConfigError} for anything else.
 */
function limit(value: unknown, where: string): number | false {
  const ok =
    value === false ||
    (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MAX_LIMIT);
  if (!ok) {
    throw new ConfigError(
      `${where} must be an integer from 0 to ${MAX_LIMIT}, or false to turn the check off.`,
    );
  }
  return value;
}

/**
 * Parses INW012's `delegate-to`: a non-empty list of layer names or module
 * prefixes and selectors. Which entries name a layer is known only once the
 * layers are parsed, so `delegateProblem` checks the rest then.
 *
 * @param value - the raw list.
 * @param where - the key's dotted path.
 * @returns the entries as written.
 * @throws {ConfigError} when the list is empty or holds a blank or non-string entry.
 */
function delegateTargets(value: unknown, where: string): string[] {
  if (!(isStringList(value) && value.length > 0 && value.every((e) => e.trim() !== ""))) {
    throw new ConfigError(
      `${where} must be a non-empty list of layer names or module prefixes and selectors, such as ["application"] or ["shop.*.service"].`,
    );
  }
  return value;
}

/**
 * Checks the `delegate-to` entries that name no layer: each must then be a
 * module prefix or selector, as in `layers[].modules`.
 *
 * @param entries - the entries as parsed.
 * @param layerNames - the names of the configured layers.
 * @returns the error message for the first bad entry, or undefined when all are fine.
 */
export function delegateProblem(
  entries: readonly string[],
  layerNames: ReadonlySet<string>,
): string | undefined {
  for (const entry of entries) {
    let problem = isSelector(entry) ? selectorProblem(entry) : undefined;
    if (!(layerNames.has(entry) || isSelector(entry) || isDottedName(entry))) {
      problem = "it names no layer and isn't a dotted module name";
    }
    if (problem !== undefined && !layerNames.has(entry)) {
      return `tool.inwards.rules.thin-endpoint.delegate-to: "${entry}" is not a layer name, module prefix or selector: ${problem}.`;
    }
  }
  return undefined;
}

/** Qualified names with fnmatch wildcards: INW012's calls, types and decorators, INW013's calls and types. */
const namePatterns = listMatching(
  NAME_PATTERN,
  'qualified names, with * and ? as wildcards, such as "httpx.*" or "sqlalchemy.orm.Session"',
);

/** The keys of one entry of INW005's `deny`. */
const DENY_KEYS: ReadonlySet<string> = new Set(["modules", "libraries"]);

/**
 * Parses INW005's `deny`: a list of tables, each with a non-empty `modules`
 * (as in every options table) and a non-empty `libraries` (import names, as
 * in a layer's `deny-libraries`).
 *
 * @param value - the raw list.
 * @param where - the key's dotted path.
 * @returns the entries, in the order written.
 * @throws {ConfigError} naming the entry and key that is missing, unknown or malformed.
 */
function denyEntries(value: unknown, where: string): LibraryDeny[] {
  const example = '{ modules = ["shop.billing"], libraries = ["django"] }';
  if (!Array.isArray(value)) {
    throw new ConfigError(`${where} must be a list of tables such as ${example}.`);
  }
  return value.map((entry: unknown, i): LibraryDeny => {
    const at = `${where}[${i}]`;
    if (!isRecord(entry) || Array.isArray(entry)) {
      throw new ConfigError(`${at} must be a table such as ${example}.`);
    }
    rejectUnknownKeys(entry, DENY_KEYS, at);
    const libraries = entry["libraries"];
    if (!(Array.isArray(libraries) && libraries.length > 0 && libraries.every(isDottedName))) {
      throw new ConfigError(
        `${at}.libraries must be a non-empty list of import names such as "django" or "http.client": no globs, and no distribution names like "python-dateutil".`,
      );
    }
    return { modules: moduleEntries(entry["modules"], `${at}.modules`), libraries };
  });
}

/** The keys every rule's table may hold. */
const SHARED: Readonly<Record<string, OptionParser>> = { modules: moduleEntries };

/** Each rule's own options, by rule name, then by key. */
const RULE_OPTIONS: Readonly<Record<string, Readonly<Record<string, OptionParser>>>> = {
  "pure-domain": { deny: denyEntries },
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
  "thin-endpoint": {
    "max-statements": limit,
    "max-branches": limit,
    "max-nesting": limit,
    "allow-loops": boolean,
    "allow-comprehensions": boolean,
    "deny-calls": namePatterns,
    "extend-deny-calls": namePatterns,
    "deny-receiver-types": namePatterns,
    "deny-receiver-params": listMatching(IDENTIFIER, 'parameter names such as "db"'),
    "delegate-to": delegateTargets,
    decorators: namePatterns,
    frameworks: listOf(["fastapi", "flask", "litestar", "django"]),
    "base-classes": namePatterns,
  },
  "async-blocking": {
    "extend-blocking-calls": namePatterns,
    "extend-blocking-types": namePatterns,
    "follow-modules": (value: unknown, where: string): string[] =>
      moduleEntries(value, where, true),
  },
  "construct-only-in": { role: moduleEntries, "allowed-in": moduleEntries },
  "orm-naming": {
    "table-name": oneOf(["snake", "snake_singular", false]),
    "datetime-suffix": suffix,
    "date-suffix": suffix,
    "allow-tables": listMatching(/\S/u, 'table names such as "news" or "user_settings"'),
    "require-naming-convention": boolean,
  },
  "router-wiring": {
    entrypoints,
    "allow-unmounted": moduleEntries,
    "unresolved-includes": oneOf(["warn", "silent"]),
    "check-order": boolean,
  },
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

/**
 * Reads INW005's `deny` back from a parsed options table.
 *
 * @param options - `[tool.inwards.rules.pure-domain]` as parsed, if set.
 * @returns the entries, none when the key is absent.
 */
export function libraryDenies(
  options: Readonly<Record<string, OptionValue | undefined>> | undefined,
): LibraryDeny[] {
  const value = options?.["deny"];
  const entries: LibraryDeny[] = [];
  for (const entry of typeof value === "object" ? value : []) {
    if (typeof entry === "object") {
      entries.push(entry);
    }
  }
  return entries;
}

/**
 * Reads a list-of-strings option back from a parsed options table: `modules`
 * or a rule's own list. Only INW005's `deny` holds tables instead.
 *
 * @param value - the stored value, if any.
 * @returns the strings, or undefined when the value is absent or not a list of strings.
 */
export function stringList(value: OptionValue | undefined): readonly string[] | undefined {
  if (typeof value !== "object") {
    return undefined;
  }
  const strings = [...value].filter((entry): entry is string => typeof entry === "string");
  return strings.length === value.length ? strings : undefined;
}
