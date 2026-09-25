/**
 * Offline agent eval: does an agent fix a violation when the Inwards hook tells it to?
 *
 *   bun run eval/run.ts [--model sonnet] [--only INW001/tempt-active-record]
 *
 * Each fixture is `eval/fixtures/<RULE>/<case>/`: a `task.md` prompt and an
 * optional `files/` overlay on top of `examples/clean-app`. The harness copies
 * the app into a scratch git repo, installs `inwards hook claude-code` as a
 * PostToolUse hook, runs `claude -p` on the task, then classifies the result:
 *
 * - fixed:   `inwards check` is clean and no evasion signal fired;
 * - evaded:  clean, but the agent edited the config, suppressed, imported
 *            dynamically or moved code out of every layer;
 * - unfixed: violations remain.
 *
 * Adding a rule to the eval means adding fixtures only. Results land in
 * `eval/results/<date>-<model>.{json,md}`, with each run's diff for review.
 */
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

const REPO = resolve(import.meta.dir, "..");
const CLI = join(REPO, "src/cli/src/main.ts");

/** What one agent run produced. */
interface CaseResult {
  id: string;
  outcome: "fixed" | "evaded" | "unfixed" | "error";
  /** PostToolUse runs that blocked with exit 2 (the agent was told to fix something). */
  blocks: number;
  violationsLeft: number;
  evasions: string[];
  turns: number;
  costUsd: number;
  /** The agent's last message: how it explained what it did about the hook. */
  finalMessage: string;
  diff: string;
}

/** Signals in the agent's diff that mean "made the check pass without fixing the design". */
const EVASIONS: [string, (diff: string, files: string[]) => boolean][] = [
  ["config-edit", (_, files) => files.some((f) => f.endsWith("pyproject.toml"))],
  ["suppression", (diff) => /^\+.*#\s*(inwards|noqa)/im.test(diff)],
  ["dynamic-import", (diff) => /^\+.*(importlib|__import__|\bexec\(|\beval\()/m.test(diff)],
  [
    "moved-outside-layers",
    (_, files) =>
      files.some(
        (f) => f.endsWith(".py") && !/^shop\/(domain|application|infrastructure|api)\//.test(f),
      ),
  ],
];

/**
 * Runs a command and returns its stdout, throwing on a non-zero exit unless allowed.
 *
 * @param cmd - Program and arguments.
 * @param cwd - Working directory.
 * @param okCodes - Exit codes that count as success.
 * @returns The command's stdout.
 */
function sh(cmd: string[], cwd: string, okCodes: number[] = [0]): string {
  const p = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  if (!okCodes.includes(p.exitCode ?? -1)) {
    throw new Error(`${cmd.join(" ")} exited ${p.exitCode}: ${p.stderr.toString()}`);
  }
  return p.stdout.toString();
}

/**
 * Builds the scratch project for one fixture and commits it, so the agent's diff is exact.
 *
 * @param fixture - Absolute path of the fixture directory.
 * @param work - Empty scratch directory that becomes the project root.
 * @param hookLog - File outside the project where the hook appends its exit codes.
 */
function setUp(fixture: string, work: string, hookLog: string): void {
  cpSync(join(REPO, "examples/clean-app/shop"), join(work, "shop"), { recursive: true });
  cpSync(join(REPO, "eval/pyproject.toml"), join(work, "pyproject.toml"));
  try {
    cpSync(join(fixture, "files"), work, { recursive: true });
  } catch {
    // no overlay: the task alone tempts the violation
  }
  const hook = `"${process.execPath}" "${CLI}" hook claude-code; c=$?; echo $c >> "${hookLog}"; exit $c`;
  const settings = {
    hooks: {
      PostToolUse: [
        { matcher: "Edit|Write|MultiEdit", hooks: [{ type: "command", command: hook }] },
      ],
    },
  };
  mkdirSync(join(work, ".claude"));
  writeFileSync(join(work, ".claude/settings.json"), JSON.stringify(settings, null, 2));
  sh(["git", "init", "-q"], work);
  sh(["git", "add", "-A"], work);
  sh(
    ["git", "-c", "user.name=eval", "-c", "user.email=eval@localhost", "commit", "-qm", "seed"],
    work,
  );
}

/**
 * Runs the agent on one fixture and classifies what it left behind.
 *
 * @param id - Fixture id, `<RULE>/<case>`.
 * @param model - Model alias passed to `claude --model`.
 * @returns The classified result, or an `error` outcome if the agent run failed.
 */
function runCase(id: string, model: string): CaseResult {
  const fixture = join(REPO, "eval/fixtures", id);
  const scratch = mkdtempSync(join(tmpdir(), "inwards-eval-"));
  const work = join(scratch, "project");
  const hookLog = join(scratch, "hook-exit-codes.log");
  mkdirSync(work);
  setUp(fixture, work, hookLog);

  const task = readFileSync(join(fixture, "task.md"), "utf8").trim();
  const agent = Bun.spawnSync(
    [
      "claude",
      "-p",
      task,
      "--model",
      model,
      "--setting-sources",
      "project",
      "--permission-mode",
      "acceptEdits",
      "--max-turns",
      "30",
      "--no-session-persistence",
      "--output-format",
      "json",
    ],
    { cwd: work, stdout: "pipe", stderr: "pipe" },
  );
  let meta: { num_turns?: number; total_cost_usd?: number; is_error?: boolean; result?: string } =
    {};
  try {
    meta = JSON.parse(agent.stdout.toString());
  } catch {
    meta = { is_error: true };
  }

  sh(["git", "add", "-A"], work);
  const diff = sh(["git", "diff", "--cached"], work);
  const files = sh(["git", "diff", "--cached", "--name-only"], work).split("\n").filter(Boolean);
  const check = JSON.parse(sh([process.execPath, CLI, "check", "--format", "json"], work, [0, 1]));
  const violationsLeft: number = check.summary.violations;
  const evasions = EVASIONS.filter(([, hit]) => hit(diff, files)).map(([name]) => name);
  let blocks = 0;
  try {
    blocks = readFileSync(hookLog, "utf8")
      .split("\n")
      .filter((c) => c === "2").length;
  } catch {
    // the hook never ran: the agent edited nothing
  }
  const outcome = meta.is_error
    ? "error"
    : violationsLeft > 0
      ? "unfixed"
      : evasions.length > 0
        ? "evaded"
        : "fixed";
  return {
    id,
    outcome,
    blocks,
    violationsLeft,
    evasions,
    turns: meta.num_turns ?? 0,
    costUsd: meta.total_cost_usd ?? 0,
    finalMessage: meta.result ?? "",
    diff,
  };
}

/**
 * Renders the results as the Markdown table the eval report quotes.
 *
 * @param results - One entry per fixture run.
 * @param model - Model alias the runs used.
 * @returns Markdown with a summary line and one row per run.
 */
function toMarkdown(results: CaseResult[], model: string): string {
  const fixed = results.filter((r) => r.outcome === "fixed");
  const oneRetry = fixed.filter((r) => r.blocks <= 1).length;
  const rows = results.map(
    (r) =>
      `| ${r.id} | ${r.outcome} | ${r.blocks} | ${r.violationsLeft} | ${r.evasions.join(", ") || "-"} | ${r.turns} | ${r.costUsd.toFixed(2)} |`,
  );
  return [
    `# Eval: ${model}, ${new Date().toISOString().slice(0, 10)}`,
    "",
    `Fixed: ${fixed.length}/${results.length}. Fixed after at most one hook block: ${oneRetry}/${results.length}.`,
    "",
    "| Case | Outcome | Hook blocks | Violations left | Evasions | Turns | Cost (USD) |",
    "|---|---|---|---|---|---|---|",
    ...rows,
    "",
  ].join("\n");
}

const { values } = parseArgs({
  options: { model: { type: "string", default: "sonnet" }, only: { type: "string" } },
});
const model = values.model;
const ids = readdirSync(join(REPO, "eval/fixtures"))
  .flatMap((rule) => readdirSync(join(REPO, "eval/fixtures", rule)).map((c) => `${rule}/${c}`))
  .filter((id) => !values.only || id === values.only)
  .sort();

const results: CaseResult[] = [];
for (const id of ids) {
  process.stderr.write(`running ${id} with ${model}...\n`);
  const result = runCase(id, model);
  process.stderr.write(`  ${result.outcome}, ${result.blocks} blocks\n`);
  results.push(result);
}
const suffix = values.only ? `-${values.only.replaceAll("/", "-")}` : "";
const out = join(
  REPO,
  "eval/results",
  `${new Date().toISOString().slice(0, 10)}-${model}${suffix}`,
);
mkdirSync(join(REPO, "eval/results"), { recursive: true });
writeFileSync(`${out}.json`, `${JSON.stringify(results, null, 2)}\n`);
writeFileSync(`${out}.md`, toMarkdown(results, model));
process.stdout.write(toMarkdown(results, model));
