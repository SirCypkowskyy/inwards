/**
 * `inwards stats`: the business-hypothesis numbers from the run log
 * (docs/chapters/08-Run-Log.md), next to the thresholds chapter 2 sets.
 * The log is read by runs.ts and the report printed by stats-command.ts.
 */
import { errorsOf, preexisting, type RunLine, ruleCodes, stopRuns } from "./runs.ts";

/** How many first-reported violations were gone at the next hook run for the same file. */
export interface RetryCount {
  reported: number;
  fixed: number;
  /** First reports with no later hook run for that file, and no Stop run still reporting them. */
  noRetry: number;
  rate: number | null;
}

/** The numbers, as `inwards stats --format json` prints them. */
export interface Stats {
  schema: "inwards/stats@1";
  sessions: number;
  /** PostToolUse runs that checked a file. */
  hookRuns: number;
  /** Lines that weren't a readable `inwards/run@1` object. */
  skippedLines: number;
  fixedWithinOneRetry: RetryCount & {
    byRule: Record<string, RetryCount>;
    target: number;
    met: boolean | null;
  };
  violationsPer1000Lines: {
    violations: number;
    linesAdded: number;
    rate: number | null;
    target: number;
    met: boolean | null;
  };
  hookLatencyMs: {
    runs: number;
    p50: number | null;
    p95: number | null;
    target: number;
    met: boolean | null;
  };
}

/** Chapter 2's thresholds: the share fixed in one retry, violations per 1,000 lines, median hook ms. */
const TARGETS = { retry: 0.8, per1000: 1, latency: 100 };
const PER_LINES = 1000;
const P50 = 0.5;
const P95 = 0.95;
const UNKNOWN_RULE = "unknown";
const SEP = "\u0000";

/** Where one session stands on one file while the log is read. */
interface FileState {
  seen: Set<string>;
  /** Fingerprints first reported at the previous run for this file, waiting for the next. */
  pending: string[];
  /** When the pending fingerprints were reported. */
  pendingAt: number;
}

/** Everything one pass over the log accumulates. */
interface Pass {
  /** Fingerprints a `check` reported before each session's first edit. */
  old: Map<string, Set<string>>;
  states: Map<string, FileState>;
  /** Each file's last hook run, from any session. */
  lastRun: Map<string, { session: string; prints: string[] }>;
  /** Each first report, and whether it was fixed (undefined: nothing settled it). */
  settled: { print: string; fixed: boolean | undefined }[];
  /** Distinct `session\0file\0fingerprint` of new violations, keyed like the retry count. */
  introduced: Set<string>;
}

/**
 * Computes the three chapter-8 numbers in one pass over the log, in time order.
 *
 * - A violation counts once per session and file, at its first report, and
 *   only if it is an error (warnings don't block the agent).
 * - It is fixed within one retry when the next hook run for that file no
 *   longer reports it. With no next run, a Stop run of the session that still
 *   reports it counts as not fixed; otherwise it is listed as without a retry.
 * - Violations that were there before the agent's first edit are left out:
 *   those a `check` run reported before it, and those the file's last hook
 *   run in an earlier session still had.
 * - Latency and run counts cover hook runs that checked a file.
 *
 * @param lines - the log, in time order.
 * @param skipped - unreadable lines, passed through for the report.
 * @returns the numbers with their targets.
 */
export function computeStats(lines: readonly RunLine[], skipped = 0): Stats {
  const hooks = lines.filter(
    (l) => l.event === "PostToolUse" && l.session_id !== null && l.files.length > 0,
  );
  const pass: Pass = {
    old: preexisting(lines, hooks),
    states: new Map(),
    lastRun: new Map(),
    settled: [],
    introduced: new Set(),
  };
  for (const run of hooks) {
    for (const file of run.files) {
      observe(pass, run, file);
    }
  }
  const stops = stopRuns(lines);
  for (const [key, state] of pass.states) {
    const later = (stops.get(key.split(SEP)[0] ?? "") ?? []).filter((s) => s.at >= state.pendingAt);
    for (const print of state.pending) {
      const stillThere = later.some((s) => s.prints.includes(print));
      pass.settled.push({ print, fixed: stillThere ? false : undefined });
    }
  }
  return summarise(hooks, pass, ruleCodes(lines), skipped);
}

/**
 * Takes one hook run for one file: settles what the previous run for that
 * file left pending, then records this run's new errors.
 *
 * @param pass - the state of the pass.
 * @param run - the hook run.
 * @param file - one of the files it checked.
 */
function observe(pass: Pass, run: RunLine, file: string): void {
  const session = run.session_id ?? "";
  const state = fileState(pass, session, file);
  for (const print of state.pending) {
    pass.settled.push({ print, fixed: !run.fingerprints.includes(print) });
  }
  // A violation another session's run on this file already had is that session's.
  const last = pass.lastRun.get(file);
  const others = last && last.session !== session ? last.prints : [];
  const fresh = errorsOf(run).filter((print) => !state.seen.has(print));
  state.pending = fresh.filter((print) => !others.includes(print));
  state.pendingAt = Date.parse(run.at);
  for (const print of fresh) {
    state.seen.add(print);
  }
  for (const print of state.pending) {
    pass.introduced.add(`${session}${SEP}${file}${SEP}${print}`);
  }
  pass.lastRun.set(file, { session, prints: run.fingerprints });
}

/**
 * Gets or starts the state for one session and file. A new state starts out
 * having seen what a `check` reported before the session's first edit, and
 * what the file's last run in another session still had.
 *
 * @param pass - the state of the pass.
 * @param session - the session id.
 * @param file - the file.
 * @returns the state.
 */
function fileState(pass: Pass, session: string, file: string): FileState {
  const key = `${session}${SEP}${file}`;
  let state = pass.states.get(key);
  if (state === undefined) {
    const last = pass.lastRun.get(file);
    const inherited = last && last.session !== session ? last.prints : [];
    const seen = new Set([...(pass.old.get(session) ?? []), ...inherited]);
    state = { seen, pending: [], pendingAt: 0 };
    pass.states.set(key, state);
  }
  return state;
}

/**
 * Builds the report from the pass.
 *
 * @param hooks - the hook runs that checked a file.
 * @param pass - the settled first reports and the new violations.
 * @param codeOf - fingerprint to rule code.
 * @param skipped - unreadable lines.
 * @returns the numbers with their targets.
 */
function summarise(
  hooks: readonly RunLine[],
  pass: Pass,
  codeOf: ReadonlyMap<string, string>,
  skipped: number,
): Stats {
  const retry = emptyCount();
  const byRule: Record<string, RetryCount> = {};
  for (const { print, fixed } of pass.settled) {
    const rule = codeOf.get(print) ?? UNKNOWN_RULE;
    byRule[rule] ??= emptyCount();
    tally(retry, fixed);
    tally(byRule[rule], fixed);
  }
  const introduced = pass.introduced.size;
  const linesAdded = hooks.reduce((n, l) => n + l.lines.reduce((m, c) => m + c.added, 0), 0);
  const latency = hooks.map((l) => l.durationMs);
  const p50 = percentile(latency, P50);
  return {
    schema: "inwards/stats@1",
    sessions: new Set(hooks.map((l) => l.session_id)).size,
    hookRuns: hooks.length,
    skippedLines: skipped,
    fixedWithinOneRetry: {
      ...withRate(retry),
      byRule: rated(byRule),
      target: TARGETS.retry,
      met: retry.reported === 0 ? null : retry.fixed >= TARGETS.retry * retry.reported,
    },
    violationsPer1000Lines: {
      violations: introduced,
      linesAdded,
      rate: linesAdded === 0 ? null : round((introduced / linesAdded) * PER_LINES),
      target: TARGETS.per1000,
      met: linesAdded === 0 ? null : introduced * PER_LINES >= TARGETS.per1000 * linesAdded,
    },
    hookLatencyMs: {
      runs: latency.length,
      p50,
      p95: percentile(latency, P95),
      target: TARGETS.latency,
      met: p50 === null ? null : p50 < TARGETS.latency,
    },
  };
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
 * @param fixed - whether it was fixed; undefined when nothing settled it.
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
