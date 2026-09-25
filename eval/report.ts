/**
 * Result types of the agent eval and the Markdown summary a report quotes.
 * Kept apart from `run.ts`, which drives the agent, so each file stays small.
 */

export type Outcome = "fixed" | "evaded" | "unfixed" | "task-not-done" | "error";

/** What one agent run produced. */
export interface CaseResult {
  id: string;
  outcome: Outcome;
  /** PostToolUse runs that blocked with exit 2 (the agent was told to fix something). */
  blocks: number;
  /** Violations left at the end; -1 when `inwards check` itself failed (config broken). */
  violationsLeft: number;
  evasions: string[];
  turns: number;
  costUsd: number;
  /** The agent's last message: how it explained what it did about the hook. */
  finalMessage: string;
  /** Repo-relative path of the stream-json transcript. */
  transcript: string;
  diff: string;
}

/**
 * Today's date as `YYYY-MM-DD` (UTC), for report titles and file names.
 *
 * @returns The date part of the current ISO timestamp.
 */
export function today(): string {
  return new Date().toISOString().slice(0, "YYYY-MM-DD".length);
}

/**
 * Renders the results as a Markdown table plus the counts a report quotes.
 *
 * "Introduced" counts runs where the agent wrote a violation itself: the hook
 * blocked at least once in a fixture that started clean (`tempt-*`). Runs
 * that never tripped the hook are counted apart, since there was nothing to fix.
 *
 * @param results - One entry per fixture run.
 * @param model - Model alias the runs used.
 * @returns Markdown with summary lines and one row per run.
 */
export function toMarkdown(results: CaseResult[], model: string): string {
  const tempt = results.filter((r) => r.id.includes("/tempt-"));
  const introduced = tempt.filter((r) => r.blocks > 0);
  const fixedIntroduced = introduced.filter((r) => r.outcome === "fixed");
  const oneRetry = fixedIntroduced.filter((r) => r.blocks === 1).length;
  const never = tempt.filter((r) => r.blocks === 0);
  const cost = results.reduce((sum, r) => sum + r.costUsd, 0);
  const rows = results.map(
    (r) =>
      `| ${r.id} | ${r.outcome} | ${r.blocks} | ${r.violationsLeft} | ${r.evasions.join(", ") || "-"} | ${r.turns} | ${r.costUsd.toFixed(2)} |`,
  );
  return [
    `# Eval: ${model}, ${today()}`,
    "",
    `Violations the agent introduced (tempt-* runs with a block): ${fixedIntroduced.length}/${introduced.length} fixed, ${oneRetry} of them after exactly one block.`,
    `Tempt-* runs that never tripped the hook: ${never.length} (${never.filter((r) => r.outcome === "fixed").length} fixed).`,
    `Total cost: USD ${cost.toFixed(2)}.`,
    "",
    "| Case | Outcome | Hook blocks | Violations left | Evasions | Turns | Cost (USD) |",
    "|---|---|---|---|---|---|---|",
    ...rows,
    "",
  ].join("\n");
}
