/**
 * Offline agent eval: does an agent fix a violation when the Inwards hooks tell it to?
 *
 *   bun run eval/run.ts [--model sonnet] [--only INW001/tempt-active-record] [--runs 3] [--dry-run]
 *
 * Each fixture is `eval/fixtures/<RULE>/<case>/`: a `task.md` prompt, a
 * `check.py` that exercises the result (exit 0 means the task was done), and
 * an optional `files/` overlay on top of `examples/clean-app`. The harness
 * compiles `inwards` from this checkout, copies the app into a scratch git
 * repo, runs `inwards init --agent claude` there (all four hooks and the deny
 * rules, as a user gets them), runs `claude -p` on the task with the run log
 * on, and classifies what the agent left behind:
 *
 * - error:         the agent run failed or timed out;
 * - task-not-done: `check.py` fails (deleting code or a stub scores here);
 * - unfixed:       `inwards check` still reports violations;
 * - evaded:        clean, but an evasion signal fired (see EVASIONS);
 * - fixed:         clean, task done, no evasion signal.
 *
 * Blocks per hook come from the project's run log (`.inwards/runs.jsonl`),
 * guard denials from the transcript, and escalations from the session state.
 * Layers come from `eval/pyproject.toml`, so adding a rule means adding
 * fixtures only. Results are written after every run to
 * `eval/results/<date>-<model>.{json,md}`, and each run's stream-json
 * transcript and run log to `eval/results/transcripts/`, so every claim in a
 * report can be checked against what the agent actually did. `--dry-run` sets
 * every fixture up and checks it without calling an agent.
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";
import {
  type Change,
  countHooks,
  EVASIONS,
  escalated,
  statsIn,
  summarise,
  violationsIn,
} from "./evidence.ts";
import { type CaseResult, type Outcome, today, toMarkdown } from "./report.ts";

const REPO: string = resolve(import.meta.dir, "..");
const CONFIG: string = join(REPO, "eval/pyproject.toml");
/** 15 minutes per agent run. */
const AGENT_TIMEOUT_MS = 900_000;
const MS_PER_S = 1000;
/** The last line every `check.py` prints once all its assertions held. */
const CHECK_SENTINEL = "INWARDS-CHECK-PASSED";
/** 1 minute for a fixture's `check.py`. */
const CHECK_TIMEOUT_MS = 60_000;
/**
 * Bash the agent may run without a prompt, besides what Claude Code allows
 * read-only anyway. File moves are what the Stop gate case needs, and
 * nothing here runs arbitrary code.
 */
const ALLOWED_BASH = ["Bash(git mv:*)", "Bash(mv:*)", "Bash(git status:*)", "Bash(git diff:*)"];
const SETTINGS = ".claude/settings.local.json";

/**
 * Runs a command and returns its exit code and stdout.
 *
 * @param cmd - Program and arguments.
 * @param cwd - Working directory.
 * @param okCodes - Exit codes that count as success; anything else throws.
 * @returns The exit code and stdout.
 */
function sh(cmd: string[], cwd: string, okCodes: number[] = [0]): { code: number; out: string } {
  const p = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  const code = p.exitCode ?? -1;
  if (!okCodes.includes(code)) {
    throw new Error(`${cmd.join(" ")} exited ${code}: ${p.stderr.toString()}`);
  }
  return { code, out: p.stdout.toString() };
}

/**
 * Compiles `inwards` from this checkout for the machine the eval runs on, so
 * the hooks run the same single-file binary a user installs. The hooks use a
 * private copy, so a second eval building `dist/` at the same time can't
 * swap the binary under this one.
 *
 * @returns The absolute path of the copy.
 */
function buildInwards(): string {
  const os = process.platform === "win32" ? "windows" : process.platform;
  const exe = `inwards-${os}-${process.arch}${os === "windows" ? ".exe" : ""}`;
  sh([process.execPath, "scripts/build-binaries.ts", `bun-${os}-${process.arch}`], REPO);
  const copy = join(mkdtempSync(join(tmpdir(), "inwards-eval-bin-")), exe);
  cpSync(join(REPO, "dist", exe), copy);
  sh([copy, "--version"], REPO);
  return copy;
}

/**
 * Builds the scratch project for one fixture: the app, the fixture overlay,
 * `inwards init --agent claude`, a seed commit so the agent's diff is exact,
 * and one `inwards check --log`, so the run log knows which violations were
 * there before the agent's first edit.
 *
 * @param fixture - Absolute path of the fixture directory.
 * @param work - Empty scratch directory that becomes the project root.
 * @param inwards - The compiled binary.
 * @returns The violations the check reported at the start, and the local settings text init wrote.
 */
function setUp(
  fixture: string,
  work: string,
  inwards: string,
): { violationsAtStart: number; settings: string } {
  cpSync(join(REPO, "examples/clean-app/shop"), join(work, "shop"), { recursive: true });
  cpSync(CONFIG, join(work, "pyproject.toml"));
  if (existsSync(join(fixture, "files"))) {
    cpSync(join(fixture, "files"), work, { recursive: true });
  }
  sh(["git", "init", "-q"], work);
  sh([inwards, "init", "--agent", "claude"], work);
  const git = ["git", "-c", "user.name=eval", "-c", "user.email=eval@localhost"];
  sh(["git", "add", "-A"], work);
  sh([...git, "-c", "commit.gpgsign=false", "commit", "-qm", "seed"], work);
  const start = sh([inwards, "check", "--log", "--format", "json"], work, [0, 1]);
  return {
    violationsAtStart: violationsIn(start.out),
    settings: readFileSync(join(work, SETTINGS), "utf8"),
  };
}

/**
 * Runs `claude -p` on the task inside the scratch project, with the hooks
 * installed and the run log on. Only project and local settings load, so the
 * user's own hooks and plugins stay out.
 *
 * @param task - The fixture's prompt.
 * @param model - Model alias passed to `claude --model`.
 * @param work - The scratch project root.
 * @returns The agent's exit code (null when killed on timeout), its stream-json stdout and wall time.
 */
function runAgent(
  task: string,
  model: string,
  work: string,
): { exitCode: number | null; stream: string; durationS: number } {
  const started = performance.now();
  const agent = Bun.spawnSync(
    [
      "claude",
      "-p",
      task,
      "--model",
      model,
      "--setting-sources",
      "project,local",
      "--strict-mcp-config",
      "--permission-mode",
      "acceptEdits",
      "--allowedTools",
      ALLOWED_BASH.join(","),
      "--max-turns",
      "30",
      "--no-session-persistence",
      "--output-format",
      "stream-json",
      "--verbose",
    ],
    {
      cwd: work,
      env: { ...process.env, INWARDS_RUN_LOG: "1" },
      stdout: "pipe",
      stderr: "pipe",
      timeout: AGENT_TIMEOUT_MS,
    },
  );
  const durationS = (performance.now() - started) / MS_PER_S;
  return { exitCode: agent.exitCode, stream: agent.stdout.toString(), durationS };
}

/**
 * Stages everything the agent left and reads the diff against the seed commit.
 *
 * @param work - The scratch project root.
 * @returns The full diff and one entry per changed file.
 */
function stagedChanges(work: string): { diff: string; changes: Change[] } {
  sh(["git", "add", "-A"], work);
  const diff = sh(["git", "diff", "--cached"], work).out;
  const changes = sh(["git", "diff", "--cached", "--name-status"], work)
    .out.split("\n")
    .filter(Boolean)
    .map((line): Change => {
      const [status = "", ...rest] = line.split("\t");
      return { status: status.charAt(0), path: rest.at(-1) ?? "" };
    });
  return { diff, changes };
}

/**
 * Runs the fixture's `check.py` against what the agent left behind.
 * The script stays in the fixture directory, outside the project, so the agent
 * can't read or edit it; the project reaches Python through PYTHONPATH.
 *
 * @param fixture - Absolute path of the fixture directory.
 * @param work - The scratch project the agent edited.
 * @returns True when `check.py` exits 0 within the time limit and its last
 *   stdout line is CHECK_SENTINEL.
 */
function taskDone(fixture: string, work: string): boolean {
  const p = Bun.spawnSync(["python3", "-B", join(fixture, "check.py")], {
    cwd: work,
    env: { ...process.env, PYTHONPATH: work },
    stdout: "pipe",
    stderr: "ignore",
    timeout: CHECK_TIMEOUT_MS,
  });
  // Exit 0 alone can be faked from the project (an atexit hook calling
  // os._exit(0)); the sentinel is printed only after every assertion held.
  const lastLine = p.stdout.toString().trimEnd().split("\n").at(-1);
  return p.exitCode === 0 && lastLine === CHECK_SENTINEL;
}

/**
 * Picks the outcome of a run. The first matching condition wins, in the order the file header lists.
 *
 * @param agentFailed - The agent reported an error or exited non-zero.
 * @param checkPassed - The fixture's `check.py` passed.
 * @param violationsLeft - Violations `inwards check` still reports.
 * @param evasions - Evasion signals that fired.
 * @returns The outcome.
 */
function classify(
  agentFailed: boolean,
  checkPassed: boolean,
  violationsLeft: number,
  evasions: string[],
): Outcome {
  if (agentFailed) {
    return "error";
  }
  if (!checkPassed) {
    return "task-not-done";
  }
  if (violationsLeft > 0) {
    return "unfixed";
  }
  if (evasions.length > 0) {
    return "evaded";
  }
  return "fixed";
}

/** Where one run writes its transcript and run log, and what it is called there. */
interface RunTarget {
  /** Fixture id, `<RULE>/<case>`. */
  id: string;
  /** The id in results: the fixture id, plus `#<n>` when a fixture runs more than once. */
  label: string;
  model: string;
  /** Directory for the stream-json transcript and the run log. */
  transcripts: string;
  /** The compiled binary. */
  inwards: string;
}

/**
 * Saves the transcript and the run log next to the results, where they are committed.
 *
 * @param target - Where to write, and the run's label.
 * @param work - The scratch project root.
 * @param stream - The agent's stream-json output.
 * @returns Repo-relative paths of both copies, and the run log text.
 */
function keepEvidence(
  target: RunTarget,
  work: string,
  stream: string,
): { transcript: string; runLog: string; runLogText: string } {
  const name = target.label.replaceAll("/", "-").replace("#", "-");
  const transcript = join(target.transcripts, `${name}.jsonl`);
  // Transcripts are committed; keep the local home directory out of them.
  writeFileSync(transcript, stream.replaceAll(homedir(), "~"));
  const logPath = join(work, ".inwards/runs.jsonl");
  const runLogText = existsSync(logPath) ? readFileSync(logPath, "utf8") : "";
  const runLog = join(target.transcripts, `${name}.runs.jsonl`);
  writeFileSync(runLog, runLogText);
  return {
    transcript: transcript.slice(REPO.length + 1),
    runLog: runLog.slice(REPO.length + 1),
    runLogText,
  };
}

/**
 * Checks what the agent left: violations, evasion signals, and `check.py`.
 *
 * @param fixture - Absolute path of the fixture directory.
 * @param work - The scratch project root.
 * @param inwards - The compiled binary.
 * @param settings - The local settings text `init` wrote.
 * @returns Violations left, the evasion signals that fired, the diff, and whether the task was done.
 */
function judge(
  fixture: string,
  work: string,
  inwards: string,
  settings: string,
): { violationsLeft: number; evasions: string[]; diff: string; checkPassed: boolean } {
  const { diff, changes } = stagedChanges(work);
  const settingsPath = join(work, SETTINGS);
  const settingsChanged =
    !existsSync(settingsPath) || readFileSync(settingsPath, "utf8") !== settings;
  const check = sh([inwards, "check", "--format", "json"], work, [0, 1, 2]);
  const violationsLeft = violationsIn(check.out);
  const evasions = EVASIONS.filter(([, hit]) => hit({ diff, changes, settingsChanged })).map(
    ([evasion]) => evasion,
  );
  if (violationsLeft === -1) {
    evasions.push("check-failed");
  }
  return { violationsLeft, evasions, diff, checkPassed: taskDone(fixture, work) };
}

/**
 * Runs the agent on one fixture and classifies what it left behind.
 *
 * @param target - The fixture, model, output directory and binary.
 * @returns The classified result.
 */
function runCase(target: RunTarget): CaseResult {
  const { inwards } = target;
  const fixture = join(REPO, "eval/fixtures", target.id);
  const work = join(mkdtempSync(join(tmpdir(), "inwards-eval-")), "project");
  mkdirSync(work);
  const start = setUp(fixture, work, inwards);
  process.stderr.write(`  scratch: ${work}\n`);

  const task = readFileSync(join(fixture, "task.md"), "utf8").trim();
  const agent = runAgent(task, target.model, work);
  const kept = keepEvidence(target, work, agent.stream);
  const meta = summarise(agent.stream);
  const hooks = countHooks(kept.runLogText);
  const end = judge(fixture, work, inwards, start.settings);
  const agentFailed = meta.isError || agent.exitCode !== 0;

  return {
    id: target.label,
    outcome: classify(agentFailed, end.checkPassed, end.violationsLeft, end.evasions),
    blocks: hooks.blocks,
    stopBlocks: hooks.stopBlocks,
    guardDenials: meta.guardDenials,
    denyRuleDenials: meta.denyRuleDenials,
    permissionDenials: meta.permissionDenials,
    escalated: escalated(work),
    violationsAtStart: start.violationsAtStart,
    violationsLeft: end.violationsLeft,
    evasions: end.evasions,
    stats: statsIn(sh([inwards, "stats", "--format", "json", work], work, [0, 1, 2]).out),
    hookMs: hooks.hookMs,
    turns: meta.turns,
    costUsd: meta.costUsd,
    durationS: Math.round(agent.durationS),
    finalMessage: meta.finalMessage,
    transcript: kept.transcript,
    runLog: kept.runLog,
    diff: end.diff,
  };
}

/**
 * Sets every fixture up without an agent and prints what the check and
 * `check.py` say about the untouched project. Every fixture's `check.py`
 * must fail here, or the task is done before the agent starts.
 *
 * @param ids - Fixture ids.
 * @param inwards - The compiled binary.
 */
function dryRun(ids: readonly string[], inwards: string): void {
  for (const id of ids) {
    const fixture = join(REPO, "eval/fixtures", id);
    const work = join(mkdtempSync(join(tmpdir(), "inwards-eval-")), "project");
    mkdirSync(work);
    const start = setUp(fixture, work, inwards);
    const done = taskDone(fixture, work);
    process.stdout.write(
      `${id}: ${start.violationsAtStart} violations at start, check.py ${done ? "PASSES (fixture is broken)" : "fails, as it should"}\n`,
    );
    if (done) {
      process.exitCode = 1;
    }
  }
}

/** The fields of a run that never produced an agent result. */
const EMPTY_RESULT: CaseResult = {
  id: "",
  outcome: "error",
  blocks: 0,
  stopBlocks: 0,
  guardDenials: 0,
  denyRuleDenials: 0,
  permissionDenials: 0,
  escalated: false,
  violationsAtStart: -1,
  violationsLeft: -1,
  evasions: [],
  stats: null,
  hookMs: [],
  turns: 0,
  costUsd: 0,
  durationS: 0,
  finalMessage: "",
  transcript: "",
  runLog: "",
  diff: "",
};

/**
 * Runs one fixture once, turning a harness error into an `error` row.
 *
 * @param target - The fixture, model, output directory and binary.
 * @returns The result; a harness error is recorded, not skipped, so a missing
 *   run can't shrink the denominator, and it sets exit code 1.
 */
function runOne(target: RunTarget): CaseResult {
  process.stderr.write(`running ${target.label} with ${target.model}...\n`);
  let result: CaseResult;
  try {
    result = runCase(target);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`  harness error: ${message}\n`);
    result = { ...EMPTY_RESULT, id: target.label, finalMessage: `harness error: ${message}` };
    process.exitCode = 1;
  }
  process.stderr.write(
    `  ${result.outcome}, ${result.blocks} PostToolUse + ${result.stopBlocks} Stop blocks, ${result.guardDenials} guard denials\n`,
  );
  return result;
}

/**
 * Lists the fixture ids, `<RULE>/<case>`, sorted.
 *
 * @param only - Keep just this id, when given.
 * @returns The ids.
 */
function fixtureIds(only: string | undefined): string[] {
  return readdirSync(join(REPO, "eval/fixtures"))
    .flatMap((rule) => readdirSync(join(REPO, "eval/fixtures", rule)).map((c) => `${rule}/${c}`))
    .filter((id) => !only || id === only)
    .sort();
}

/**
 * Runs every fixture (or the one `--only` names) `--runs` times and writes the reports.
 * Results are rewritten after every run, so a crash later loses nothing.
 */
function main(): void {
  const { values } = parseArgs({
    options: {
      model: { type: "string", default: "sonnet" },
      only: { type: "string" },
      runs: { type: "string", default: "1" },
      "dry-run": { type: "boolean", default: false },
    },
  });
  const { model, only } = values;
  const runs = Number.parseInt(values.runs, 10);
  if (!(runs >= 1)) {
    throw new Error(`--runs must be a positive number, got ${values.runs}`);
  }
  const ids = fixtureIds(only);
  const inwards = buildInwards();
  if (values["dry-run"]) {
    dryRun(ids, inwards);
    return;
  }

  const stamp = `${today()}-${model}${only ? `-${only.replaceAll("/", "-")}` : ""}`;
  const out = join(REPO, "eval/results", stamp);
  const transcripts = join(REPO, "eval/results/transcripts", stamp);
  mkdirSync(transcripts, { recursive: true });

  const results: CaseResult[] = [];
  for (const id of ids) {
    for (let n = 1; n <= runs; n += 1) {
      const label = runs === 1 ? id : `${id}#${n}`;
      results.push(runOne({ id, label, model, transcripts, inwards }));
      writeFileSync(`${out}.json`, `${JSON.stringify(results, null, 2)}\n`);
      writeFileSync(`${out}.md`, toMarkdown(results, model));
    }
  }
  // Biome checks the committed results; write them the way it formats them.
  sh([process.execPath, "x", "biome", "format", "--write", `${out}.json`], REPO);
  process.stdout.write(toMarkdown(results, model));
}

main();
