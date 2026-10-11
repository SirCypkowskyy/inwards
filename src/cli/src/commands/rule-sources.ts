/**
 * @file What `inwards rules` lists (#341): every registered rule, whether the
 * project's config turns it on, at what severity, and which config key decided
 * it: the registry default, `select`, `extend-select`, `ignore`, `severity`, or
 * a template role's `rules` table (#298). The parsed config says what holds,
 * since `ruleLevel` is what the check applies; the raw `[tool.inwards]` table
 * says who asked for it, because the parser merges template rules into
 * `extend-select` and `severity`. Pure: the caller reads and parses the file.
 */
import { type InwardsConfig, RULES, ruleLevel, type Severity } from "@inwards/core";
import { isRecord } from "../json/guards.ts";

/**
 * Why a rule is on or off: `fixed` (INW000, always on), `default` (on by
 * default), `opt-in` (off by default and not turned on), `select`,
 * `extend-select`, `template` (a template role turned it on), `ignore`, or
 * `not-selected` (`select` is set and doesn't list it).
 */
export type SourceKind =
  | "fixed"
  | "default"
  | "opt-in"
  | "select"
  | "extend-select"
  | "template"
  | "ignore"
  | "not-selected";

/** Where a rule's state or severity came from. */
export interface RuleSource {
  /** Which kind of setting decided it. */
  kind: SourceKind | "severity";
  /** The config keys that decided it, under `[tool.inwards]`; empty for a default. */
  keys: string[];
}

/** One rule, as the project's config leaves it. */
export interface RuleRow {
  /** e.g. `INW001`. */
  code: string;
  /** e.g. `layer-dependency`. */
  name: string;
  /** The registry's one-line summary. */
  summary: string;
  /** Whether the rule reports in this project. */
  enabled: boolean;
  /** The severity its findings get: the config's, else the registry's. */
  severity: Severity;
  /** Whether the rule reports without a config asking for it. */
  default: "on" | "off";
  /** Why the rule is on or off. */
  source: RuleSource;
  /** Where the severity came from: `default`, `severity` or `template`. */
  severitySource: RuleSource;
  /** The modules the rule is limited to (its options' `modules`), when set. */
  modules?: string[];
  /** The rule's docs page. */
  docs: string;
}

/** The parts of the raw `[tool.inwards.rules]` table the sources name. */
interface RawRules {
  /** `extend-select` as written. */
  extendSelect: readonly unknown[];
  /** The codes `severity` sets, as written. */
  severity: ReadonlySet<string>;
}

/** A template role's say about one rule, by rule name: its key and whether it gives a severity. */
type TemplateSays = ReadonlyMap<string, readonly { key: string; severity: boolean }[]>;

/**
 * Lists every registered rule as the config leaves it, in registry order.
 *
 * @param config - the parsed config and the raw `[tool.inwards]` table it
 *   came from; undefined without a config, which leaves every rule at its default.
 * @param config.parsed - the parsed config, whose rule settings the check applies.
 * @param config.raw - the raw `[tool.inwards]` table, for which key asked for what.
 * @returns one row per rule.
 */
export function ruleRows(config: { parsed: InwardsConfig; raw: unknown } | undefined): RuleRow[] {
  const settings = config?.parsed.rules;
  const raw = rawRules(config?.raw);
  const templates = templateSays(config?.raw);
  return Object.values(RULES).map((rule): RuleRow => {
    const says = templates.get(rule.name) ?? [];
    const level = settings?.severity?.[rule.code];
    const severityKeys = says.filter((s) => s.severity).map((s) => s.key);
    const modules = settings?.options?.[rule.name]?.["modules"];
    const scope = Array.isArray(modules)
      ? modules.filter((m): m is string => typeof m === "string")
      : [];
    return {
      code: rule.code,
      name: rule.name,
      summary: rule.summary,
      enabled: ruleLevel(rule.code, settings) !== "off",
      severity: rule.code === "INW000" ? rule.severity : (level ?? rule.severity),
      default: rule.default,
      source: stateSource(rule, settings, raw, says),
      severitySource: severitySource(rule.code, level, raw, severityKeys),
      ...(scope.length === 0 ? {} : { modules: scope }),
      docs: rule.docs,
    };
  });
}

/**
 * Says why a rule is on or off, in the order `ruleLevel` decides it:
 * `ignore` wins, then `select` (or the default without it), then
 * `extend-select`, which a template role may have filled.
 *
 * @param rule - the registry entry.
 * @param rule.code - its code.
 * @param rule.default - whether it reports by default.
 * @param settings - the parsed `[tool.inwards.rules]`, if any.
 * @param raw - the raw table's `extend-select`, to tell a template's code from one written there.
 * @param says - what template roles say about the rule.
 * @returns the kind of setting that decided it, and its keys.
 */
function stateSource(
  rule: { code: string; default: "on" | "off" },
  settings: InwardsConfig["rules"],
  raw: RawRules,
  says: readonly { key: string }[],
): RuleSource {
  const { code } = rule;
  if (code === "INW000") {
    return { kind: "fixed", keys: [] };
  }
  if (settings?.ignore?.includes(code) === true) {
    return { kind: "ignore", keys: ["rules.ignore"] };
  }
  const { select, extendSelect = [] } = settings ?? {};
  if (select?.includes(code) === true) {
    return { kind: "select", keys: ["rules.select"] };
  }
  if (select === undefined && rule.default === "on") {
    return { kind: "default", keys: [] };
  }
  if (extendSelect.includes(code)) {
    return raw.extendSelect.includes(code) || says.length === 0
      ? { kind: "extend-select", keys: ["rules.extend-select"] }
      : { kind: "template", keys: says.map((s) => s.key) };
  }
  return select === undefined
    ? { kind: "opt-in", keys: [] }
    : { kind: "not-selected", keys: ["rules.select"] };
}

/**
 * Says where a rule's severity came from: the top-level `severity` table, which
 * wins, a template role, or the registry.
 *
 * @param code - the rule's code.
 * @param level - the severity the parsed config sets, if any.
 * @param raw - the codes the raw `severity` table sets.
 * @param templateKeys - the template roles that give the rule a severity.
 * @returns the kind and the keys.
 */
function severitySource(
  code: string,
  level: Severity | undefined,
  raw: RawRules,
  templateKeys: readonly string[],
): RuleSource {
  if (level === undefined || code === "INW000") {
    return { kind: "default", keys: [] };
  }
  return raw.severity.has(code) || templateKeys.length === 0
    ? { kind: "severity", keys: ["rules.severity"] }
    : { kind: "template", keys: [...templateKeys] };
}

/**
 * Reads what the raw `[tool.inwards.rules]` table writes itself, before the
 * template rules are merged in.
 *
 * @param table - the raw `[tool.inwards]` table, if any.
 * @returns its `extend-select` and the codes its `severity` sets; empty when unset.
 */
function rawRules(table: unknown): RawRules {
  const rules = isRecord(table) ? table["rules"] : undefined;
  if (!isRecord(rules)) {
    return { extendSelect: [], severity: new Set() };
  }
  const extend = rules["extend-select"];
  const severity = rules["severity"];
  return {
    extendSelect: Array.isArray(extend) ? extend : [],
    severity: new Set(isRecord(severity) ? Object.keys(severity) : []),
  };
}

/**
 * Collects what each template role's `rules` table says, by rule name, with
 * the key it is written under (`templates.domain.rules.router`; a dotted role
 * is quoted, as in TOML).
 *
 * @param table - the raw `[tool.inwards]` table, if any; the parser has validated it.
 * @returns the roles that name each rule, in template and role order.
 */
function templateSays(table: unknown): TemplateSays {
  const says = new Map<string, { key: string; severity: boolean }[]>();
  for (const [name, template] of Object.entries(tableOf(tableOf(table)["templates"]))) {
    for (const [role, rules] of Object.entries(tableOf(tableOf(template)["rules"]))) {
      const key = `templates.${name}.rules.${role.includes(".") ? `"${role}"` : role}`;
      for (const [rule, severity] of roleSays(rules)) {
        says.set(rule, [...(says.get(rule) ?? []), { key, severity }]);
      }
    }
  }
  return says;
}

/**
 * Reads one role's table: the rules it names, and whether it gives each a severity.
 *
 * @param rules - the raw role table, e.g. `{ async-blocking = true }`.
 * @returns each rule name with true when its value is a severity.
 */
function roleSays(rules: unknown): [string, boolean][] {
  return Object.entries(tableOf(rules)).map(([rule, value]) => [
    rule,
    value === "error" || value === "warning",
  ]);
}

/**
 * Narrows a raw TOML value to a table, anything else to an empty one.
 *
 * @param value - a raw value.
 * @returns the value when it is a table, else `{}`.
 */
function tableOf(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}
