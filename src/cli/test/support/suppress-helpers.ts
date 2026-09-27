/**
 * @file Shared setup for the inline-suppression tests (#50, ADR-028).
 * It builds projects with a committed suppression and runs the hooks the way
 * Claude Code does. The session-start tests and the symlink tests share it.
 */
import { join } from "node:path";
import { inwards, LAYERS, payload, type RunResult } from "./run.ts";
import { ID, put } from "./stop-helpers.ts";

export const ORDER = "shop/domain/order.py";
export const HIDE = '# inwards: ignore[INW001] reason="legacy, tracked in #12"';
export const SUPPRESSED: string = `import shop.infrastructure.db  ${HIDE}\n`;
export const ALLOW: string = `${LAYERS}agent-suppressions = "allow"\n`;
export const PROJECT_GATE: string = `${LAYERS}stop-gate = "project"\n`;
export const LEGACY = "shop/domain/legacy.py";

/**
 * Whether this git has `--no-lazy-fetch` (2.44+). Without it the hooks can't
 * read a file's start content, so every suppression counts as new.
 */
export const NO_LAZY_FETCH: boolean =
  Bun.spawnSync(["git", "--no-lazy-fetch", "version"]).exitCode === 0;

/**
 * Writes a file the way an agent's Write tool does, then sends PostToolUse.
 *
 * @param root - the project directory.
 * @param text - the new content of the domain module.
 * @param env - extra environment.
 * @returns the hook's exit code and output.
 */
export function agentWritesOrder(
  root: string,
  text: string,
  env: Record<string, string> = {},
): RunResult {
  put(root, ORDER, text);
  const input = payload("post-write-order", root, {
    session_id: ID,
    tool_input: { file_path: join(root, ORDER) },
  });
  return inwards(["hook", "claude-code"], { cwd: root, stdin: input, env });
}

/**
 * Sends PostToolUse for a file the agent wrote.
 *
 * @param root - the project directory.
 * @param rel - the file, relative to the project.
 * @returns the hook's exit code and output.
 */
export function posted(root: string, rel: string): RunResult {
  const input = payload("post-write-order", root, {
    session_id: ID,
    tool_input: { file_path: join(root, rel) },
  });
  return inwards(["hook", "claude-code"], { cwd: root, stdin: input });
}
