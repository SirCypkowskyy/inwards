/**
 * @file Escalation across the hooks: a violation that survives `escalate-after`
 * attempts makes the hooks stop blocking and tell the agent to ask the user.
 * The user sees what is unresolved when the turn ends, and the next session
 * hears of it.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { inwards, LAYERS, payload, project, type RunResult } from "../support/run.ts";
import { agentWrites, LEAK, put, session, stop } from "../support/stop-helpers.ts";

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

describe("escalation: review round 1", () => {
  test("a config broken mid-session doesn't stop the gate from ending the turn", () => {
    const root = session();
    agentWrites(root, "shop/domain/order.py", LEAK);
    put(
      root,
      "pyproject.toml",
      LAYERS.replace("[tool.inwards]", "[tool.inwards]\nescalate-after = 0"),
    );
    for (const active of [false, true, true]) {
      expect(stop(root, { stop_hook_active: active }).code).toBe(2);
    }
    expect(stop(root, { stop_hook_active: true }).code).toBe(0);
  });

  test("the same import twice in a file is one attempt per edit", () => {
    const root = session();
    const twice = `${LEAK}def f():\n    import shop.infrastructure.db\n`;
    expect(write(root, twice).code).toBe(2);
    expect(write(root, `${twice}X = 1\n`).code).toBe(2);
    expect(context(write(root, `${twice}X = 2\n`))).toContain("survived 3 attempts");
  });

  test("an escalating run with a new violation still blocks, and says to ask the user", () => {
    const root = session();
    write(root, LEAK);
    write(root, `${LEAK}X = 1\n`);
    const mixed = write(root, `${LEAK}import shop.infrastructure.other\n`);
    expect(mixed.code).toBe(2);
    expect(mixed.stderr).toContain("survived 3 attempts");
  });

  test("once a violation has escalated, the first Stop already says to ask the user", () => {
    const root = session();
    for (const n of [1, 2, 3]) {
      write(root, `${LEAK}X = ${n}\n`);
    }
    const first = stop(root);
    expect(first.code).toBe(2);
    expect(first.stderr).toContain("ask how to proceed");
  });

  test("escalate-after edited mid-session changes nothing", () => {
    const root = session();
    put(
      root,
      "pyproject.toml",
      LAYERS.replace("[tool.inwards]", "[tool.inwards]\nescalate-after = 1"),
    );
    expect(write(root, LEAK).code).toBe(2);
  });

  test("an unrelated package's limit doesn't cut the gate short", () => {
    const root = session({
      "other/pyproject.toml":
        '[tool.inwards]\nescalate-after = 1\nlayers = [{ name = "o", modules = ["o"] }]\n',
      "other/o/x.py": "",
    });
    agentWrites(root, "shop/domain/order.py", LEAK);
    expect(stop(root).code).toBe(2);
    expect(stop(root, { stop_hook_active: true }).code).toBe(2);
  });

  test("a symlinked .inwards can't feed the next session, nor lose its files", () => {
    const root = session();
    const outside = project({ "state/x.unresolved.json": '{"summary":"INJECTED"}' });
    rmSync(join(root, ".inwards"), { recursive: true, force: true });
    symlinkSync(outside, join(root, ".inwards"), "dir");
    const next = inwards(["hook", "claude-code"], {
      cwd: root,
      stdin: payload("session-start", root, { session_id: "next-session", source: "clear" }),
    });
    expect(next.stdout).not.toContain("INJECTED");
    expect(existsSync(join(outside, "state/x.unresolved.json"))).toBe(true);
  });

  test("a list whose files were fixed since isn't handed to the next session", () => {
    const root = session();
    agentWrites(root, "shop/domain/order.py", LEAK);
    for (const active of [false, true, true, true]) {
      stop(root, { stop_hook_active: active });
    }
    put(root, "shop/domain/order.py", "X = 1\n");
    const next = inwards(["hook", "claude-code"], {
      cwd: root,
      stdin: payload("session-start", root, { session_id: "next-session", source: "startup" }),
    });
    expect(next.stdout).toBe("");
  });
});
