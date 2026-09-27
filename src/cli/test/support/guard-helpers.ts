/**
 * @file Helpers for the config guard tests: build a PreToolUse payload for an
 * Edit, Write or Bash call, run the guard, and tell whether it denied the call.
 * They drive the compiled CLI like Claude Code does.
 */
import { isAbsolute, join } from "node:path";
import { inwards, payload, type RunResult } from "./run.ts";

/**
 * Sends a PreToolUse event for one tool call.
 *
 * @param root - the project directory.
 * @param tool - the tool name.
 * @param input - the tool input; `file_path` is taken relative to the project.
 * @returns the hook's exit code and output.
 */
export function pre(root: string, tool: string, input: Record<string, unknown>): RunResult {
  const file = input["file_path"];
  const relative = typeof file === "string" && !isAbsolute(file);
  const toolInput = relative ? { ...input, file_path: join(root, file) } : input;
  const stdin = payload("pre-edit-order", root, { tool_name: tool, tool_input: toolInput });
  return inwards(["hook", "claude-code"], { cwd: root, stdin });
}

/**
 * Reads the deny reason out of a PreToolUse response.
 *
 * @param result - the hook run.
 * @returns the reason, or undefined when the call was let through.
 * @throws {Error} when the hook didn't exit 0, which a PreToolUse run always should.
 */
export function denied(result: RunResult): string | undefined {
  if (result.code !== 0) {
    throw new Error(`PreToolUse exited ${result.code}: ${result.stderr}`);
  }
  if (result.stdout === "") {
    return undefined;
  }
  const out: {
    hookSpecificOutput: { permissionDecision: string; permissionDecisionReason: string };
  } = JSON.parse(result.stdout);
  if (out.hookSpecificOutput.permissionDecision !== "deny") {
    throw new Error(`unexpected decision ${out.hookSpecificOutput.permissionDecision}`);
  }
  return out.hookSpecificOutput.permissionDecisionReason;
}
