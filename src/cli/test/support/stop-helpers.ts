/**
 * @file Helpers for the Stop gate tests: a git project with the Inwards hooks and a
 * started session, and the hook events an agent's turn produces.
 * They drive the CLI the way Claude Code does, through recorded payload shapes,
 * so the Stop gate is tested as it runs in a real session.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { inwards, LAYERS, payload, project, type RunResult } from "./run.ts";

export const ID = "stop-test";
export const LEAK = "import shop.infrastructure.db\n";

/**
 * Runs `inwards hook claude-code` in a project.
 *
 * @param root - the project directory.
 * @param stdin - the payload text.
 * @returns the exit code and output.
 */
function hook(root: string, stdin: string): RunResult {
  return inwards(["hook", "claude-code"], { cwd: root, stdin });
}

/**
 * Runs git in a project, with an identity so commits work on any runner.
 *
 * @param root - the project directory.
 * @param args - git arguments.
 * @throws {Error} when git fails, with its stderr.
 */
export function git(root: string, ...args: string[]): void {
  const run = Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", ...args], {
    cwd: root,
  });
  if (run.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${run.stderr.toString()}`);
  }
}

/**
 * Writes a project file, creating its directories.
 *
 * @param root - the project directory.
 * @param rel - the file, relative to the project.
 * @param text - the new content.
 */
export function put(root: string, rel: string, text: string): void {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
}

/**
 * Creates a git project with the Inwards hooks installed and a started session.
 *
 * @param files - project files besides pyproject.toml.
 * @param prepare - runs on the project before git and the session start, e.g. to add a symlink.
 * @returns the project directory.
 */
export function session(
  files: Record<string, string> = {},
  prepare: (root: string) => void = () => undefined,
): string {
  const root = project({ "pyproject.toml": LAYERS, "shop/domain/order.py": "X = 1\n", ...files });
  prepare(root);
  git(root, "init", "-q");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "start");
  inwards(["init", "--agent", "claude"], { cwd: root });
  hook(root, payload("session-start", root, { session_id: ID, source: "startup" }));
  return root;
}

/**
 * Sends the Stop event for the test session.
 *
 * @param root - the project directory.
 * @param extra - payload fields to override, e.g. `{ stop_hook_active: true }`.
 * @returns the exit code and output.
 */
export function stop(root: string, extra: Record<string, unknown> = {}): RunResult {
  return hook(root, payload("stop", root, { session_id: ID, ...extra }));
}

/**
 * Writes a file the way an agent's Write tool does, then sends PostToolUse.
 *
 * @param root - the project directory.
 * @param rel - the file, relative to the project.
 * @param text - the new content.
 */
export function agentWrites(root: string, rel: string, text: string): void {
  put(root, rel, text);
  const input = payload("post-write-order", root, {
    session_id: ID,
    tool_input: { file_path: join(root, rel) },
  });
  hook(root, input);
}
