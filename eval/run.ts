/**
 * @file Offline agent eval: does an agent fix a violation when the Inwards hooks tell it to?
 *
 *   bun run eval/run.ts [--agent claude|opencode] [--model sonnet] [--runs 3]
 *                       [--only INW001/tempt-active-record] [--effort high] [--dry-run]
 *
 * Each fixture is `eval/fixtures/<RULE>/<case>/`: a `task.md` prompt (or a
 * `task.<agent>.md` for one agent), a `check.py` that exercises the result
 * (exit 0 means the task was done), and an optional `files/` overlay on top
 * of `examples/clean-app`. The harness compiles `inwards` from this checkout,
 * copies the app into a scratch git repo, runs `inwards init --agent <agent>`
 * there (the hooks as a user gets them), runs the agent on the task with the
 * run log on and a clean environment (Claude Code in agent.ts, OpenCode in
 * opencode.ts), and classifies what the agent left behind:
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
 * `eval/results/<date>-<model>.{json,md}`, and each run's transcript and run
 * log to `eval/results/transcripts/`, so every claim in a
 * report can be checked against what the agent actually did; both are scrubbed
 * of the home directory, user name and PATH. Scratch projects and the binary
 * copy are deleted afterwards. `--dry-run` sets every fixture up and checks it
 * without calling an agent.
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";
import { type AgentName, claudeDriver, type Driver, HOOK_FILE } from "./agent.ts";
import {
  type Change,
  countHooks,
  EVASIONS,
  escalated,
  scrub,
  statsIn,
  violationsIn,
} from "./evidence.ts";
import { opencodeDriver } from "./opencode.ts";
import { type CaseResult, type Outcome, today, toMarkdown } from "./report.ts";

const REPO: string = resolve(import.meta.dir, "..");
const CONFIG: string = join(REPO, "eval/pyproject.toml");
/** The last line every `check.py` prints once all its assertions held. */
const CHECK_SENTINEL = "INWARDS-CHECK-PASSED";
/** 1 minute for a fixture's `check.py`. */
const CHECK_TIMEOUT_MS = 60_000;

/**
 * Runs a command and returns its exit code and stdout.
 *
 * @param cmd - Program and arguments.
 * @param cwd - Working directory.
 * @param okCodes - Exit codes that count as success; anything else throws.
 * @returns The exit code and stdout.
 * @throws {Error} when the exit code isn't in `okCodes`, with the command's stderr.
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
 * `inwards init --agent <agent>`, a seed commit so the agent's diff is exact,
 * and one `inwards check --log`, so the run log knows which violations were
 * there before the agent's first edit.
 *
 * @param fixture - Absolute path of the fixture directory.
 * @param work - Empty scratch directory that becomes the project root.
 * @param inwards - The compiled binary.
 * @param agent - Which agent's hooks `init` installs.
 * @returns The violations the check reported at the start, and the hook file text init wrote.
 */
function setUp(
  fixture: string,
  work: string,
  inwards: string,
  agent: AgentName,
): { violationsAtStart: number; settings: string } {
  cpSync(join(REPO, "examples/clean-app/shop"), join(work, "shop"), { recursive: true });
  cpSync(CONFIG, join(work, "pyproject.toml"));
  if (existsSync(join(fixture, "files"))) {
    cpSync(join(fixture, "files"), work, { recursive: true });
  }
  sh(["git", "init", "-q"], work);
  sh([inwards, "init", "--agent", agent], work);
  const git = ["git", "-c", "user.name=eval", "-c", "user.email=eval@localhost"];
  sh(["git", "add", "-A"], work);
  sh([...git, "-c", "commit.gpgsign=false", "commit", "-qm", "seed"], work);
  const start = sh([inwards, "check", "--log", "--format", "json"], work, [0, 1]);
  return {
    violationsAtStart: violationsIn(start.out),
    settings: readFileSync(join(work, HOOK_FILE[agent]), "utf8"),
  };
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
  /** The agent that runs. */
  agent: Driver;
  /** Directory for the transcript and the run log. */
  transcripts: string;
  /** The compiled binary. */
  inwards: string;
}

/**
 * Saves the transcript and the run log next to the results, where they are committed.
 *
 * @param target - Where to write, and the run's label.
 * @param work - The scratch project root.
 * @param stream - The agent's transcript.
 * @returns Repo-relative paths of both copies, and the run log text.
 */
function keepEvidence(
  target: RunTarget,
  work: string,
  stream: string,
): { transcript: string; runLog: string; runLogText: string } {
  const name = target.label.replaceAll("/", "-").replace("#", "-");
  const transcript = join(target.transcripts, `${name}.jsonl`);
  // Both are committed; keep the home directory, user name and PATH out of them.
  writeFileSync(transcript, scrub(stream));
  const logPath = join(work, ".inwards/runs.jsonl");
  const runLogText = existsSync(logPath) ? readFileSync(logPath, "utf8") : "";
  const runLog = join(target.transcripts, `${name}.runs.jsonl`);
  writeFileSync(runLog, scrub(runLogText));
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
 * @param hook - The hook file's path and the text `init` wrote there.
 * @param hook.path - project-relative path of the hook file.
 * @param hook.text - its text after `init`.
 * @returns Violations left, the evasion signals that fired, the diff, and whether the task was done.
 */
function judge(
  fixture: string,
  work: string,
  inwards: string,
  hook: { path: string; text: string },
): { violationsLeft: number; evasions: string[]; diff: string; checkPassed: boolean } {
  const { diff, changes } = stagedChanges(work);
  const settings = hook.text;
  const settingsPath = join(work, hook.path);
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
 * Makes an empty scratch project directory in its own temp directory.
 *
 * @returns The project directory; remove its parent when done.
 */
function scratchProject(): string {
  const work = join(mkdtempSync(join(tmpdir(), "inwards-eval-")), "project");
  mkdirSync(work);
  return work;
}

/**
 * Reads the fixture's prompt: `task.<agent>.md` when the fixture has one for
 * this agent (a prompt that names the agent's hook file), else `task.md`.
 *
 * @param fixture - Absolute path of the fixture directory.
 * @param agent - The agent's `init` name.
 * @returns The prompt.
 */
function taskFor(fixture: string, agent: string): string {
  const own = join(fixture, `task.${agent}.md`);
  return readFileSync(existsSync(own) ? own : join(fixture, "task.md"), "utf8").trim();
}

/**
 * Runs the agent on one fixture and classifies what it left behind.
 *
 * @param target - The fixture, model, output directory and binary.
 * @param work - An empty scratch project directory.
 * @returns The classified result.
 */
async function runCase(target: RunTarget, work: string): Promise<CaseResult> {
  const { inwards, agent: driver } = target;
  const fixture = join(REPO, "eval/fixtures", target.id);
  const start = setUp(fixture, work, inwards, driver.name);

  const agent = await driver.run(taskFor(fixture, driver.name), target.model, work);
  const kept = keepEvidence(target, work, agent.stream);
  const meta = driver.summarise(agent.stream);
  const hooks = countHooks(kept.runLogText);
  const end = judge(fixture, work, inwards, { path: HOOK_FILE[driver.name], text: start.settings });
  const agentFailed = meta.isError || agent.exitCode !== 0;

  return {
    id: target.label,
    agent: driver.version,
    effort: driver.effort,
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
 * @param agent - Which agent's hooks to install.
 */
function dryRun(ids: readonly string[], inwards: string, agent: AgentName): void {
  for (const id of ids) {
    const fixture = join(REPO, "eval/fixtures", id);
    const work = scratchProject();
    const start = setUp(fixture, work, inwards, agent);
    const done = taskDone(fixture, work);
    rmSync(dirname(work), { recursive: true, force: true });
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
  agent: "",
  effort: "",
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
async function runOne(target: RunTarget): Promise<CaseResult> {
  process.stderr.write(`running ${target.label} with ${target.model}...\n`);
  let result: CaseResult;
  const work = scratchProject();
  try {
    result = await runCase(target, work);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`  harness error: ${message}\n`);
    result = { ...EMPTY_RESULT, id: target.label, finalMessage: `harness error: ${message}` };
    process.exitCode = 1;
  } finally {
    rmSync(dirname(work), { recursive: true, force: true });
  }
  process.stderr.write(
    `  ${result.outcome}, ${result.blocks} PostToolUse + ${result.stopBlocks} Stop blocks, ${result.guardDenials} guard denials\n`,
  );
  return result;
}

/**
 * Lists the fixture ids, `<RULE>/<case>`, sorted.
 *
 * @param only - When given, a comma-separated list of fixture ids or rules
 *   (`INW010`); only those fixtures are kept.
 * @returns `<RULE>/<case>` ids in sorted order.
 */
function fixtureIds(only: string | undefined): string[] {
  return readdirSync(join(REPO, "eval/fixtures"))
    .flatMap((rule) => readdirSync(join(REPO, "eval/fixtures", rule)).map((c) => `${rule}/${c}`))
    .filter((id) => !only || only.split(",").some((o) => id === o || id.startsWith(`${o}/`)))
    .sort();
}

/**
 * Makes the agent's driver from the `--agent` flag.
 *
 * @param agent - `claude` or `opencode`, as given on the command line.
 * @param effort - The `--effort` level, Claude Code only.
 * @returns Claude Code's or OpenCode's driver, ready to run.
 * @throws {Error} when the agent is unknown, or `--effort` is given for OpenCode.
 */
function driverFor(agent: string, effort: string | undefined): Driver {
  if (agent === "claude") {
    return claudeDriver(effort);
  }
  if (agent === "opencode" && effort === undefined) {
    return opencodeDriver();
  }
  throw new Error(
    `--agent must be claude or opencode, and --effort is Claude Code only; got ${agent}`,
  );
}

/**
 * Runs every fixture (or the one `--only` names) `--runs` times and writes the
 * reports, or with `--dry-run` only sets them up. The binary copy is removed
 * at the end.
 *
 * @throws {Error} when `--runs` isn't a positive number or `--agent` is unknown.
 */
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      agent: { type: "string", default: "claude" },
      model: { type: "string", default: "sonnet" },
      only: { type: "string" },
      runs: { type: "string", default: "1" },
      effort: { type: "string" },
      "dry-run": { type: "boolean", default: false },
    },
  });
  const { model, only } = values;
  const runs = Number.parseInt(values.runs, 10);
  if (!(runs >= 1)) {
    throw new Error(`--runs must be a positive number, got ${values.runs}`);
  }
  const ids = fixtureIds(only);
  if (values["dry-run"]) {
    const inwards = buildInwards();
    dryRun(ids, inwards, values.agent === "opencode" ? "opencode" : "claude");
    rmSync(dirname(inwards), { recursive: true, force: true });
    return;
  }
  const agent = driverFor(values.agent, values.effort);
  const inwards = buildInwards();
  try {
    await runAll({ ids, runs, model, only, inwards, agent });
  } finally {
    rmSync(dirname(inwards), { recursive: true, force: true });
    agent.dispose();
  }
}

/**
 * Runs the fixtures and writes the results after every run, so a crash later loses nothing.
 *
 * @param plan - What to run.
 * @param plan.ids - the fixture ids, `<RULE>/<case>`.
 * @param plan.runs - runs per fixture.
 * @param plan.model - the model the agent uses.
 * @param plan.only - the `--only` filter, recorded in the report.
 * @param plan.inwards - the path of the built inwards binary.
 * @param plan.agent - the driver every run uses.
 */
async function runAll(plan: {
  ids: string[];
  runs: number;
  model: string;
  only: string | undefined;
  inwards: string;
  agent: Driver;
}): Promise<void> {
  const { ids, runs, model, only, inwards, agent } = plan;

  // `ollama-cloud/glm-5.3` names a file as `ollama-cloud-glm-5.3`.
  const name = `${model}${only ? `-${only}` : ""}`.replaceAll(/[/:,]/gu, "-");
  const stamp = `${today()}-${name}`;
  const out = join(REPO, "eval/results", stamp);
  const transcripts = join(REPO, "eval/results/transcripts", stamp);
  mkdirSync(transcripts, { recursive: true });

  const results: CaseResult[] = [];
  for (const id of ids) {
    for (let n = 1; n <= runs; n += 1) {
      const label = runs === 1 ? id : `${id}#${n}`;
      // biome-ignore lint/performance/noAwaitInLoops: runs one at a time, so they don't compete for the model or the machine.
      results.push(await runOne({ id, label, model, agent, transcripts, inwards }));
      writeFileSync(`${out}.json`, `${JSON.stringify(results, null, 2)}\n`);
      writeFileSync(`${out}.md`, toMarkdown(results, model));
    }
  }
  // Biome checks the committed results; write them the way it formats them.
  sh([process.execPath, "x", "biome", "format", "--write", `${out}.json`], REPO);
  process.stdout.write(toMarkdown(results, model));
}

await main();
