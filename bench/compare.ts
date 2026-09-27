/**
 * @file Compares two `inwards` binaries on the synthetic repo (bench/generate.py):
 * the base branch's build and the PR's build, run in the same job so runner
 * noise hits both alike. Runs alternate (base, head, base, head, …) for the
 * same reason. The job fails when, on any metric, the median of the per-pair
 * ratios (head run / the base run next to it) is more than the threshold
 * above 1, or when either binary fails a run.
 *
 *   bun run bench/compare.ts --base /tmp/base/inwards --head dist/inwards-linux-x64 --repo /tmp/inwards-bench
 *
 * Metrics:
 * - hook: `inwards hook claude-code` with a PostToolUse payload for one file,
 *   the quality goal's "a hook checks one edited file" (p95 < 100 ms);
 * - full: a cold `inwards check` of the whole repo.
 *
 * With 12 full runs, the "p95" column is the slowest run.
 *
 * Prints a Markdown table (for $GITHUB_STEP_SUMMARY) and writes JSON with the
 * raw samples and the runner it ran on.
 */
import { rmSync, writeFileSync } from "node:fs";
import { arch, cpus, platform } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";

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

const DEFAULTS = { hookRuns: 40, fullRuns: 12, warmup: 2, threshold: 0.2 };
const PERCENT = 100;
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
function summarise(samples: readonly number[]): { p50: number; p95: number } {
  return { p50: percentile(samples, P50), p95: percentile(samples, P95) };
}

/**
 * Formats milliseconds to one decimal.
 *
 * @param x - milliseconds.
 * @returns e.g. `42.4`.
 */
function ms(x: number): string {
  return x.toFixed(1);
}

/**
 * Renders the verdicts as a Markdown table.
 *
 * @param verdicts - one per metric.
 * @param threshold - the allowed slowdown, for the heading.
 * @returns the table with a one-line result.
 */
export function markdown(verdicts: readonly Verdict[], threshold: number): string {
  const rows = verdicts.map(
    (v) =>
      `| ${v.metric} | ${ms(v.base.p50)} / ${ms(v.base.p95)} | ${ms(v.head.p50)} / ${ms(v.head.p95)} | ${((v.ratio - 1) * PERCENT).toFixed(1)}% | ${v.pass ? "ok" : "**slower**"} |`,
  );
  const failed = verdicts.filter((v) => !v.pass).map((v) => v.metric);
  const result =
    failed.length === 0
      ? `No metric is more than ${threshold * PERCENT}% slower than the base.`
      : `**${failed.join(", ")} more than ${threshold * PERCENT}% slower than the base.**`;
  return [
    "| Metric | Base p50 / p95 (ms) | Head p50 / p95 (ms) | Change (median of pairs) | |",
    "|---|---|---|---|---|",
    ...rows,
    "",
    result,
  ].join("\n");
}

/**
 * Times one run of a command, wall clock, process start included. The
 * synthetic repo is clean, so every run must exit 0: a binary that crashes or
 * fails early would otherwise look fast.
 *
 * @param cmd - the command and its arguments.
 * @param cwd - the working directory.
 * @param stdin - text for stdin, if any.
 * @returns the elapsed milliseconds.
 * @throws {Error} when the command exits non-zero or is killed by a signal.
 */
function timeRun(cmd: string[], cwd: string, stdin?: string): number {
  const started = performance.now();
  const run = Bun.spawnSync(cmd, {
    cwd,
    stdin: stdin === undefined ? "ignore" : new TextEncoder().encode(stdin),
    env: { ...process.env, CLAUDE_PROJECT_DIR: cwd },
  });
  const elapsed = performance.now() - started;
  if (run.exitCode !== 0 || run.signalCode) {
    const how = run.signalCode ? `was killed by ${run.signalCode}` : `exited ${run.exitCode}`;
    throw new Error(`${cmd.join(" ")} ${how}: ${run.stderr.toString()}`);
  }
  return elapsed;
}

/**
 * Runs both binaries alternately and collects the samples.
 *
 * @param binaries - the two builds to compare.
 * @param binaries.base - the base branch's executable.
 * @param binaries.head - the head branch's executable.
 * @param args - how to run one check.
 * @param args.argv - the arguments after the executable.
 * @param args.cwd - the working directory.
 * @param args.stdin - text for standard input, if any.
 * @param runs - how many runs.
 * @param runs.measured - measured runs per binary.
 * @param runs.warmup - unmeasured runs per binary before those.
 * @returns the samples.
 */
function alternate(
  binaries: { base: string; head: string },
  args: { argv: string[]; cwd: string; stdin?: string },
  runs: { measured: number; warmup: number },
): Samples {
  const samples: Samples = { base: [], head: [] };
  for (let i = 0; i < runs.warmup + runs.measured; i += 1) {
    const order = i % 2 === 0 ? (["base", "head"] as const) : (["head", "base"] as const);
    for (const which of order) {
      const elapsed = timeRun([binaries[which], ...args.argv], args.cwd, args.stdin);
      if (i >= runs.warmup) {
        samples[which].push(elapsed);
      }
    }
  }
  return samples;
}

/** The validated command line. */
interface Options {
  base: string;
  head: string;
  repo: string;
  out: string;
  threshold: number;
  hookRuns: number;
  fullRuns: number;
}

/**
 * Reads and checks the command line.
 *
 * @returns the options, or the message to print for a usage error.
 */
function readOptions(): Options | string {
  const { values } = parseArgs({
    options: {
      base: { type: "string" },
      head: { type: "string" },
      repo: { type: "string" },
      out: { type: "string", default: "bench-result.json" },
      threshold: { type: "string", default: String(DEFAULTS.threshold) },
      "hook-runs": { type: "string", default: String(DEFAULTS.hookRuns) },
      "full-runs": { type: "string", default: String(DEFAULTS.fullRuns) },
    },
  });
  const { base, head, repo, out } = values;
  if (!(base && head && repo)) {
    return "usage: compare.ts --base <bin> --head <bin> --repo <synthetic repo>";
  }
  const threshold = Number(values.threshold);
  const hookRuns = Number(values["hook-runs"]);
  const fullRuns = Number(values["full-runs"]);
  if (!(threshold > 0 && threshold < 1)) {
    return "--threshold must be a fraction between 0 and 1 (0.2 is 20%)";
  }
  if (![hookRuns, fullRuns].every((n) => Number.isInteger(n) && n > 0)) {
    return "--hook-runs and --full-runs must be positive integers";
  }
  return { base, head, repo, out, threshold, hookRuns, fullRuns };
}

/**
 * Reads the options, measures, prints the table and writes the JSON result.
 *
 * @returns 0 when every metric passes, 1 otherwise, 2 for a usage error.
 */
function main(): number {
  const options = readOptions();
  if (typeof options === "string") {
    process.stderr.write(`${options}\n`);
    return 2;
  }
  const { base, head, repo, threshold, hookRuns, fullRuns } = options;
  const file = join(repo, "src/shop/domain/p0/m0.py");
  const payload = JSON.stringify({
    session_id: "bench",
    hook_event_name: "PostToolUse",
    tool_name: "Edit",
    cwd: repo,
    tool_input: { file_path: file },
  });
  const binaries = { base: resolve(base), head: resolve(head) };
  // Every hook run appends to the "bench" session's log; start from none.
  rmSync(join(repo, ".inwards"), { recursive: true, force: true });
  const hook = alternate(
    binaries,
    { argv: ["hook", "claude-code"], cwd: repo, stdin: payload },
    { measured: hookRuns, warmup: DEFAULTS.warmup },
  );
  const full = alternate(
    binaries,
    { argv: ["check"], cwd: repo },
    { measured: fullRuns, warmup: 1 },
  );
  const verdicts = [
    judge("hook (one file)", hook, threshold),
    judge("full check", full, threshold),
  ];
  const runner = {
    os: `${platform()} ${arch()}`,
    cpu: cpus()[0]?.model ?? "unknown",
    cores: cpus().length,
    label: process.env["RUNNER_NAME"] ?? "local",
    bun: Bun.version,
  };
  process.stdout.write(
    `${markdown(verdicts, threshold)}\n\nRunner: ${runner.os}, ${runner.cpu} (${runner.cores} cores), ${runner.label}\n`,
  );
  writeFileSync(
    options.out,
    `${JSON.stringify({ runner, threshold, verdicts, samples: { hook, full } }, null, 2)}\n`,
  );
  return verdicts.every((v) => v.pass) ? 0 : 1;
}

if (import.meta.main) {
  process.exitCode = main();
}
