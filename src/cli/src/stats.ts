/**
 * `inwards stats`: the business-hypothesis numbers from the run log
 * (docs/chapters/08-Run-Log.md), next to the thresholds chapter 2 sets.
 * Reads `.inwards/runs.1.jsonl` and `.inwards/runs.jsonl`; nothing leaves
 * the machine.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** The fields of an `inwards/run@1` line that stats reads. */
export interface RunLine {
  at: string;
  session_id: string | null;
  event: string;
  files: string[];
  lines: { file: string; added: number; removed: number }[];
  fingerprints: string[];
  /** The rule code of each fingerprint, in the same order; absent before it was added. */
  codes?: string[];
  durationMs: number;
}

/** How many first-reported violations were gone at the next hook run for the same file. */
export interface RetryCount {
  reported: number;
  fixed: number;
  /** First reports with no later hook run for that file yet; not in `reported`. */
  noRetry: number;
  rate: number | null;
}

/** The numbers, as `inwards stats --format json` prints them. */
export interface Stats {
  schema: "inwards/stats@1";
  sessions: number;
  hookRuns: number;
  /** Lines that weren't a readable `inwards/run@1` object. */
  skippedLines: number;
  fixedWithinOneRetry: RetryCount & { byRule: Record<string, RetryCount>; target: number };
  violationsPer1000Lines: {
    violations: number;
    linesAdded: number;
    rate: number | null;
    target: number;
  };
  hookLatencyMs: { runs: number; p50: number | null; p95: number | null; target: number };
}

/** Chapter 2's thresholds: the share fixed in one retry, violations per 1,000 lines, median hook ms. */
const TARGETS = { retry: 0.8, per1000: 1, latency: 100 };
const PER_LINES = 1000;
const P50 = 0.5;
const P95 = 0.95;
const PERCENT = 100;
const LINE_BREAK = /\r?\n/u;
const UNKNOWN_RULE = "unknown";

/**
 * Reads the run log, the rotated file first so lines stay in time order.
 *
 * @param project - the directory holding `.inwards/`.
 * @returns the readable lines, and how many weren't.
 */
export function readRunLog(project: string): { lines: RunLine[]; skipped: number } {
  const lines: RunLine[] = [];
  let skipped = 0;
  for (const name of ["runs.1.jsonl", "runs.jsonl"]) {
    let text = "";
    try {
      text = readFileSync(join(project, ".inwards", name), "utf8");
    } catch {
      continue; // no such file: nothing logged there
    }
    for (const raw of text.split(LINE_BREAK)) {
      if (raw.trim() === "") {
        continue;
      }
      const line = parseLine(raw);
      if (line === undefined) {
        skipped += 1;
      } else {
        lines.push(line);
      }
    }
  }
  return { lines, skipped };
}

/**
 * Parses one log line.
 *
 * @param raw - the line's text.
 * @returns the line, or undefined when it isn't an `inwards/run@1` object.
 */
function parseLine(raw: string): RunLine | undefined {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (
    !isRecord(value) ||
    value["v"] !== 1 ||
    typeof value["at"] !== "string" ||
    typeof value["event"] !== "string" ||
    !isStrings(value["files"]) ||
    !isStrings(value["fingerprints"]) ||
    !Array.isArray(value["lines"]) ||
    typeof value["durationMs"] !== "number"
  ) {
    return undefined;
  }
  const session = value["session_id"];
  const codes = value["codes"];
  return {
    at: value["at"],
    session_id: typeof session === "string" ? session : null,
    event: value["event"],
    files: value["files"],
    lines: value["lines"].filter(isLineCount),
    fingerprints: value["fingerprints"],
    ...(isStrings(codes) ? { codes } : {}),
    durationMs: value["durationMs"],
  };
}

/**
 * Computes the three chapter-8 numbers. A violation counts once per session
 * and file, at its first report; it is fixed within one retry when the next
 * hook run for that file no longer reports it. Violations a `check` run
 * reported before the session started were already there, so they are left
 * out of both the retry rate and the per-1,000-lines rate.
 *
 * @param lines - the log, in time order.
 * @param skipped - unreadable lines, passed through for the report.
 * @returns the numbers with their targets.
 */
export function computeStats(lines: readonly RunLine[], skipped = 0): Stats {
  const hooks = lines.filter((l) => l.event === "PostToolUse" && l.session_id !== null);
  const codeOf = ruleCodes(lines);
  const retry = emptyCount();
  const byRule: Record<string, RetryCount> = {};
  const introduced = new Set<string>();
  for (const [key, runs] of groupRuns(hooks)) {
    const session = key.split("\u0000")[0] ?? "";
    for (const { print, fixed } of firstReports(runs, preexisting(lines, session))) {
      introduced.add(`${session}\u0000${print}`);
      const rule = codeOf.get(print) ?? UNKNOWN_RULE;
      byRule[rule] ??= emptyCount();
      tally(retry, fixed);
      tally(byRule[rule], fixed);
    }
  }
  const linesAdded = hooks.reduce((n, l) => n + l.lines.reduce((m, c) => m + c.added, 0), 0);
  const latency = hooks.map((l) => l.durationMs);
  return {
    schema: "inwards/stats@1",
    sessions: new Set(hooks.map((l) => l.session_id)).size,
    hookRuns: hooks.length,
    skippedLines: skipped,
    fixedWithinOneRetry: { ...withRate(retry), byRule: rated(byRule), target: TARGETS.retry },
    violationsPer1000Lines: {
      violations: introduced.size,
      linesAdded,
      rate: linesAdded === 0 ? null : round((introduced.size / linesAdded) * PER_LINES),
      target: TARGETS.per1000,
    },
    hookLatencyMs: {
      runs: latency.length,
      p50: percentile(latency, P50),
      p95: percentile(latency, P95),
      target: TARGETS.latency,
    },
  };
}

/**
 * Finds each violation's first report in one file's hook runs, and whether
 * the next run for that file no longer had it.
 *
 * @param runs - one session's hook runs for one file, in order.
 * @param old - fingerprints that were there before the session.
 * @returns one entry per new fingerprint; `fixed` is undefined when no run followed.
 */
function firstReports(
  runs: readonly RunLine[],
  old: ReadonlySet<string>,
): { print: string; fixed: boolean | undefined }[] {
  const seen = new Set<string>(old);
  const reports: { print: string; fixed: boolean | undefined }[] = [];
  runs.forEach((run, i) => {
    const next = runs[i + 1];
    for (const print of new Set(run.fingerprints)) {
      if (!seen.has(print)) {
        seen.add(print);
        reports.push({ print, fixed: next && !next.fingerprints.includes(print) });
      }
    }
  });
  return reports;
}

/**
 * Maps each fingerprint to its rule code, from lines that carry `codes`.
 *
 * @param lines - the log.
 * @returns fingerprint to rule code.
 */
function ruleCodes(lines: readonly RunLine[]): Map<string, string> {
  const codeOf = new Map<string, string>();
  for (const line of lines) {
    line.fingerprints.forEach((print, i) => {
      const code = line.codes?.[i];
      if (code !== undefined) {
        codeOf.set(print, code);
      }
    });
  }
  return codeOf;
}

/**
 * Groups hook runs by session and file, keeping their order.
 *
 * @param hooks - PostToolUse lines with a session.
 * @returns runs keyed by `session\0file`.
 */
function groupRuns(hooks: readonly RunLine[]): Map<string, RunLine[]> {
  const groups = new Map<string, RunLine[]>();
  for (const run of hooks) {
    for (const file of run.files) {
      const key = `${run.session_id}\u0000${file}`;
      groups.set(key, [...(groups.get(key) ?? []), run]);
    }
  }
  return groups;
}

/**
 * Collects what `check` runs reported before a session's first line.
 *
 * @param lines - the log.
 * @param session - the session id.
 * @returns fingerprints that were already there.
 */
function preexisting(lines: readonly RunLine[], session: string): Set<string> {
  const start = lines.find((l) => l.session_id === session)?.at ?? "";
  return new Set(
    lines.filter((l) => l.event === "check" && l.at < start).flatMap((l) => l.fingerprints),
  );
}

/**
 * A zeroed retry count.
 *
 * @returns reported, fixed and noRetry at 0.
 */
function emptyCount(): RetryCount {
  return { reported: 0, fixed: 0, noRetry: 0, rate: null };
}

/**
 * Adds one first report to a count.
 *
 * @param count - the count to change.
 * @param fixed - whether the next run no longer had it; undefined when there was no next run.
 */
function tally(count: RetryCount, fixed: boolean | undefined): void {
  if (fixed === undefined) {
    count.noRetry += 1;
    return;
  }
  count.reported += 1;
  count.fixed += fixed ? 1 : 0;
}

/**
 * Fills in a count's rate.
 *
 * @param count - reported and fixed.
 * @returns the count with `rate`, or null rate when nothing was reported.
 */
function withRate(count: RetryCount): RetryCount {
  return { ...count, rate: count.reported === 0 ? null : round(count.fixed / count.reported) };
}

/**
 * Fills in every rule's rate, sorted by rule code.
 *
 * @param byRule - counts by rule.
 * @returns the same counts with rates.
 */
function rated(byRule: Record<string, RetryCount>): Record<string, RetryCount> {
  return Object.fromEntries(
    Object.keys(byRule)
      .sort()
      .map((rule) => [rule, withRate(byRule[rule] ?? emptyCount())]),
  );
}

/**
 * Takes a percentile by the nearest-rank method.
 *
 * @param samples - measurements, in any order.
 * @param p - the percentile as a fraction.
 * @returns the value at that rank, or null for no samples.
 */
function percentile(samples: readonly number[], p: number): number | null {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.max(1, Math.ceil(p * sorted.length)) - 1] ?? null;
}

/**
 * Rounds to three decimals, so JSON output stays short and stable.
 *
 * @param x - a number.
 * @returns x rounded.
 */
function round(x: number): number {
  return Math.round(x * PER_LINES) / PER_LINES;
}

/**
 * Renders the numbers for a person, each next to its target.
 *
 * @param stats - the computed numbers.
 * @returns the text report.
 */
export function renderStatsText(stats: Stats): string {
  const retry = stats.fixedWithinOneRetry;
  const per = stats.violationsPer1000Lines;
  const lat = stats.hookLatencyMs;
  const rules = Object.entries(retry.byRule).map(
    ([rule, c]) => `    ${rule}  ${c.fixed} of ${c.reported}${share(c.rate)}`,
  );
  return [
    `Run log: ${stats.sessions} sessions, ${stats.hookRuns} hook runs${stats.skippedLines ? `, ${stats.skippedLines} unreadable line${stats.skippedLines === 1 ? "" : "s"} skipped` : ""}.`,
    "",
    `Fixed within one retry: ${retry.fixed} of ${retry.reported}${share(retry.rate)}. Target: at least ${retry.target * PERCENT}%. ${verdict(retry.rate, (r) => r >= retry.target)}`,
    ...rules,
    ...(retry.noRetry
      ? [`    ${retry.noRetry} more had no later hook run for their file yet.`]
      : []),
    `Violations per 1,000 agent-written lines: ${per.rate ?? "n/a"} (${per.violations} in ${per.linesAdded} lines). Target: at least ${per.target}. ${verdict(per.rate, (r) => r >= per.target)}`,
    `Hook latency: p50 ${lat.p50 ?? "n/a"} ms, p95 ${lat.p95 ?? "n/a"} ms over ${lat.runs} runs. Target: p50 under ${lat.target} ms. ${verdict(lat.p50, (p) => p < lat.target)}`,
  ].join("\n");
}

/**
 * Formats a rate as a percentage in parentheses.
 *
 * @param rate - a fraction, or null.
 * @returns e.g. ` (83%)`, or empty for null.
 */
function share(rate: number | null): string {
  return rate === null ? "" : ` (${Math.round(rate * PERCENT)}%)`;
}

/**
 * Says whether a number meets its target.
 *
 * @param value - the number, or null when there is no data.
 * @param meets - the target test.
 * @returns "Met.", "Not met." or "No data yet."
 */
function verdict(value: number | null, meets: (v: number) => boolean): string {
  if (value === null) {
    return "No data yet.";
  }
  return meets(value) ? "Met." : "Not met.";
}

/**
 * Tells whether a parsed value is an object.
 *
 * @param value - the value.
 * @returns true for a non-null, non-array object.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Tells whether a value is an array of strings.
 *
 * @param value - the value.
 * @returns true for string[].
 */
function isStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

/**
 * Tells whether a value is one entry of a line's `lines`.
 *
 * @param value - the value.
 * @returns true for `{file, added, removed}`.
 */
function isLineCount(value: unknown): value is RunLine["lines"][number] {
  return (
    isRecord(value) &&
    typeof value["file"] === "string" &&
    typeof value["added"] === "number" &&
    typeof value["removed"] === "number"
  );
}
