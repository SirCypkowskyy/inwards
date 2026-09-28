/**
 * @file Per-rule configuration, `[tool.inwards.rules]`: which rules report
 * (`select`, `extend-select`, `ignore`), at what severity (`severity`), and
 * each rule's options table, `[tool.inwards.rules.<rule-name>]`, so a team can
 * phase rules in and turn opt-in rules on. Codes are exact; an unknown one is
 * a config error. INW000 can't be ignored, re-levelled or scoped: a file whose
 * declared encoding can hide imports is not checked at all, so turning INW000
 * off would hide that file entirely (ADR-027).
 *
 * Every core function that returns diagnostics to an adapter applies these
 * settings (`applyRules`), so the CLI, the hooks, the Stop gate and the
 * language server agree. The exception is the session layout comparison in
 * `rules/unassigned-module/layout.ts`: it stops a layer being moved away, so it ignores the table.
 */

import type { Diagnostic, Severity, SourceFile } from "../contracts/records.ts";
import { diagnostic, RULES, ruleFor } from "../meta/registry.ts";
import { isSelector, matchEntry, selectorProblem } from "./layer-selector.ts";
import { type ConfigFile, spanOfRuleTable } from "./source-span.ts";
import { ConfigError, isDottedName, isRecord, rejectUnknownKeys } from "./toml.ts";

/** One rule's options table, `[tool.inwards.rules.<rule-name>]`, as parsed. */
export interface RuleOptions {
  /**
   * Module entries in the grammar of `layers[].modules` (ADR-034): a prefix
   * such as `shop.domain` or a selector such as `shop.*.api`. The rule
   * reports only in the modules they match.
   */
  modules?: string[];
}

/**
 * `[tool.inwards.rules]` as parsed. Plain data: the Stop gate stores configs
 * as JSON and compares them.
 */
export interface RuleSettings {
  /** Only these rules report; absent means every rule that is on by default. */
  select?: string[];
  /** These rules report too, on top of `select` or the defaults (`extend-select`). */
  extendSelect?: string[];
  /** These rules never report, whatever `select` or `extend-select` say. */
  ignore?: string[];
  /** The severity every finding of a rule gets, by code. */
  severity?: Record<string, Severity>;
  /** Each rule's options table, by rule name, sorted. */
  options?: Record<string, RuleOptions>;
}

export const RULE_KEYS: ReadonlySet<string> = new Set([
  "select",
  "extend-select",
  "ignore",
  "severity",
]);
/**
 * Keys every rule's options table may hold. No rule has options of its own
 * yet; the first one (#182) adds its keys and their validation here.
 */
export const OPTION_KEYS: ReadonlySet<string> = new Set(["modules"]);
const SEVERITIES: readonly string[] = ["error", "warning"] satisfies Severity[];
/** Always reports at its own severity, see the module comment. */
const FIXED = "INW000";

/**
 * Validates `[tool.inwards.rules]`.
 *
 * @param value - the raw `rules` value, if any.
 * @returns `{ rules }` when the table is set, else nothing.
 * @throws {ConfigError} for a key, code or severity it doesn't know, INW000 in
 *   `ignore`, `extend-select` or `severity`, an empty `select`, or a bad
 *   options table.
 */
export function parseRules(value: unknown): { rules?: RuleSettings } {
  if (value === undefined) {
    return {};
  }
  if (!isRecord(value) || Array.isArray(value)) {
    throw new ConfigError("tool.inwards.rules must be a table.");
  }
  const unknown = Object.keys(value).find(
    (key) => !(RULE_KEYS.has(key) || ruleFor(key)?.name === key),
  );
  if (unknown !== undefined) {
    throw new ConfigError(
      `Unknown key tool.inwards.rules.${unknown}. Known keys: ${[...RULE_KEYS].join(", ")}, or a rule name such as layer-dependency for that rule's options.`,
    );
  }
  const select = codeList(value["select"], "select");
  const extendSelect = codeList(value["extend-select"], "extend-select");
  const ignore = codeList(value["ignore"], "ignore");
  const severity = severities(value["severity"]);
  if (select?.length === 0) {
    throw new ConfigError(
      "tool.inwards.rules.select must list at least one rule code; to turn rules off, list them in ignore.",
    );
  }
  const options = optionTables(value);
  return {
    rules: {
      ...(select === undefined ? {} : { select }),
      ...(extendSelect === undefined ? {} : { extendSelect }),
      ...(ignore === undefined ? {} : { ignore }),
      ...(severity === undefined ? {} : { severity }),
      ...(options === undefined ? {} : { options }),
    },
  };
}

/**
 * Validates the options tables in `[tool.inwards.rules]`, the keys named after
 * a rule. Names come out sorted, so reordering the tables changes nothing.
 *
 * @param table - the raw `rules` table, keys already checked.
 * @returns options by rule name, or undefined when there are none.
 * @throws {ConfigError} for a table that isn't one, an unknown key in it
 *   (named), a bad `modules`, or a table for INW000.
 */
function optionTables(table: Record<string, unknown>): Record<string, RuleOptions> | undefined {
  const names = Object.keys(table)
    .filter((key) => !RULE_KEYS.has(key))
    .sort();
  if (names.length === 0) {
    return undefined;
  }
  const options: Record<string, RuleOptions> = {};
  for (const name of names) {
    const where = `tool.inwards.rules.${name}`;
    const raw = table[name];
    if (ruleFor(name)?.code === FIXED) {
      throw new ConfigError(
        `${where} can't be set: a file whose declared encoding can hide imports isn't checked at all, so ${FIXED} always reports it.`,
      );
    }
    if (!isRecord(raw) || Array.isArray(raw)) {
      throw new ConfigError(
        `${where} must be a table of the rule's options, such as { modules = ["shop.api.*"] }.`,
      );
    }
    rejectUnknownKeys(raw, OPTION_KEYS, where);
    options[name] =
      raw["modules"] === undefined
        ? {}
        : { modules: moduleEntries(raw["modules"], `${where}.modules`) };
  }
  return options;
}

/**
 * Validates an options table's `modules`: a non-empty list of module
 * prefixes or selectors, checked like `layers[].modules`.
 *
 * @param value - the raw list.
 * @param where - the key's dotted path, for messages.
 * @returns the entries as written.
 * @throws {ConfigError} naming the first bad entry, or when the list is empty or not a list of strings.
 */
function moduleEntries(value: unknown, where: string): string[] {
  if (!(Array.isArray(value) && value.length > 0 && value.every((e) => typeof e === "string"))) {
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
 * Validates `select`, `extend-select` or `ignore`.
 *
 * @param value - the raw list, if any.
 * @param key - which key it is, for messages.
 * @returns the codes, or undefined when the key is absent.
 * @throws {ConfigError} when it isn't a list of known codes.
 */
function codeList(
  value: unknown,
  key: "select" | "extend-select" | "ignore",
): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!(Array.isArray(value) && value.every((code): code is string => typeof code === "string"))) {
    throw new ConfigError(
      `tool.inwards.rules.${key} must be a list of rule codes such as "INW001".`,
    );
  }
  for (const code of value) {
    checkCode(code, key);
  }
  return value;
}

/**
 * Validates the `severity` table. Codes come out sorted, so reordering the
 * table changes nothing: the Stop gate compares configs as JSON, and the config
 * guard lets a reorder through.
 *
 * @param value - the raw table, if any.
 * @returns severity by code, or undefined when the key is absent.
 * @throws {ConfigError} for an unknown code or a severity other than "error" or "warning".
 */
function severities(value: unknown): Record<string, Severity> | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value) || Array.isArray(value)) {
    throw new ConfigError(
      'tool.inwards.rules.severity must be a table such as { INW006 = "warning" }.',
    );
  }
  const levels: Record<string, Severity> = {};
  for (const [code, level] of Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) {
    checkCode(code, "severity");
    if (!isSeverity(level)) {
      throw new ConfigError(`tool.inwards.rules.severity.${code} must be "error" or "warning".`);
    }
    levels[code] = level;
  }
  return levels;
}

/**
 * Throws unless a code names a registered rule this key may list.
 *
 * @param code - the code as written.
 * @param key - the key it is listed under.
 * @throws {ConfigError} for an unknown code, or INW000 outside `select`.
 */
function checkCode(code: string, key: string): void {
  if (!Object.hasOwn(RULES, code)) {
    throw new ConfigError(
      `Unknown rule code "${code}" in tool.inwards.rules.${key}. This Inwards knows ${Object.keys(RULES).join(", ")}.`,
    );
  }
  if (code === FIXED && key !== "select") {
    throw new ConfigError(
      `tool.inwards.rules.${key} can't list ${FIXED}: a file whose declared encoding can hide imports isn't checked at all, so ${FIXED} always reports it as an error.`,
    );
  }
}

/**
 * Tells whether a raw value is a severity.
 *
 * @param value - the raw value.
 * @returns true for "error" or "warning".
 */
function isSeverity(value: unknown): value is Severity {
  return typeof value === "string" && SEVERITIES.includes(value);
}

/**
 * Says what the config does to one rule's findings. A rule is on when `select`
 * lists it, or, without `select`, when it is on by default; `extend-select`
 * turns it on as well, and `ignore` turns it off whatever the rest says. An
 * options table's `modules` turns it off outside the modules it selects.
 *
 * @param code - a code such as `INW001`.
 * @param rules - the project's `[tool.inwards.rules]`, if any.
 * @param module - the module a finding is in; empty or absent (a finding in
 *   pyproject.toml, or a question about the whole rule) ignores `modules`.
 * @returns "off" when the rule doesn't report, the severity every finding
 *   gets, or undefined when the findings keep their own.
 */
export function ruleLevel(
  code: string,
  rules: RuleSettings | undefined,
  module = "",
): Severity | "off" | undefined {
  if (code === FIXED) {
    return undefined;
  }
  const { select, extendSelect = [], ignore = [], severity = {}, options = {} } = rules ?? {};
  const rule = ruleFor(code);
  const chosen = select === undefined ? rule?.default !== "off" : select.includes(code);
  const scope = rule === undefined ? undefined : options[rule.name]?.modules;
  const inScope =
    scope === undefined ||
    module === "" ||
    scope.some((entry) => matchEntry(entry, module) !== undefined);
  if (!(chosen || extendSelect.includes(code)) || ignore.includes(code) || !inScope) {
    return "off";
  }
  return Object.hasOwn(severity, code) ? severity[code] : undefined;
}

/**
 * Applies `[tool.inwards.rules]` to findings: drops those of rules that are
 * off (opt-in rules included when the table is absent) or scoped away from
 * their module, and re-levels the rest. Idempotent.
 *
 * @param found - the findings, as the rules produced them.
 * @param rules - the project's `[tool.inwards.rules]`, if any.
 * @returns the findings to report.
 */
export function applyRules(found: Diagnostic[], rules: RuleSettings | undefined): Diagnostic[] {
  return found.flatMap((d) => {
    const level = ruleLevel(d.code, rules, d.module);
    if (level === "off") {
      return [];
    }
    return level === undefined || level === d.severity ? [d] : [{ ...d, severity: level }];
  });
}

/**
 * Warns about options tables for rules that are off: they do nothing, but
 * aren't an error, so a team can stage a rule's options before turning it on.
 * Not filtered by the table itself, since the rule it names is off.
 *
 * @param rules - the project's `[tool.inwards.rules]`, if any.
 * @param file - the pyproject.toml, to point at each table.
 * @returns one warning per options table of a rule that is off, under that rule's code.
 */
export function checkRuleOptions(rules: RuleSettings | undefined, file: ConfigFile): Diagnostic[] {
  const source: SourceFile = { path: file.path, module: "", isPackage: false, text: file.text };
  return Object.keys(rules?.options ?? {}).flatMap((name) => {
    const rule = ruleFor(name);
    if (rule === undefined || ruleLevel(rule.code, rules) !== "off") {
      return [];
    }
    return [
      diagnostic(rule, source, {
        span: spanOfRuleTable(file.text, name),
        severity: "warning",
        message: `[tool.inwards.rules.${name}] sets options for ${name} (${rule.code}), which is off, so they do nothing.`,
        fix: {
          summary: `Ask the user whether to turn ${rule.code} on or remove [tool.inwards.rules.${name}].`,
          steps: [
            `To turn the rule on, add "${rule.code}" to extend-select (or select) in [tool.inwards.rules], and take it out of ignore.`,
            "Don't edit [tool.inwards] yourself; tell the user.",
          ],
        },
      }),
    ];
  });
}
