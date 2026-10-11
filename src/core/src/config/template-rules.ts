/**
 * @file `[tool.inwards.templates.<name>.rules]` (#298): a template role turns
 * opt-in rules on for the role's modules, such as `router = { async-blocking
 * = true }`. This module validates that table and expands it into the raw
 * `[tool.inwards.rules]` table a user could write by hand, which `parse.ts`
 * then hands to `parseRules` like any other.
 *
 * The expansion adds each rule's code to `extend-select`, the role's modules
 * (`<entry module>.<role>` for every `layers` entry that uses the template) to
 * the rule's `modules`, or to `role` for INW015, a severity to `severity`, and
 * the template's options to the rule's table. The top-level table's own
 * options and severities win; two template roles that disagree are an error.
 * It knows nothing of layers beyond the raw entries; no I/O.
 */
import type { Severity } from "../contracts/records.ts";
import { RULES, ruleFor } from "../meta/registry.ts";
import { type OptionValue, optionKeys, parseOptions } from "./rule-options.ts";
import { ConfigError, isRecord } from "./toml.ts";

/** What a template gives one rule on one role: on, on at a severity, or on with options. */
export type TemplateRuleValue = true | Severity | Readonly<Record<string, OptionValue>>;

/** A template's validated `rules` table: by role, then by rule name. */
export type TemplateRules = Readonly<Record<string, Readonly<Record<string, TemplateRuleValue>>>>;

/** The parts of a template the expansion reads. */
interface RuleTemplate {
  /** Role modules, innermost first, in ranks. */
  readonly roles?: readonly (readonly string[])[];
  /** Rules by role. */
  readonly rules?: TemplateRules;
}

/** The option that takes the role's modules: INW015 guards its `role` and keeps `modules` for its scope. */
const SCOPE_KEY: Readonly<Record<string, string>> = { "construct-only-in": "role" };

/** One template role's say about one rule, with where it was written. */
interface Contribution {
  /** The dotted path of the rule under the role, for messages. */
  readonly where: string;
  /** The role's modules in every layers entry that uses the template. */
  readonly modules: readonly string[];
  /** What the role gives the rule. */
  readonly value: TemplateRuleValue;
}

/**
 * Names the key a rule's role modules go to.
 *
 * @param rule - the rule's kebab-case name.
 * @returns `role` for INW015, `modules` for every other rule.
 */
function scopeKey(rule: string): string {
  return SCOPE_KEY[rule] ?? "modules";
}

/**
 * Validates a template's `rules` table: roles the template lists, opt-in rule
 * names, and values that are `true`, a severity or the rule's options.
 *
 * @param value - the raw `rules` value.
 * @param roles - the template's parsed roles, if any.
 * @param where - the `rules` key's dotted path, for messages.
 * @returns the rules by role, then by rule name.
 * @throws {ConfigError} naming the first bad role, rule, value or option.
 */
export function parseTemplateRules(
  value: unknown,
  roles: readonly (readonly string[])[] | undefined,
  where: string,
): TemplateRules {
  if (!isRecord(value) || Array.isArray(value)) {
    throw new ConfigError(
      `${where} must be a table of roles, such as { router = { async-blocking = true } }.`,
    );
  }
  if (roles === undefined) {
    throw new ConfigError(`${where}: the template has no roles to put rules on.`);
  }
  const known = roles.flat();
  const parsed: Record<string, Record<string, TemplateRuleValue>> = {};
  for (const [role, table] of Object.entries(value)) {
    const at = `${where}.${role}`;
    if (!known.includes(role)) {
      throw new ConfigError(
        `${at}: the template has no role "${role}". Roles: ${known.join(", ")}.`,
      );
    }
    if (!isRecord(table) || Array.isArray(table)) {
      throw new ConfigError(
        `${at} must be a table of rule names, such as { async-blocking = true }.`,
      );
    }
    const rules: Record<string, TemplateRuleValue> = {};
    for (const [rule, given] of Object.entries(table)) {
      checkRuleName(rule, `${at}.${rule}`);
      rules[rule] = ruleValue(rule, given, `${at}.${rule}`);
    }
    parsed[role] = rules;
  }
  return parsed;
}

/**
 * Throws unless a key names an opt-in rule by its name.
 *
 * @param rule - the key as written.
 * @param where - its dotted path.
 * @throws {ConfigError} for an unknown name, a code, or a rule that is on by default.
 */
function checkRuleName(rule: string, where: string): void {
  const found = ruleFor(rule);
  if (found === undefined) {
    const optIn = Object.values(RULES)
      .filter((r) => r.default === "off")
      .map((r) => r.name);
    throw new ConfigError(
      `${where}: no rule is named ${rule}. A template can turn on these opt-in rules: ${optIn.join(", ")}.`,
    );
  }
  if (found.name !== rule) {
    throw new ConfigError(`${where}: write the rule's name, ${found.name}, not its code.`);
  }
  if (found.default !== "off") {
    throw new ConfigError(
      `${where}: ${found.code} ${found.name} is on by default for every module, so a template can't turn it on for a role. To narrow it, set modules in [tool.inwards.rules.${found.name}].`,
    );
  }
}

/**
 * Validates what a role gives one rule.
 *
 * @param rule - the rule's name, already checked.
 * @param value - the raw value.
 * @param where - its dotted path.
 * @returns `true`, the severity, or the options as the rule's parsers return them.
 * @throws {ConfigError} for another value, an option the template fills, or one the rule doesn't accept.
 */
function ruleValue(rule: string, value: unknown, where: string): TemplateRuleValue {
  if (value === true || value === "error" || value === "warning") {
    return value;
  }
  if (!isRecord(value) || Array.isArray(value)) {
    throw new ConfigError(
      `${where} must be true, "error", "warning" or a table of the rule's options; to leave the rule off, remove it.`,
    );
  }
  const scope = scopeKey(rule);
  if (scope in value) {
    throw new ConfigError(
      `${where}.${scope} can't be set: the template fills it with the role's modules. Add other modules in [tool.inwards.rules.${rule}].`,
    );
  }
  if ("modules" in value) {
    throw new ConfigError(
      `${where}.modules can't be set in a template: it scopes the whole rule. Set it in [tool.inwards.rules.${rule}].`,
    );
  }
  const keys = new Set([...optionKeys(rule)].filter((key) => key !== "modules" && key !== scope));
  const unknown = Object.keys(value).find((key) => !keys.has(key));
  if (unknown !== undefined) {
    throw new ConfigError(
      `Unknown key ${where}.${unknown}. Known keys: ${[...keys].join(", ") || "none"}.`,
    );
  }
  return parseOptions(rule, value, where);
}

/**
 * Lists the modules of the `layers` entries that use each template.
 *
 * @param layers - the raw `layers` array, already validated by `parseLayers`.
 * @returns module entries by template name, in layer order.
 */
export function templateUses(layers: readonly unknown[]): Map<string, string[]> {
  const uses = new Map<string, string[]>();
  for (const entry of layers) {
    if (!isRecord(entry) || Array.isArray(entry)) {
      continue;
    }
    const { template, modules } = entry;
    if (typeof template === "string" && Array.isArray(modules)) {
      const strings = modules.filter((m): m is string => typeof m === "string");
      uses.set(template, [...(uses.get(template) ?? []), ...strings]);
    }
  }
  return uses;
}

/**
 * Expands every template's `rules` into the raw `[tool.inwards.rules]` table,
 * as a user would write it by hand. Without template rules the table passes
 * through untouched, absent included.
 *
 * @param value - the raw `rules` value; anything but a table passes through for `parseRules` to reject.
 * @param templates - the parsed templates, by name.
 * @param uses - the modules of the layers entries that use each template (`templateUses`).
 * @returns the raw rules table with the templates' rules merged in.
 * @throws {ConfigError} for rules in a template no layers entry uses, or two roles that disagree.
 */
export function withTemplateRules(
  value: unknown,
  templates: ReadonlyMap<string, RuleTemplate>,
  uses: ReadonlyMap<string, readonly string[]>,
): unknown {
  const byRule = contributions(templates, uses);
  const own = value === undefined ? {} : value;
  if (byRule.size === 0 || !isRecord(own) || Array.isArray(own)) {
    return value;
  }
  const table: Record<string, unknown> = { ...own };
  const codes: string[] = [];
  for (const [rule, given] of byRule) {
    codes.push(ruleFor(rule)?.code ?? rule);
    table[rule] = mergedOptions(rule, table[rule], given);
  }
  const extend: unknown = table["extend-select"];
  if (extend === undefined || Array.isArray(extend)) {
    const mine: unknown[] = extend ?? [];
    table["extend-select"] = [...mine, ...codes.filter((c) => !mine.includes(c)).sort()];
  }
  const severity: unknown = table["severity"];
  if (severity === undefined || (isRecord(severity) && !Array.isArray(severity))) {
    const levels = mergedSeverities(severity ?? {}, byRule);
    if (Object.keys(levels).length > 0) {
      table["severity"] = levels;
    }
  }
  return table;
}

/**
 * Collects what every template role says about every rule, in template, role
 * and layer order.
 *
 * @param templates - the parsed templates.
 * @param uses - the modules of the layers entries that use each template.
 * @returns the contributions, by rule name.
 * @throws {ConfigError} for rules in a template no layers entry uses.
 */
function contributions(
  templates: ReadonlyMap<string, RuleTemplate>,
  uses: ReadonlyMap<string, readonly string[]>,
): Map<string, Contribution[]> {
  const byRule = new Map<string, Contribution[]>();
  for (const [name, template] of templates) {
    const where = `tool.inwards.templates.${name}.rules`;
    if (template.rules === undefined || Object.keys(template.rules).length === 0) {
      continue;
    }
    const bases = uses.get(name);
    if (bases === undefined) {
      throw new ConfigError(
        `${where}: no layers entry uses template "${name}", so its roles match no modules. Add template = "${name}" to a layers entry, or remove the rules.`,
      );
    }
    for (const [role, rules] of Object.entries(template.rules)) {
      const modules = bases.map((base) => `${base}.${role}`);
      for (const [rule, value] of Object.entries(rules)) {
        const list = byRule.get(rule) ?? [];
        list.push({ where: `${where}.${role}.${rule}`, modules, value });
        byRule.set(rule, list);
      }
    }
  }
  return byRule;
}

/**
 * Merges the template roles' say about one rule into its top-level options
 * table: the role modules join the scope key, and each option the top-level
 * table doesn't set comes from the roles, which must agree on it.
 *
 * @param rule - the rule's name.
 * @param own - the raw top-level table, if any; anything but a table passes through for `parseRules` to reject.
 * @param given - what the template roles say about the rule.
 * @returns the raw options table.
 * @throws {ConfigError} when two roles give one option different values.
 */
function mergedOptions(rule: string, own: unknown, given: readonly Contribution[]): unknown {
  const mine = own === undefined ? {} : own;
  if (!isRecord(mine) || Array.isArray(mine)) {
    return own;
  }
  const options = agreedOptions(rule, given, new Set(Object.keys(mine)));
  const table: Record<string, unknown> = { ...options, ...mine };
  const key = scopeKey(rule);
  const scope: unknown = table[key];
  if (scope === undefined || Array.isArray(scope)) {
    const roles = given.flatMap((c) => c.modules);
    table[key] = [...new Set([...(scope ?? []), ...roles])];
  }
  return table;
}

/**
 * Collects the options the template roles give a rule, one value per option.
 *
 * @param rule - the rule's name, for the message.
 * @param given - what the template roles say about the rule.
 * @param fixed - the options the top-level table sets, which win, so the roles needn't agree on them.
 * @returns the options, each with the first role's value.
 * @throws {ConfigError} when two roles give an option the top-level table doesn't set different values.
 */
function agreedOptions(
  rule: string,
  given: readonly Contribution[],
  fixed: ReadonlySet<string>,
): Record<string, OptionValue> {
  const options: Record<string, OptionValue> = {};
  const setBy = new Map<string, string>();
  for (const { where, value } of given) {
    const entries = typeof value === "object" ? Object.entries(value) : [];
    for (const [option, v] of entries) {
      const first = setBy.get(option);
      if (first === undefined) {
        setBy.set(option, where);
        options[option] = v;
      } else if (!(fixed.has(option) || sameValue(options[option], v))) {
        throw new ConfigError(
          `${where}.${option} disagrees with ${first}.${option}: a rule has one value per option. Set it once in [tool.inwards.rules.${rule}], which wins over both.`,
        );
      }
    }
  }
  return options;
}

/**
 * Adds the severities the template roles give their rules to the top-level
 * `severity` table, whose own entries win.
 *
 * @param own - the top-level `severity` table, empty when absent.
 * @param byRule - what the template roles say, by rule name.
 * @returns the severity table, by code.
 * @throws {ConfigError} when two roles give a rule the table doesn't set different severities.
 */
function mergedSeverities(
  own: Readonly<Record<string, unknown>>,
  byRule: ReadonlyMap<string, readonly Contribution[]>,
): Record<string, unknown> {
  const levels: Record<string, unknown> = { ...own };
  for (const [rule, given] of byRule) {
    const code = ruleFor(rule)?.code ?? rule;
    const level = Object.hasOwn(levels, code) ? undefined : agreedSeverity(code, given);
    if (level !== undefined) {
      levels[code] = level;
    }
  }
  return levels;
}

/**
 * Finds the one severity the template roles give a rule. Not asked when the
 * top-level `severity` sets the rule's, which wins.
 *
 * @param code - its code, for the message.
 * @param given - what the template roles say about the rule.
 * @returns the severity, or undefined when no role gives one.
 * @throws {ConfigError} when two roles give different severities.
 */
function agreedSeverity(code: string, given: readonly Contribution[]): Severity | undefined {
  let found: { level: Severity; where: string } | undefined;
  for (const { where, value } of given) {
    if (value !== "error" && value !== "warning") {
      continue;
    }
    if (found !== undefined && found.level !== value) {
      throw new ConfigError(
        `${where} disagrees with ${found.where}: a rule has one severity. Set it once in [tool.inwards.rules] severity = { ${code} = "..." }, which wins over both.`,
      );
    }
    found ??= { level: value, where };
  }
  return found === undefined ? undefined : found.level;
}

/**
 * Tells whether two parsed option values are the same, tables compared by key
 * whatever their order.
 *
 * @param a - one value.
 * @param b - the other.
 * @returns true when they are equal.
 */
function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => sameValue(item, b[i]));
  }
  if (isRecord(a) && isRecord(b) && !Array.isArray(a) && !Array.isArray(b)) {
    const keys = Object.keys(a);
    return (
      keys.length === Object.keys(b).length &&
      keys.every((key) => Object.hasOwn(b, key) && sameValue(a[key], b[key]))
    );
  }
  return a === b;
}
