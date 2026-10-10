/**
 * @file The `explain_rule` tool: a rule's docs page, for an agent that met a
 * code in a finding or wants to know a rule before it writes. The answer is
 * the registry's metadata (`RULES`) and the page's own sections, What it
 * does, Why is this bad, Example and How to fix, or every section with
 * `full`, so it says exactly what the published page says. The pages come in
 * as text (`RulePages`); nothing here reads a file.
 */
import { RULES } from "@inwards/core";
import { failure } from "./answers.ts";
import type { ExplainRuleInput, ToolAnswer } from "./contracts.ts";
import { type RulePage, readRulePage } from "./rule-page.ts";

/** The rule pages' Markdown, by code. */
export type RulePages = ReadonlyMap<string, string>;

/** The sections an answer has without `full`, by anchor: what the issue asked for. */
const CORE_SECTIONS: readonly string[] = [
  "what-it-does",
  "why-is-this-bad",
  "example",
  "how-to-fix",
];

/** The registry's entries, for lookups by code or name. */
const ALL_RULES = Object.values(RULES);

/**
 * Finds a rule by code or name, in any case.
 *
 * @param rule - e.g. `inw001` or `layer-dependency`.
 * @returns the registry entry, or undefined for no such rule.
 */
function ruleOf(rule: string): (typeof ALL_RULES)[number] | undefined {
  const wanted = rule.trim().toLowerCase();
  return ALL_RULES.find((r) => r.code.toLowerCase() === wanted || r.name === wanted);
}

/**
 * Reads a boolean front matter key.
 *
 * @param page - the rule page, read.
 * @param key - a front matter key, e.g. `autofix`.
 * @returns the value, or undefined when the key is missing or not a boolean.
 */
function flag(page: RulePage, key: string): boolean | undefined {
  const value = page.meta.get(key);
  return value === "true" || value === "false" ? value === "true" : undefined;
}

/**
 * Runs `explain_rule`.
 *
 * @param pages - every rule page's Markdown, by code.
 * @param input - the tool's arguments.
 * @returns the rule's metadata and sections, as Markdown and as data; an
 *   error answer naming the known codes for an unknown rule.
 */
export function explainRule(pages: RulePages, input: ExplainRuleInput): ToolAnswer {
  const rule = ruleOf(input.rule);
  const text = rule === undefined ? undefined : pages.get(rule.code);
  if (rule === undefined || text === undefined) {
    const codes = ALL_RULES.map((r) => r.code).join(", ");
    return failure(`No rule "${input.rule}". Known rules: ${codes}.`);
  }
  const page = readRulePage(text);
  const sections = page.sections.filter(
    (s) => s.id !== "references" && (input.full === true || CORE_SECTIONS.includes(s.id)),
  );
  const description = page.meta.get("description") ?? rule.summary;
  const enabled = rule.default === "on" ? "on by default" : "opt-in (off by default)";
  const markdown = [
    `# ${rule.code} \`${rule.name}\``,
    "",
    `${description} Severity ${rule.severity}, ${enabled}. Docs: ${rule.docs}`,
    ...sections.flatMap((s) => ["", `## ${s.title}`, "", s.markdown]),
  ].join("\n");
  return {
    text: markdown,
    data: {
      code: rule.code,
      name: rule.name,
      summary: rule.summary,
      description,
      severity: rule.severity,
      default: rule.default,
      status: page.meta.get("status"),
      suppressible: flag(page, "suppressible"),
      autofix: flag(page, "autofix"),
      docs: rule.docs,
      sections: sections.map(({ id, title, markdown: md }) => ({ id, title, markdown: md })),
    },
  };
}
