/**
 * @file How the eval starts Claude Code: which binary, with which environment and
 * flags, and the Driver shape every agent the eval runs fills in (OpenCode's
 * is in opencode.ts). The environment is built from an allowlist, so nothing
 * from the shell that launched the eval (another Claude Code session's
 * variables, its effort level, plugin directories on PATH) reaches the agent
 * under test.
 */
import process from "node:process";
import { type AgentSummary, summarise } from "./evidence.ts";

/** 15 minutes per agent run. */
const AGENT_TIMEOUT_MS = 900_000;
const MS_PER_S = 1000;
/** System directories only: `python3` and `git` are all the agent's Bash needs. */
const SYSTEM_PATH = "/usr/local/bin:/usr/bin:/bin";
/** Variables passed through when set: locale, temp dir, and Claude Code's auth and config. */
const PASSED = [
  "HOME",
  "LANG",
  "LC_ALL",
  "TMPDIR",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "CLAUDE_CONFIG_DIR",
];
/**
 * Bash the agent may run without a prompt, besides what Claude Code allows
 * read-only anyway. `git mv` is what the Stop gate case needs, and nothing
 * here runs arbitrary code.
 */
const ALLOWED_BASH = ["Bash(git mv:*)", "Bash(git status:*)", "Bash(git diff:*)"];

/** The agents the eval runs, by their `inwards init --agent` value. */
export type AgentName = "claude" | "opencode";

/** Project-relative path of the hook file `init` writes per agent; a changed file counts as a hook edit. */
export const HOOK_FILE: Record<AgentName, string> = {
  claude: ".claude/settings.local.json",
  opencode: ".opencode/plugins/inwards.js",
};

/** An agent the eval can run: how to start it on a task and how to read what it recorded. */
export interface Driver {
  /** The `inwards init --agent` value that installs this agent's hooks. */
  name: AgentName;
  /** The agent and its version for the report, e.g. `2.1.283 (Claude Code)`. */
  version: string;
  /** The effort level or variant passed, or "default". */
  effort: string;
  /** Runs the agent on one task in the scratch project. */
  run: (task: string, model: string, work: string) => Promise<AgentRun>;
  /** Reads the transcript `run` returned. */
  summarise: (transcript: string) => AgentSummary;
  /** Removes whatever the driver set up for the whole eval. */
  dispose: () => void;
}

/** The Claude Code the eval runs, and how. */
interface AgentSetup {
  /** Absolute path of the `claude` executable. */
  claude: string;
  /** `claude --version`, e.g. `2.1.283 (Claude Code)`. */
  version: string;
  /** The `--effort` level passed, or undefined for Claude Code's default. */
  effort: string | undefined;
}

/** What one agent run returned. */
export interface AgentRun {
  /** Exit code; null when killed on timeout. */
  exitCode: number | null;
  /** The transcript: Claude Code's stream-json stdout, or OpenCode's messages as JSON Lines. */
  stream: string;
  /** Wall time, in seconds. */
  durationS: number;
}

/**
 * Builds the agent's environment from the allowlist, plus the run log switch,
 * a fixed shell and no auto memory.
 *
 * @returns The environment for `claude`.
 */
function agentEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of PASSED) {
    const value = process.env[name];
    if (value !== undefined) {
      env[name] = value;
    }
  }
  return {
    ...env,
    PATH: SYSTEM_PATH,
    SHELL: "/bin/bash",
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
    INWARDS_RUN_LOG: "1",
  };
}

/**
 * Finds `claude` on the launching shell's PATH and reads its version with the
 * agent's environment, which also shows that the clean environment can start it.
 *
 * @param effort - The `--effort` level to pass, if any.
 * @returns The setup every run uses.
 * @throws {Error} when `claude` isn't on PATH or can't start with the eval's environment.
 */
function agentSetup(effort: string | undefined): AgentSetup {
  const claude = Bun.which("claude");
  if (claude === null) {
    throw new Error("claude is not on PATH; install Claude Code and log in first");
  }
  const p = Bun.spawnSync([claude, "--version"], { env: agentEnv(), stdout: "pipe" });
  if (p.exitCode !== 0) {
    throw new Error(`${claude} --version exited ${p.exitCode} with the eval's environment`);
  }
  return { claude, version: p.stdout.toString().trim(), effort };
}

/**
 * Runs `claude -p` on the task inside the scratch project, with the hooks
 * installed and the run log on. Only project and local settings load, so the
 * user's own hooks and plugins stay out.
 *
 * @param setup - Which `claude`, and the effort level.
 * @param task - The fixture's prompt.
 * @param model - Model alias passed to `claude --model`.
 * @param work - The scratch project root.
 * @returns The exit code, the stream-json stdout and the wall time.
 */
function runAgent(setup: AgentSetup, task: string, model: string, work: string): AgentRun {
  const started = performance.now();
  const agent = Bun.spawnSync(
    [
      setup.claude,
      "-p",
      task,
      "--model",
      model,
      ...(setup.effort === undefined ? [] : ["--effort", setup.effort]),
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
    { cwd: work, env: agentEnv(), stdout: "pipe", stderr: "pipe", timeout: AGENT_TIMEOUT_MS },
  );
  const durationS = (performance.now() - started) / MS_PER_S;
  return { exitCode: agent.exitCode, stream: agent.stdout.toString(), durationS };
}

/**
 * The Claude Code driver: `claude -p` per task, stream-json transcripts.
 *
 * @param effort - The `--effort` level to pass, if any.
 * @returns What run.ts needs to start Claude Code and read its stream-json.
 * @throws {Error} when `claude` isn't on PATH or can't start with the eval's environment.
 */
export function claudeDriver(effort: string | undefined): Driver {
  const setup = agentSetup(effort);
  return {
    name: "claude",
    version: setup.version,
    effort: effort ?? "default",
    run: (task: string, model: string, work: string): Promise<AgentRun> =>
      Promise.resolve(runAgent(setup, task, model, work)),
    summarise,
    dispose: (): void => undefined,
  };
}
