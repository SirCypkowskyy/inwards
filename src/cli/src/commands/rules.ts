/**
 * @file `inwards rules` and `inwards rule CODE|NAME` (#341): the rule list for
 * one project, with each rule's state, severity and the config key behind
 * them (`rule-sources.ts`), and one rule's docs page, the same text MCP's
 * `explain_rule` returns, for agents without an MCP client. The pages come
 * through `McpDeps.pages`, which loads them only when asked, so no other
 * command pays for them. It reads the config through the platform and writes
 * through `print`; it owns no I/O of its own.
 */
import { relative } from "node:path";
import { inwardsTable, parseConfig, RULES } from "@inwards/core";
import { explainRule } from "../mcp/explain-rule.ts";
import { print } from "../platform/print.ts";
import { commandConfig } from "../project/config-discovery.ts";
import type { AppDeps } from "./deps.ts";
import { type RuleRow, type RuleSource, ruleRows } from "./rule-sources.ts";

/** The flags both commands read. */
interface RulesFlags {
  /** `--config FILE`, for `rules`. */
  config?: string | undefined;
  /** `--json`: print data instead of text. */
  json?: boolean | undefined;
  /** `--full`, for `rule`: every section of the page. */
  full?: boolean | undefined;
}

/** What `inwards rules --json` prints: `inwards/rules@1`. */
interface RulesJson {
  schema: "inwards/rules@1";
  /** The config read, relative to the working directory; null without one. */
  config: string | null;
  /** Every rule, in registry order. */
  rules: RuleRow[];
}

/** Edits a mistyped rule may be away from a suggestion, at least. */
const MIN_TYPOS = 2;
/** One more allowed edit per this many characters typed, for long names. */
const CHARS_PER_TYPO = 4;

/** The text table's columns, in order. */
const HEADER = ["CODE", "NAME", "STATE", "SEVERITY", "SOURCE"] as const;

/** What a source says in the text table, by kind, before its keys. */
const SOURCE_TEXT: Readonly<Record<RuleSource["kind"], string>> = {
  fixed: "always on",
  default: "default",
  "opt-in": "opt-in, off by default",
  select: "",
  "extend-select": "",
  template: "",
  ignore: "",
  "not-selected": "not in",
  severity: "",
};

/**
 * Runs `inwards rules`: every rule, as the nearest config (or `--config`)
 * leaves it. Without a config it lists the defaults.
 *
 * @param deps - the platform.
 * @param args - the positionals after `rules`: none.
 * @param flags - `--config` and `--json`.
 * @param usage - the command's usage, for unexpected arguments.
 * @returns 0 once printed; 2 for unexpected arguments or a `--config` that isn't a file.
 * @throws {ConfigError} when the config is invalid; when it can't be read.
 */
export function rulesCommand(
  deps: Pick<AppDeps, "io">,
  args: readonly string[],
  flags: RulesFlags,
  usage: string,
): number {
  const { io } = deps;
  if (args.length > 0) {
    return print(io.streams, usage, 2);
  }
  const found = commandConfig(io, flags.config);
  if ("problem" in found && flags.config !== undefined) {
    return print(io.streams, found.problem, 2);
  }
  const path = "path" in found ? found.path : undefined;
  const text = path === undefined ? undefined : io.read.text(path);
  const rows = ruleRows(
    text === undefined ? undefined : { parsed: parseConfig(text), raw: inwardsTable(text) },
  );
  const shown = path === undefined ? null : relative(io.runtime.cwd, path) || path;
  if (flags.json === true) {
    const json: RulesJson = { schema: "inwards/rules@1", config: shown, rules: rows };
    return print(io.streams, JSON.stringify(json, null, 2), 0);
  }
  const title =
    shown === null
      ? "No pyproject.toml with [tool.inwards] found: every rule at its default."
      : `Rules for ${shown}; SOURCE names keys under [tool.inwards].`;
  return print(io.streams, `${title}\n\n${table(rows)}`, 0);
}

/**
 * Runs `inwards rule CODE|NAME`: the rule's docs page, as MCP's
 * `explain_rule` returns it.
 *
 * @param deps - the streams and the rule pages.
 * @param args - the positionals after `rule`: one code or name.
 * @param flags - `--json` and `--full`.
 * @param usage - the command's usage, for a missing or extra argument.
 * @returns 0 once printed; 2 for a usage error or an unknown rule.
 */
export async function ruleCommand(
  deps: Pick<AppDeps, "io" | "mcp">,
  args: readonly string[],
  flags: RulesFlags,
  usage: string,
): Promise<number> {
  const { streams } = deps.io;
  const [wanted] = args;
  if (wanted === undefined || args.length > 1) {
    return print(streams, usage, 2);
  }
  const answer = explainRule(await deps.mcp.pages(), { rule: wanted, full: flags.full });
  if (answer.error === true) {
    const near = nearestRule(wanted);
    const hint = near === undefined ? "" : ` Did you mean ${near}?`;
    return print(
      streams,
      `inwards rule: no rule "${wanted}".${hint} Run inwards rules for the list.`,
      2,
    );
  }
  const body = flags.json === true ? JSON.stringify(answer.data, null, 2) : answer.text;
  return print(streams, body, 0);
}

/**
 * Lays the rows out as a table with aligned columns.
 *
 * @param rows - the rules.
 * @returns the header and one line per rule, without a trailing newline.
 */
function table(rows: readonly RuleRow[]): string {
  const cells = [
    [...HEADER],
    ...rows.map((row) => [
      row.code,
      row.name,
      row.enabled ? "on" : "off",
      row.severity,
      sourceText(row),
    ]),
  ];
  const widths = HEADER.map((_, i) => Math.max(...cells.map((line) => line[i]?.length ?? 0)));
  return cells
    .map((line) =>
      line
        .map((cell, i) => (i === line.length - 1 ? cell : cell.padEnd(widths[i] ?? 0)))
        .join("  "),
    )
    .join("\n");
}

/**
 * Words a row's SOURCE cell: why it is on or off, then where its severity
 * and its module scope come from, when the config sets them.
 *
 * @param row - the rule.
 * @returns e.g. `rules.extend-select; severity: rules.severity; only in app.*.router`.
 */
function sourceText(row: RuleRow): string {
  const parts = [said(row.source)];
  if (row.severitySource.kind !== "default") {
    parts.push(`severity: ${said(row.severitySource)}`);
  }
  if (row.enabled && row.modules !== undefined) {
    parts.push(`only in ${row.modules.join(", ")}`);
  }
  return parts.join("; ");
}

/**
 * Words one source: its kind's words, then its keys.
 *
 * @param source - why a rule is on or off, or where its severity came from.
 * @returns e.g. `default`, `rules.ignore` or `not in rules.select`.
 */
function said(source: RuleSource): string {
  return [SOURCE_TEXT[source.kind], source.keys.join(", ")].filter((s) => s !== "").join(" ");
}

/**
 * Finds the registered rule closest to a mistyped code or name, by edit
 * distance, when one is close enough to be a typo.
 *
 * @param wanted - what the user typed.
 * @returns e.g. `INW009 (name)`, or undefined when nothing is close.
 */
function nearestRule(wanted: string): string | undefined {
  const typed = wanted.trim().toLowerCase();
  let best: { label: string; distance: number } | undefined;
  for (const rule of Object.values(RULES)) {
    const distance = Math.min(
      editDistance(typed, rule.code.toLowerCase()),
      editDistance(typed, rule.name),
    );
    if (best === undefined || distance < best.distance) {
      best = { label: `${rule.code} (${rule.name})`, distance };
    }
  }
  const allowed = Math.max(MIN_TYPOS, Math.floor(typed.length / CHARS_PER_TYPO));
  return best !== undefined && best.distance <= allowed ? best.label : undefined;
}

/**
 * Counts the single-character edits between two strings (Levenshtein).
 *
 * @param a - one string.
 * @param b - the other.
 * @returns the number of insertions, deletions and substitutions that turn `a` into `b`.
 */
function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current.push(
        Math.min((previous[j] ?? 0) + 1, (current[j - 1] ?? 0) + 1, (previous[j - 1] ?? 0) + cost),
      );
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
}
