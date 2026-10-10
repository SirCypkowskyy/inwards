/**
 * @file Timing for the bench scripts: one timed run of a command, and the
 * statistics the tables report (nearest-rank percentiles, the median of
 * per-pair ratios). `compare.ts` and `daemon.ts` share it; it prints
 * nothing and judges nothing on its own.
 */
import process from "node:process";

/** One metric's samples for both binaries, in milliseconds. */
export interface Samples {
  base: number[];
  head: number[];
}

/** The outcome for one metric. */
export interface Verdict {
  metric: string;
  base: { p50: number; p95: number };
  head: { p50: number; p95: number };
  /** Median of head[i] / base[i] over alternating pairs. */
  ratio: number;
  pass: boolean;
}

const P50 = 0.5;
const P95 = 0.95;

/**
 * Takes a percentile by the nearest-rank method.
 *
 * @param samples - measurements, in any order.
 * @param p - the percentile as a fraction, e.g. 0.95.
 * @returns the value at that rank, or NaN for no samples.
 */
export function percentile(samples: readonly number[], p: number): number {
  if (samples.length === 0) {
    return Number.NaN;
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil(p * sorted.length));
  return sorted[rank - 1] ?? Number.NaN;
}

/**
 * Judges one metric: the head fails when it is more than `threshold` slower
 * than the base. The change is the median of the per-pair ratios: runs
 * alternate, so each head run is compared with the base run next to it, and
 * load that drifts during the job cancels out within a pair. A median of
 * pairs also shrugs off the occasional scheduling spike, which p95 doesn't.
 *
 * @param metric - the metric's name.
 * @param samples - both binaries' measurements, in run order (base[i] next to head[i]).
 * @param threshold - the allowed slowdown as a fraction, e.g. 0.2 for 20%.
 * @returns the verdict.
 */
export function judge(metric: string, samples: Samples, threshold: number): Verdict {
  const pairs = Math.min(samples.base.length, samples.head.length);
  const ratios = Array.from(
    { length: pairs },
    (_, i) => (samples.head[i] ?? Number.NaN) / (samples.base[i] ?? Number.NaN),
  );
  const ratio = percentile(ratios, P50);
  return {
    metric,
    base: summarise(samples.base),
    head: summarise(samples.head),
    ratio,
    pass: ratio <= 1 + threshold,
  };
}

/**
 * Takes the median and p95 of one binary's samples.
 *
 * @param samples - measurements in milliseconds.
 * @returns p50 and p95.
 */
export function summarise(samples: readonly number[]): { p50: number; p95: number } {
  return { p50: percentile(samples, P50), p95: percentile(samples, P95) };
}

/**
 * Formats milliseconds to one decimal.
 *
 * @param x - milliseconds.
 * @returns e.g. `42.4`.
 */
export function ms(x: number): string {
  return x.toFixed(1);
}

/**
 * Times one run of a command, wall clock, process start included. The
 * synthetic repo is clean, so every run must exit 0: a binary that crashes or
 * fails early would otherwise look fast.
 *
 * @param cmd - the command and its arguments.
 * @param cwd - the working directory.
 * @param stdin - text for stdin, if any.
 * @param env - variables added to the environment.
 * @returns the elapsed milliseconds.
 * @throws {Error} when the command exits non-zero or is killed by a signal.
 */
export function timeRun(
  cmd: string[],
  cwd: string,
  stdin?: string,
  env: Record<string, string> = {},
): number {
  const started = performance.now();
  const run = Bun.spawnSync(cmd, {
    cwd,
    stdin: stdin === undefined ? "ignore" : new TextEncoder().encode(stdin),
    env: { ...process.env, CLAUDE_PROJECT_DIR: cwd, INWARDS_DAEMON: "0", ...env },
  });
  const elapsed = performance.now() - started;
  if (run.exitCode !== 0 || run.signalCode) {
    const how = run.signalCode ? `was killed by ${run.signalCode}` : `exited ${run.exitCode}`;
    throw new Error(`${cmd.join(" ")} ${how}: ${run.stderr.toString()}`);
  }
  return elapsed;
}
