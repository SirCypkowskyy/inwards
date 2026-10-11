/**
 * @file The opt-in rules part of the architecture brief (#336): one short line
 * per opt-in rule the config turns on (INW012 to INW016, the FAPI family),
 * worded as what to do while writing code, with the rule's key setting
 * (INW012's `delegate-to`, INW015's `role` and `allowed-in`, INW014's port
 * modules) and the modules it is scoped to. It also owns the inline-code
 * helpers the brief formats names with. Pure: it reads the parsed config only.
 */
import { type InwardsConfig, RULES, type RuleSettings, ruleLevel } from "@inwards/core";

/** One rule's parsed options table, `[tool.inwards.rules.<rule-name>]`. */
type RuleTable = NonNullable<RuleSettings["options"]>[string];

/**
 * Words one rule's line from its options, after the code and scope.
 *
 * @param table - the rule's options table, if set.
 * @returns the instruction, or undefined when the options leave the rule nothing to check.
 */
type Instruction = (table: RuleTable | undefined) => string | undefined;

/** The rules whose `modules` say what they check, not where: their line names them itself. */
const SELF_SCOPED: ReadonlySet<string> = new Set(["INW014"]);

/** What each opt-in rule asks of new code, by code. */
const INSTRUCTIONS: Readonly<Record<string, Instruction>> = {
  INW012: (table: RuleTable | undefined): string | undefined => {
    const to = strings(table, "delegate-to");
    return `endpoints stay thin: call into ${to === undefined ? "one use case" : list(to)}; no queries or outgoing calls`;
  },
  INW013: (): string => "no blocking calls in `async def`: use async clients or a plain `def`",
  INW014: (table: RuleTable | undefined): string | undefined => {
    const modules = strings(table, "modules");
    const ports = modules === undefined ? "`ports` modules" : list(modules);
    return `${ports} hold only ABCs and Protocols whose methods have no body`;
  },
  INW015: (table: RuleTable | undefined): string | undefined => {
    const role = strings(table, "role");
    const allowed = strings(table, "allowed-in") ?? [];
    if (role === undefined) {
      return;
    }
    const who = allowed.length === 0 ? "no module" : `only ${list(allowed)}`;
    return `${who} may import or build ${list(role)}; elsewhere take it through a port`;
  },
  INW016: (table: RuleTable | undefined): string | undefined => {
    const tables = table?.["table-name"] ?? "snake_singular";
    const parts = [
      tables === false ? "" : `${tables === "snake" ? "" : "singular "}snake_case table names`,
      suffixPart("datetime", table?.["datetime-suffix"], "_at"),
      suffixPart("date", table?.["date-suffix"], "_date"),
    ].filter((part) => part !== "");
    return parts.length === 0 ? undefined : parts.join(", ");
  },
  FAPI001: (table: RuleTable | undefined): string | undefined => {
    const parts = metadataParts(table);
    return parts.length === 0 ? undefined : `path operations need ${and(parts)}`;
  },
  FAPI002: (table: RuleTable | undefined): string | undefined => {
    const codes = table?.["codes"] === "4xx-5xx" ? "4xx and 5xx" : "4xx";
    return `declare every ${codes} a path operation raises in \`responses\``;
  },
  FAPI003: (table: RuleTable | undefined): string | undefined => {
    const apps = strings(table, "entrypoints");
    return `include every \`APIRouter\` in ${apps === undefined ? "an app" : list(apps)}; no include cycles`;
  },
  FAPI005: (): string => "declare `/items/me` before `/items/{id}`, so no route is shadowed",
  FAPI006: (): string => "startup and shutdown go in a lifespan, not `on_event`",
  FAPI007: (): string => "a dependency with `yield` re-raises what it catches",
  FAPI008: (): string => "each `operation_id` is unique within its app",
  FAPI009: (): string => "pass `Depends(get_db)`, not `Depends(get_db())`",
};

/**
 * Lists the opt-in rules the config turns on, one line each, in the
 * registry's order. A rule without its own wording gets its registry summary.
 *
 * @param config - the parsed config.
 * @returns the lines, with a blank line and a heading first, or none when no opt-in rule is on.
 */
export function optInSection(config: InwardsConfig): string[] {
  const lines = Object.values(RULES).flatMap((rule) => {
    if (rule.default !== "off" || ruleLevel(rule.code, config.rules) === "off") {
      return [];
    }
    const table = config.rules?.options?.[rule.name];
    const instruction = INSTRUCTIONS[rule.code];
    const text = instruction === undefined ? rule.summary : instruction(table);
    if (text === undefined) {
      return [];
    }
    const modules = SELF_SCOPED.has(rule.code) ? undefined : strings(table, "modules");
    const scope = modules === undefined ? "" : ` in ${list(modules)}`;
    return [`- ${rule.code}${scope}: ${text}`];
  });
  return lines.length === 0 ? [] : ["", "Opt-in rules:", ...lines];
}

/**
 * Words what FAPI001 requires of every path operation, defaults filled in as
 * the rule fills them.
 *
 * @param table - `[tool.inwards.rules.endpoint-metadata]`, if set.
 * @returns the required pieces, e.g. `a summary or docstring`; none when every check is off.
 */
function metadataParts(table: RuleTable | undefined): string[] {
  const summary = table?.["require-summary"] ?? "summary-or-docstring";
  const methods = strings(table, "require-status-code") ?? ["post", "delete"];
  const fields = strings(table, "require-response-fields") ?? ["description"];
  const parts: string[] = [];
  if (summary !== false) {
    parts.push(summary === "summary" ? "a `summary`" : "a summary or docstring");
  }
  if (table?.["require-response-model"] !== false) {
    parts.push("a response model");
  }
  if (methods.length > 0) {
    parts.push(`\`status_code\` on ${methods.map((m) => m.toUpperCase()).join("/")}`);
  }
  if (fields.length > 0) {
    parts.push(`${list(fields)} per \`responses\` entry`);
  }
  if (table?.["require-tags"] === true) {
    parts.push("`tags`");
  }
  if (table?.["require-operation-id"] === true) {
    parts.push("an `operation_id`");
  }
  return parts;
}

/**
 * Words one of INW016's column suffixes.
 *
 * @param kind - `datetime` or `date`.
 * @param value - the stored option, if set.
 * @param fallback - the rule's default suffix.
 * @returns e.g. `` datetime columns end in `_at` ``, or empty when the check is off.
 */
function suffixPart(kind: string, value: RuleTable[string], fallback: string): string {
  if (value === false) {
    return "";
  }
  return `${kind} columns end in \`${typeof value === "string" ? value : fallback}\``;
}

/**
 * Reads a list-of-strings option.
 *
 * @param table - the options table, if set.
 * @param key - the option's TOML key.
 * @returns the strings, or undefined when the option is unset or holds something else.
 */
function strings(table: RuleTable | undefined, key: string): readonly string[] | undefined {
  const value = table?.[key];
  if (typeof value !== "object") {
    return undefined;
  }
  const found = [...value].filter((entry): entry is string => typeof entry === "string");
  return found.length === value.length ? found : undefined;
}

/**
 * Joins phrases with commas and a final "and".
 *
 * @param parts - one or more phrases.
 * @returns e.g. `a, b and c`.
 */
function and(parts: readonly string[]): string {
  return parts.length < 2 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

/**
 * Formats names as inline code, comma separated.
 *
 * @param names - module or library names.
 * @returns e.g. `` `a`, `b` ``.
 */
export function list(names: readonly string[]): string {
  return names.map(code).join(", ");
}

/**
 * Formats one name as inline code.
 *
 * @param name - a module or library name.
 * @returns the name in backticks.
 */
export function code(name: string): string {
  return `\`${name}\``;
}
