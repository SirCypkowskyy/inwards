import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { inwards, LAYERS, payload, type RunResult } from "./run.ts";
import { agentWrites, LEAK, put, session, stop } from "./stop-helpers.ts";

const ID = "stop-test";

/**
 * Writes a file as the agent's Write tool does and returns the PostToolUse result.
 *
 * @param root - the project directory.
 * @param text - the new content of shop/domain/order.py.
 * @returns the hook's exit code and output.
 */
function write(root: string, text: string): RunResult {
  put(root, "shop/domain/order.py", text);
  const stdin = payload("post-write-order", root, {
    session_id: ID,
    tool_input: { file_path: join(root, "shop/domain/order.py") },
  });
  return inwards(["hook", "claude-code"], { cwd: root, stdin });
}

/**
 * Reads the `additionalContext` the model gets from a hook's stdout.
 *
 * @param result - the hook run.
 * @returns the context text.
 */
function context(result: RunResult): string {
  const out: { hookSpecificOutput: { additionalContext: string } } = JSON.parse(result.stdout);
  return out.hookSpecificOutput.additionalContext;
}

describe("escalation", () => {
  test("the third attempt at the same violation asks the model to ask the user, once", () => {
    const root = session();
    expect(write(root, LEAK).code).toBe(2);
    expect(write(root, `${LEAK}X = 1\n`).code).toBe(2);
    const third = write(root, `${LEAK}X = 2\n`);
    expect(third.code).toBe(0);
    expect(context(third)).toContain("survived 3 attempts");
    expect(context(third)).toContain('"code":"INW001"');
    expect(write(root, `${LEAK}X = 3\n`).code).toBe(2); // not sticky
  });

  test("escalate-after is configurable", () => {
    const root = session({
      "pyproject.toml": LAYERS.replace("[tool.inwards]", "[tool.inwards]\nescalate-after = 1"),
      "shop/infrastructure/db.py": "",
    });
    expect(context(write(root, LEAK))).toContain("survived 1 attempt.");
  });

  test("the user sees what is unresolved when the turn ends, and the next session hears of it", () => {
    const root = session();
    agentWrites(root, "shop/domain/order.py", LEAK);
    for (const active of [false, true, true]) {
      expect(stop(root, { stop_hook_active: active }).code).toBe(2);
    }
    const ended = stop(root, { stop_hook_active: true });
    expect(ended.code).toBe(0);
    expect(JSON.parse(ended.stdout).systemMessage).toContain("INW001");
    const next = inwards(["hook", "claude-code"], {
      cwd: root,
      stdin: payload("session-start", root, { session_id: "next-session", source: "startup" }),
    });
    expect(context(next)).toContain("shop/domain/order.py");
    const again = inwards(["hook", "claude-code"], {
      cwd: root,
      stdin: payload("session-start", root, { session_id: "third-session", source: "startup" }),
    });
    expect(again.stdout).toBe("");
  });
});
