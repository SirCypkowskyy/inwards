/**
 * Runs the real-repo corpus (bench/corpus.json): fetches each repo at its
 * pinned commit, runs the prescan differential test on its Python files, and
 * times `inwards check` on it, whole and on one file, with a compiled binary.
 * Run nightly by .github/workflows/corpus.yml.
 *
 *   bun run scripts/build-binaries.ts bun-linux-x64
 *   bun run bench/corpus.ts --bin dist/inwards-linux-x64 --dir ~/.cache/inwards-corpus
 *
 * A checkout already at its pinned commit is reused, so a second local run
 * downloads nothing. The check runs with the manifest's layers, written to
 * `inwards-corpus.toml` in the checkout and passed with `--config`, since
 * none of these repos has a `[tool.inwards]` table.
 *
 * Fails when the prescan misses an import, a checkout has a different number
 * of .py files than the manifest says, or `inwards check` exits with anything
 * but 0 or 1 (1 is expected: our layering finds violations in these repos).
 *
 * Prints a Markdown table (for $GITHUB_STEP_SUMMARY) and writes JSON with the
 * prescan counts, the raw samples and the runner it ran on.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { arch, cpus, platform } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";
import { Glob } from "bun";
import { percentile } from "./compare.ts";
import { CONFIG_FILE, fetchRepo } from "./corpus-fetch.ts";
import { isRecord, type Repo, readManifest, toml } from "./corpus-manifest.ts";

/** The prescan differential test's counts for one corpus. */
export interface PrescanCounts {
  files: number;
  refused: number;
  extra: number;
  hinted: number;
  missed: number;
}

/** Everything measured on one repo. */
interface RepoResult {
  name: string;
  sha: string;
  lines: number;
  prescan: PrescanCounts;
  check: { filesChecked: number; violations: number; warnings: number };
  samples: { full: number[]; file: number[] };
  /** Why the repo's fetch or a timed run failed; absent when all went well. */
  error?: string;
}

const DEFAULTS = { fullRuns: 5, fileRuns: 20 };
const P50 = 0.5;
const P95 = 0.95;
/** Characters of a SHA shown in the table. */
const SHORT_SHA = 7;
/** The line prescan-diff prints for a corpus, after its label. */
const PRESCAN_LINE =
  /files=(?<files>\d+) refused=(?<refused>\d+) .*extra=(?<extra>\d+) hinted=(?<hinted>\d+) missed=(?<missed>\d+)/u;
const PRESCAN_DIFF = resolve(import.meta.dir, "../src/core/scripts/prescan-diff.ts");

/**
 * Reads the summary line prescan-diff prints for a directory corpus.
 *
 * @param stdout - prescan-diff's output.
 * @param dir - the directory it was given, which labels the line.
 * @returns the counts, or undefined when the line is missing.
 */
export function parsePrescan(stdout: string, dir: string): PrescanCounts | undefined {
  const line = stdout.split("\n").find((l) => l.startsWith(`${dir}: `));
  const m = line === undefined ? undefined : PRESCAN_LINE.exec(line)?.groups;
  if (!m) {
    return undefined;
  }
  return {
    files: Number(m["files"]),
    refused: Number(m["refused"]),
    extra: Number(m["extra"]),
    hinted: Number(m["hinted"]),
    missed: Number(m["missed"]),
  };
}

/**
 * Counts the lines of every .py file under a directory, hidden ones excluded
 * as prescan-diff excludes them.
 *
 * @param dir - the checkout.
 * @returns the line count.
 */
function pythonLines(dir: string): number {
  let lines = 0;
  for (const rel of new Glob("**/*.py").scanSync(dir)) {
    lines += readFileSync(join(dir, rel), "utf8").split("\n").length - 1;
  }
  return lines;
}

/**
 * Runs the prescan differential test on one checkout. prescan-diff exits 1
 * on a miss or on fewer .py files than expected; more files than expected
 * is caught here, since a pinned commit can't grow.
 *
 * @param repo - the manifest entry.
 * @param dir - the checkout.
 * @returns the counts, and whether the test passed.
 */
function prescan(repo: Repo, dir: string): { counts: PrescanCounts; ok: boolean } {
  const res = Bun.spawnSync(
    [process.execPath, "run", PRESCAN_DIFF, dir, String(repo.pythonFiles)],
    { stderr: "pipe" },
  );
  const stderr = res.stderr.toString();
  if (stderr !== "") {
    process.stderr.write(stderr);
  }
  const counts = parsePrescan(res.stdout.toString(), dir);
  if (!counts) {
    return { counts: { files: 0, refused: 0, extra: 0, hinted: 0, missed: 0 }, ok: false };
  }
  if (counts.files !== repo.pythonFiles) {
    process.stderr.write(
      `${repo.name}: ${counts.files} .py files, manifest says ${repo.pythonFiles}\n`,
    );
  }
  return { counts, ok: res.exitCode === 0 && counts.files === repo.pythonFiles };
}

/**
 * Times one `inwards check`, wall clock, process start included. Exit 1 is
 * fine (violations); anything else means the binary failed and a fast
 * failure must not pass for a fast check.
 *
 * @param bin - the inwards executable.
 * @param argv - arguments after `inwards`.
 * @param cwd - the checkout.
 * @returns the elapsed milliseconds and stdout.
 * @throws {Error} when the check exits 2 or more, or is killed.
 */
function timeCheck(bin: string, argv: string[], cwd: string): { ms: number; stdout: string } {
  const started = performance.now();
  const res = Bun.spawnSync([bin, ...argv], { cwd, stderr: "pipe" });
  const elapsed = performance.now() - started;
  if (res.signalCode || (res.exitCode !== 0 && res.exitCode !== 1)) {
    const how = res.signalCode ? `was killed by ${res.signalCode}` : `exited ${res.exitCode}`;
    throw new Error(`inwards ${argv.join(" ")} in ${cwd} ${how}: ${res.stderr.toString()}`);
  }
  return { ms: elapsed, stdout: res.stdout.toString() };
}

/**
 * Times a command `runs` times after one unmeasured run.
 *
 * @param bin - the inwards executable.
 * @param argv - arguments after `inwards`.
 * @param cwd - the checkout.
 * @param runs - measured runs.
 * @returns the samples in milliseconds, and the warm-up run's stdout.
 */
function sample(
  bin: string,
  argv: string[],
  cwd: string,
  runs: number,
): { samples: number[]; stdout: string } {
  const { stdout } = timeCheck(bin, argv, cwd);
  const samples = Array.from({ length: runs }, () => timeCheck(bin, argv, cwd).ms);
  return { samples, stdout };
}

/**
 * Reads the summary counts from `inwards check --format json`.
 *
 * @param stdout - the check's output.
 * @returns files checked, violations and warnings; zeros when absent.
 */
function checkSummary(stdout: string): RepoResult["check"] {
  const doc: unknown = JSON.parse(stdout);
  const summary = isRecord(doc) && isRecord(doc["summary"]) ? doc["summary"] : {};
  return {
    filesChecked: Number(summary["filesChecked"] ?? 0),
    violations: Number(summary["violations"] ?? 0),
    warnings: Number(summary["warnings"] ?? 0),
  };
}

/**
 * Formats milliseconds to whole numbers.
 *
 * @param xs - samples.
 * @param p - the percentile as a fraction.
 * @returns e.g. `412`, or `n/a` when a failed run left no samples.
 */
function ms(xs: readonly number[], p: number): string {
  return xs.length === 0 ? "n/a" : percentile(xs, p).toFixed(0);
}

/**
 * Renders the results as a Markdown table.
 *
 * @param results - one per repo.
 * @returns the table.
 */
export function markdown(results: readonly RepoResult[]): string {
  const rows = results.map(
    (r) =>
      `| ${r.name} | \`${r.sha.slice(0, SHORT_SHA)}\` | ${r.prescan.files} | ${r.lines} | ${r.prescan.refused} | ${r.prescan.missed === 0 ? "0" : `**${r.prescan.missed}**`} | ${r.check.filesChecked} | ${ms(r.samples.full, P50)} / ${ms(r.samples.full, 1)} | ${ms(r.samples.file, P50)} / ${ms(r.samples.file, P95)} | ${r.check.violations} |`,
  );
  return [
    "| Repo | Commit | .py files | Lines | Prescan refused | Prescan missed | Files checked | Full check p50 / max (ms) | One file p50 / p95 (ms) | Violations (our layers) |",
    "|---|---|--:|--:|--:|--:|--:|--:|--:|--:|",
    ...rows,
    ...results.flatMap((r) =>
      r.error === undefined ? [] : ["", `**${r.name} failed:** ${r.error.split("\n")[0]}`],
    ),
  ].join("\n");
}

/**
 * Fetches one repo, runs the prescan test on it and times the checks. A
 * failure is recorded in the result instead of thrown, so the other repos
 * still run and corpus-result.json is still written.
 *
 * @param repo - the manifest entry.
 * @param dir - where its checkout goes.
 * @param options - the binary and the run counts.
 * @returns what was measured, and whether the repo passed.
 */
function measure(repo: Repo, dir: string, options: Options): { result: RepoResult; ok: boolean } {
  const result: RepoResult = {
    name: repo.name,
    sha: repo.sha,
    lines: 0,
    prescan: { files: 0, refused: 0, extra: 0, hinted: 0, missed: 0 },
    check: { filesChecked: 0, violations: 0, warnings: 0 },
    samples: { full: [], file: [] },
  };
  try {
    fetchRepo(repo, dir);
    writeFileSync(join(dir, CONFIG_FILE), toml(repo.config));
    const scan = prescan(repo, dir);
    result.prescan = scan.counts;
    result.lines = pythonLines(dir);
    const { bin, fullRuns, fileRuns } = options;
    const full = sample(bin, ["check", "--config", CONFIG_FILE, "--format", "json"], dir, fullRuns);
    result.check = checkSummary(full.stdout);
    result.samples.full = full.samples;
    result.samples.file = sample(
      bin,
      ["check", "--config", CONFIG_FILE, repo.file],
      dir,
      fileRuns,
    ).samples;
    return { result, ok: scan.ok };
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    process.stderr.write(`${repo.name}: ${result.error}\n`);
    return { result, ok: false };
  }
}

/** The validated command line. */
interface Options {
  bin: string;
  dir: string;
  out: string;
  fullRuns: number;
  fileRuns: number;
}

/**
 * Reads and checks the command line.
 *
 * @returns the options, or the message to print for a usage error.
 */
function readOptions(): Options | string {
  const { values } = parseArgs({
    options: {
      bin: { type: "string" },
      dir: { type: "string" },
      out: { type: "string", default: "corpus-result.json" },
      "full-runs": { type: "string", default: String(DEFAULTS.fullRuns) },
      "file-runs": { type: "string", default: String(DEFAULTS.fileRuns) },
    },
  });
  const { bin, dir, out } = values;
  if (!(bin && dir)) {
    return "usage: corpus.ts --bin <inwards binary> --dir <checkout directory> [--out corpus-result.json]";
  }
  const fullRuns = Number(values["full-runs"]);
  const fileRuns = Number(values["file-runs"]);
  if (![fullRuns, fileRuns].every((n) => Number.isInteger(n) && n > 0)) {
    return "--full-runs and --file-runs must be positive integers";
  }
  return { bin: resolve(bin), dir: resolve(dir), out, fullRuns, fileRuns };
}

/**
 * Fetches, tests and times every repo, prints the table and writes the JSON.
 *
 * @returns 0 when the prescan missed nothing and every corpus had its expected size, 1 otherwise, 2 for a usage error.
 */
function main(): number {
  const options = readOptions();
  if (typeof options === "string") {
    process.stderr.write(`${options}\n`);
    return 2;
  }
  const { bin, fullRuns, fileRuns } = options;
  const repos = readManifest(join(import.meta.dir, "corpus.json"));
  const results: RepoResult[] = [];
  let ok = true;
  for (const repo of repos) {
    const measured = measure(repo, join(options.dir, repo.name), options);
    results.push(measured.result);
    ok &&= measured.ok;
  }
  const runner = {
    os: `${platform()} ${arch()}`,
    cpu: cpus()[0]?.model ?? "unknown",
    cores: cpus().length,
    label: process.env["RUNNER_NAME"] ?? "local",
    bun: Bun.version,
    inwards: Bun.spawnSync([bin, "--version"]).stdout.toString().trim() || "unknown",
  };
  process.stdout.write(
    `${markdown(results)}\n\n${ok ? "The prescan missed no import and every run finished." : "**The corpus run failed; see above and the log.**"} ${fullRuns} full and ${fileRuns} single-file runs per repo, after one warm-up each.\n\nRunner: ${runner.os}, ${runner.cpu} (${runner.cores} cores), ${runner.label}, inwards ${runner.inwards}\n`,
  );
  writeFileSync(options.out, `${JSON.stringify({ runner, results }, null, 2)}\n`);
  return ok ? 0 : 1;
}

if (import.meta.main) {
  process.exitCode = main();
}
