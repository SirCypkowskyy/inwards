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
 * - pre-write: `inwards hook claude-code` with a PreToolUse Write of a new
 *   Python file, which the config guard and the shape guard (#96) both see;
 * - full: a cold `inwards check` of the whole repo, with `INWARDS_NO_CACHE=1`
 *   for both binaries, so the gate compares the work itself (#56).
 *
 * With 12 full runs, the "p95" column is the slowest run.
 *
 * The hook through the daemon (#60) gets a table of its own, head only: the
 * same PostToolUse payload with `inwards daemon` running for the repo, against
 * the head's one-shot hook, and the p95 against the 50 ms target. It is
 * reported, not gated: the base branch may have no daemon to compare with.
 * Every other metric runs with `INWARDS_DAEMON=0`, so both sides run one-shot.
 *
 * The head's extraction cache (#56) gets a table of its own, head only: the
 * full check with no cache, with an empty cache (`.inwards/cache` removed
 * before each run, so it pays for every write) and with a warm one. The table
 * is reported, not gated: an empty cache's writes are a one-off cost whose
 * size depends on the runner's filesystem more than on the code.
 *
 * Prints a Markdown table (for $GITHUB_STEP_SUMMARY) and writes JSON with the
 * raw samples and the runner it ran on.
 */
import { existsSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { arch, cpus, platform } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";
import { daemonHook, daemonMarkdown } from "./daemon.ts";
import { judge, ms, type Samples, summarise, timeRun, type Verdict } from "./timing.ts";

const DEFAULTS = { hookRuns: 40, fullRuns: 12, warmup: 2, threshold: 0.2 };
const PERCENT = 100;

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
 * Runs both binaries alternately and collects the samples.
 *
 * @param binaries - the two builds to compare.
 * @param binaries.base - the base branch's executable.
 * @param binaries.head - the head branch's executable.
 * @param args - how to run one check.
 * @param args.argv - the arguments after the executable.
 * @param args.cwd - the working directory.
 * @param args.stdin - text for standard input, if any.
 * @param args.env - variables added to the environment.
 * @param runs - how many runs.
 * @param runs.measured - measured runs per binary.
 * @param runs.warmup - unmeasured runs per binary before those.
 * @returns the samples.
 */
function alternate(
  binaries: { base: string; head: string },
  args: { argv: string[]; cwd: string; stdin?: string; env?: Record<string, string> },
  runs: { measured: number; warmup: number },
): Samples {
  const samples: Samples = { base: [], head: [] };
  for (let i = 0; i < runs.warmup + runs.measured; i += 1) {
    const order = i % 2 === 0 ? (["base", "head"] as const) : (["head", "base"] as const);
    for (const which of order) {
      const elapsed = timeRun([binaries[which], ...args.argv], args.cwd, args.stdin, args.env);
      if (i >= runs.warmup) {
        samples[which].push(elapsed);
      }
    }
  }
  return samples;
}

/** The head's full check in each cache mode, in milliseconds. */
export interface CacheSamples {
  none: number[];
  empty: number[];
  warm: number[];
}

/** The head's cache modes, in the order a round starts from. */
const MODES = ["none", "empty", "warm"] as const;

/**
 * Times one full check of the head in one cache mode.
 *
 * @param head - the head's executable.
 * @param repo - the synthetic repo.
 * @param mode - no cache (`INWARDS_NO_CACHE=1`), an empty one, or whatever the last run left.
 * @returns the elapsed milliseconds.
 */
function timeMode(head: string, repo: string, mode: (typeof MODES)[number]): number {
  const cache = join(repo, ".inwards", "cache");
  const old = `${cache}-old`;
  if (mode === "empty" && existsSync(cache)) {
    rmSync(old, { recursive: true, force: true });
    renameSync(cache, old);
  }
  // Set either way: an INWARDS_NO_CACHE inherited from the shell would make every mode uncached.
  const env = { INWARDS_NO_CACHE: mode === "none" ? "1" : "" };
  const elapsed = timeRun([head, "check"], repo, undefined, env);
  rmSync(old, { recursive: true, force: true });
  return elapsed;
}

/**
 * Runs the head's full check with no cache, an empty cache and a warm one.
 * Each round starts one mode later, so drifting load hits all three alike;
 * a warm run always follows an earlier cached one. The empty run's old
 * cache is renamed away before it and deleted after, so removing 2,100
 * files isn't timed with it.
 *
 * @param head - the head's executable.
 * @param repo - the synthetic repo.
 * @param runs - how many runs.
 * @param runs.measured - measured runs per mode.
 * @param runs.warmup - unmeasured rounds before those.
 * @returns the samples.
 */
function cacheModes(
  head: string,
  repo: string,
  runs: { measured: number; warmup: number },
): CacheSamples {
  const samples: CacheSamples = { none: [], empty: [], warm: [] };
  for (let i = 0; i < runs.warmup + runs.measured; i += 1) {
    for (let j = 0; j < MODES.length; j += 1) {
      const mode = MODES[(i + j) % MODES.length] ?? "none";
      const elapsed = timeMode(head, repo, mode);
      if (i >= runs.warmup) {
        samples[mode].push(elapsed);
      }
    }
  }
  return samples;
}

/**
 * Renders the head's cache modes as a Markdown table, against no cache.
 *
 * @param samples - the head's full check in each mode.
 * @returns the table.
 */
export function cacheMarkdown(samples: CacheSamples): string {
  const pairs = { base: samples.none, head: samples.empty };
  // judge only computes the paired ratio here; the verdict is ignored.
  const empty = judge("empty cache", pairs, 1);
  const warm = judge("warm cache", { base: samples.none, head: samples.warm }, 1);
  return [
    "| Full check (head) | p50 / p95 (ms) | Against no cache (median of pairs) |",
    "|---|---|---|",
    cacheRow("no cache", summarise(samples.none), ""),
    cacheRow("empty cache", empty.head, `${((empty.ratio - 1) * PERCENT).toFixed(1)}% slower`),
    cacheRow("warm cache", warm.head, `${(1 / warm.ratio).toFixed(1)}× faster`),
  ].join("\n");
}

/**
 * Renders one row of the cache table.
 *
 * @param mode - which cache mode.
 * @param s - its median and p95.
 * @param s.p50 - the median, in milliseconds.
 * @param s.p95 - the 95th percentile, in milliseconds.
 * @param vs - how it compares with no cache.
 * @returns the Markdown row.
 */
function cacheRow(mode: string, s: { p50: number; p95: number }, vs: string): string {
  return `| ${mode} | ${ms(s.p50)} / ${ms(s.p95)} | ${vs} |`;
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
 * Builds the two hook payloads the bench times.
 *
 * @param repo - the synthetic repo.
 * @returns a PostToolUse Edit of one domain module, and a PreToolUse Write of a new one.
 */
function payloads(repo: string): { payload: string; preWrite: string } {
  const payload = JSON.stringify({
    session_id: "bench",
    hook_event_name: "PostToolUse",
    tool_name: "Edit",
    cwd: repo,
    tool_input: { file_path: join(repo, "src/shop/domain/p0/m0.py") },
  });
  const preWrite = JSON.stringify({
    session_id: "bench",
    hook_event_name: "PreToolUse",
    tool_name: "Write",
    cwd: repo,
    tool_input: { file_path: join(repo, "src/shop/domain/p0/new_module.py"), content: "X = 1\n" },
  });
  return { payload, preWrite };
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
  const { payload, preWrite } = payloads(repo);
  const binaries = { base: resolve(base), head: resolve(head) };
  // Every hook run appends to the "bench" session's log; start from none.
  rmSync(join(repo, ".inwards"), { recursive: true, force: true });
  const hook = alternate(
    binaries,
    { argv: ["hook", "claude-code"], cwd: repo, stdin: payload },
    { measured: hookRuns, warmup: DEFAULTS.warmup },
  );
  const pre = alternate(
    binaries,
    { argv: ["hook", "claude-code"], cwd: repo, stdin: preWrite },
    { measured: hookRuns, warmup: DEFAULTS.warmup },
  );
  const full = alternate(
    binaries,
    { argv: ["check"], cwd: repo, env: { INWARDS_NO_CACHE: "1" } },
    { measured: fullRuns, warmup: 1 },
  );
  const verdicts = [
    judge("hook (one file)", hook, threshold),
    judge("pre-write (new file)", pre, threshold),
    judge("full check", full, threshold),
  ];
  const cache = cacheModes(binaries.head, repo, { measured: fullRuns, warmup: 1 });
  const daemon = daemonHook(binaries.head, repo, payload, {
    measured: hookRuns,
    warmup: DEFAULTS.warmup,
  });
  const runner = {
    os: `${platform()} ${arch()}`,
    cpu: cpus()[0]?.model ?? "unknown",
    cores: cpus().length,
    label: process.env["RUNNER_NAME"] ?? "local",
    bun: Bun.version,
  };
  process.stdout.write(
    `${markdown(verdicts, threshold)}\n\n${cacheMarkdown(cache)}\n\n${daemonMarkdown(daemon)}\n\nRunner: ${runner.os}, ${runner.cpu} (${runner.cores} cores), ${runner.label}\n`,
  );
  writeFileSync(
    options.out,
    `${JSON.stringify({ runner, threshold, verdicts, samples: { hook, full, cache, daemon } }, null, 2)}\n`,
  );
  return verdicts.every((v) => v.pass) ? 0 : 1;
}

if (import.meta.main) {
  process.exitCode = main();
}
