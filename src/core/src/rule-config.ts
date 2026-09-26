/**
 * Per-rule configuration, `[tool.inwards.rules]`: which rules report
 * (`select`, `ignore`) and at what severity (`severity`), so a team can phase
 * rules in. Codes are exact; an unknown one is a config error. INW000 can't be
 * ignored or re-levelled: a file whose declared encoding can hide imports is
 * not checked at all, so turning INW000 off would hide that file entirely
 * (ADR-027).
 *
 * Every core function that returns diagnostics to an adapter applies these
 * settings (`applyRules`), so the CLI, the hooks, the Stop gate and the
 * language server agree.
 */
import { RULES } from "./rules.ts";
import { ConfigError, isRecord, rejectUnknownKeys } from "./toml.ts";
import type { Diagnostic, Severity } from "./types.ts";

/**
 * `[tool.inwards.rules]` as parsed. Plain data: the Stop gate stores configs
 * as JSON and compares them.
 */
export interface RuleSettings {
  /** Only these rules report; absent means every rule. */
  select?: string[];
  /** These rules never report, whatever `select` says. */
  ignore?: string[];
  /** The severity every finding of a rule gets, by code. */
  severity?: Record<string, Severity>;
}

const RULE_KEYS: ReadonlySet<string> = new Set(["select", "ignore", "severity"]);
const SEVERITIES: readonly string[] = ["error", "warning"] satisfies Severity[];
/** Always reports at its own severity, see the module comment. */
const FIXED = "INW000";

/**
 * Validates `[tool.inwards.rules]`.
 *
 * @param value - the raw `rules` value, if any.
 * @returns `{ rules }` when the table is set, else nothing.
 * @throws {ConfigError} for a key, code or severity it doesn't know, INW000 in
 *   `ignore` or `severity`, or an empty `select`.
 */
export function parseRules(value: unknown): { rules?: RuleSettings } {
  if (value === undefined) {
    return {};
  }
  if (!isRecord(value) || Array.isArray(value)) {
    throw new ConfigError("tool.inwards.rules must be a table.");
  }
  rejectUnknownKeys(value, RULE_KEYS, "tool.inwards.rules");
  const select = codeList(value["select"], "select");
  const ignore = codeList(value["ignore"], "ignore");
  const severity = severities(value["severity"]);
  if (select?.length === 0) {
    throw new ConfigError(
      "tool.inwards.rules.select must list at least one rule code; to turn rules off, list them in ignore.",
    );
  }
  return {
    rules: {
      ...(select === undefined ? {} : { select }),
      ...(ignore === undefined ? {} : { ignore }),
      ...(severity === undefined ? {} : { severity }),
    },
  };
}

/**
 * Validates `select` or `ignore`.
 *
 * @param value - the raw list, if any.
 * @param key - which key it is, for messages.
 * @returns the codes, or undefined when the key is absent.
 * @throws {ConfigError} when it isn't a list of known codes.
 */
function codeList(value: unknown, key: "select" | "ignore"): string[] | undefined {
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
 * Says what the config does to one rule's findings.
 *
 * @param code - the rule's code.
 * @param rules - the project's `[tool.inwards.rules]`, if any.
 * @returns "off" when the rule doesn't report, the severity every finding
 *   gets, or undefined when the findings keep their own.
 */
export function ruleLevel(
  code: string,
  rules: RuleSettings | undefined,
): Severity | "off" | undefined {
  if (rules === undefined || code === FIXED) {
    return undefined;
  }
  const { select, ignore = [], severity = {} } = rules;
  if ((select !== undefined && !select.includes(code)) || ignore.includes(code)) {
    return "off";
  }
  return Object.hasOwn(severity, code) ? severity[code] : undefined;
}

/**
 * Applies `[tool.inwards.rules]` to findings: drops those of rules that are
 * off and re-levels the rest. Idempotent, and a no-op without the table.
 *
 * @param found - the findings, as the rules produced them.
 * @param rules - the project's `[tool.inwards.rules]`, if any.
 * @returns the findings to report.
 */
export function applyRules(found: Diagnostic[], rules: RuleSettings | undefined): Diagnostic[] {
  if (rules === undefined) {
    return found;
  }
  return found.flatMap((d) => {
    const level = ruleLevel(d.code, rules);
    if (level === "off") {
      return [];
    }
    return level === undefined || level === d.severity ? [d] : [{ ...d, severity: level }];
  });
}
