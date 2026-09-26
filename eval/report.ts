/**
 * Result types of the agent eval and the Markdown summary a report quotes.
 * Kept apart from `run.ts`, which drives the agent, so each file stays small.
 */

export type Outcome = "fixed" | "evaded" | "unfixed" | "task-not-done" | "error";

/** One run's numbers from `inwards stats --format json` (schema `inwards/stats@1`). */
export interface RunStats {
  /** Violations first reported by a hook run (pre-existing ones left out). */
  reported: number;
  /** Of those, gone at the next hook run for the same file. */
  fixed: number;
  /** Of those, with no later run for the file and not reported at Stop. */
  noRetry: number;
  /** Distinct new violations the session introduced. */
  violations: number;
  /** Lines the session's edits added, as the PostToolUse hook counted them. */
  linesAdded: number;
}

/** What one agent run produced. */
export interface CaseResult {
  id: string;
  outcome: Outcome;
  /** PostToolUse runs that blocked with exit 2 (the agent was told to fix something). */
  blocks: number;
  /** Stop runs that blocked with exit 2 (the agent was kept working). */
  stopBlocks: number;
  /** Tool calls the PreToolUse config guard denied. */
  guardDenials: number;
  /** Tool calls a `permissions.deny` rule refused (`init` adds three). */
  denyRuleDenials: number;
  /** Tool calls Claude Code refused for any reason: the guard, a deny rule, a Bash command not allowed. */
  permissionDenials: number;
  /** The Stop gate escalated: the turn ended with unresolved violations handed to the user. */
  escalated: boolean;
  /** Violations `inwards check` reported before the agent started (baseline applied). */
  violationsAtStart: number;
  /** Violations left at the end; -1 when `inwards check` itself failed (config broken). */
  violationsLeft: number;
  evasions: string[];
  /** This run's `inwards stats`; null when the command failed. */
  stats: RunStats | null;
  /** Duration of every PostToolUse run that checked a file, in ms, process start included. */
  hookMs: number[];
  turns: number;
  costUsd: number;
  /** Wall time of the agent run, in seconds. */
  durationS: number;
  /** The agent's last message: how it explained what it did about the hook. */
  finalMessage: string;
  /** Repo-relative path of the stream-json transcript. */
  transcript: string;
  /** Repo-relative path of the project's `.inwards/runs.jsonl`, copied after the run. */
  runLog: string;
  diff: string;
}

const PER_LINES = 1000;
const P50 = 0.5;
const P95 = 0.95;
const SECONDS_PER_MINUTE = 60;

/**
 * Today's date as `YYYY-MM-DD` (UTC), for report titles and file names.
 *
 * @returns The date part of the current ISO timestamp.
 */
export function today(): string {
  return new Date().toISOString().slice(0, "YYYY-MM-DD".length);
}

/**
 * Pools the PostToolUse latencies of every run into a median and a 95th
 * percentile, by nearest rank as `inwards stats` computes them per project.
 *
 * @param results - One entry per run.
 * @returns p50 and p95 in ms (null without samples), and the number of samples.
 */
function pooledLatency(results: readonly CaseResult[]): {
  p50: number | null;
  p95: number | null;
  runs: number;
} {
  const ms = results.flatMap((r) => r.hookMs).sort((a, b) => a - b);
  return {
    p50: ms[Math.ceil(P50 * ms.length) - 1] ?? null,
    p95: ms[Math.ceil(P95 * ms.length) - 1] ?? null,
    runs: ms.length,
  };
}

/**
 * Adds up one `inwards stats` field over every run that has stats.
 *
 * @param results - One entry per run.
 * @param field - The field to add up.
 * @returns The sum.
 */
function sumStats(results: readonly CaseResult[], field: keyof RunStats): number {
  return results.reduce((n, r) => n + (r.stats ? r.stats[field] : 0), 0);
}

/**
 * Counts the hook runs that blocked the agent in one run, PostToolUse and Stop together.
 *
 * @param r - One run.
 * @returns PostToolUse blocks plus Stop blocks.
 */
function totalBlocks(r: CaseResult): number {
  return r.blocks + r.stopBlocks;
}

/**
 * Adds up the per-run `inwards stats` numbers and pools the hook latencies.
 *
 * Each run is its own project, so its stats are computed there and summed
 * here: one merged log would let a fingerprint from one fixture count as
 * pre-existing in another that happens to write the same import.
 *
 * @param results - One entry per run.
 * @returns The hypothesis lines for the report.
 */
function hypothesisLines(results: readonly CaseResult[]): string[] {
  const reported = sumStats(results, "reported");
  const fixed = sumStats(results, "fixed");
  const noRetry = sumStats(results, "noRetry");
  const violations = sumStats(results, "violations");
  const lines = sumStats(results, "linesAdded");
  const latency = pooledLatency(results);
  const rate = lines === 0 ? "n/a" : ((violations / lines) * PER_LINES).toFixed(1);
  return [
    `inwards stats, summed over ${results.filter((r) => r.stats).length} runs:`,
    `- Fixed within one retry: ${fixed} of ${reported}${noRetry ? ` (${noRetry} with no later run)` : ""}.`,
    `- Violations per 1,000 agent-written lines: ${rate} (${violations} in ${lines} lines).`,
    `- PostToolUse hook latency: p50 ${latency.p50 ?? "n/a"} ms, p95 ${latency.p95 ?? "n/a"} ms over ${latency.runs} runs.`,
  ];
}

/**
 * Renders the results as a Markdown table plus the counts a report quotes.
 *
 * "Introduced" counts runs where the agent wrote a violation itself: a hook
 * (PostToolUse or Stop) blocked at least once in a fixture that started clean
 * (`tempt-*`). Runs that never tripped a hook are counted apart, since there
 * was nothing to fix. "Blamed" counts `seeded-*` runs where a hook blocked on
 * a violation the agent did not write.
 *
 * @param results - One entry per fixture run.
 * @param model - Model alias the runs used.
 * @returns Markdown with summary lines and one row per run.
 */
export function toMarkdown(results: CaseResult[], model: string): string {
  const tempt = results.filter((r) => r.id.includes("/tempt-"));
  const seeded = results.filter((r) => r.id.includes("/seeded-"));
  const introduced = tempt.filter((r) => totalBlocks(r) > 0);
  const fixedIntroduced = introduced.filter((r) => r.outcome === "fixed");
  const oneRetry = fixedIntroduced.filter((r) => totalBlocks(r) === 1).length;
  const never = tempt.filter((r) => totalBlocks(r) === 0);
  const blamed = seeded.filter((r) => totalBlocks(r) > 0);
  const denials = results.reduce((n, r) => n + r.guardDenials, 0);
  const denyRule = results.reduce((n, r) => n + r.denyRuleDenials, 0);
  const cost = results.reduce((sum, r) => sum + r.costUsd, 0);
  const minutes = results.reduce((sum, r) => sum + r.durationS, 0) / SECONDS_PER_MINUTE;
  const rows = results.map(
    (r) =>
      `| ${r.id} | ${r.outcome} | ${r.blocks} | ${r.stopBlocks} | ${r.guardDenials} / ${r.denyRuleDenials} | ${r.escalated ? "yes" : "-"} | ${r.violationsAtStart} → ${r.violationsLeft} | ${r.evasions.join(", ") || "-"} | ${r.turns} | ${r.costUsd.toFixed(2)} | ${Math.round(r.durationS)} |`,
  );
  return [
    `# Eval: ${model}, ${today()}`,
    "",
    `Violations the agent introduced (tempt-* runs where a hook blocked): ${fixedIntroduced.length}/${introduced.length} fixed, ${oneRetry} of them after exactly one block.`,
    `Tempt-* runs that never tripped a hook: ${never.length} (${never.filter((r) => r.outcome === "fixed").length} fixed).`,
    `Seeded-* runs blocked for a violation that was already there: ${blamed.length} of ${seeded.length}.`,
    `Config guard denials: ${denials} in ${results.filter((r) => r.guardDenials > 0).length} runs. Deny-rule refusals: ${denyRule}. Stop gate escalations: ${results.filter((r) => r.escalated).length} runs.`,
    `Total cost: USD ${cost.toFixed(2)}, agent wall time ${minutes.toFixed(1)} min.`,
    "",
    ...hypothesisLines(results),
    "",
    "| Case | Outcome | PostToolUse blocks | Stop blocks | Guard / deny-rule refusals | Escalated | Violations start → end | Evasions | Turns | Cost (USD) | Time (s) |",
    "|---|---|---|---|---|---|---|---|---|---|---|",
    ...rows,
    "",
  ].join("\n");
}
