import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { inwards, LAYERS, payload, project } from "./run.ts";
import { LEAK, put, session } from "./stop-helpers.ts";

const ON = { INWARDS_RUN_LOG: "1" };

/**
 * Reads the run log's lines.
 *
 * @param root - the project directory.
 * @returns the parsed lines.
 */
function runs(root: string): Record<string, unknown>[] {
  const text = readFileSync(join(root, ".inwards/runs.jsonl"), "utf8");
  return text
    .trim()
    .split("\n")
    .map((line): Record<string, unknown> => JSON.parse(line));
}

/**
 * Sends PostToolUse for a Write of shop/domain/order.py.
 *
 * @param root - the project directory.
 * @param env - extra environment.
 * @returns the exit code.
 */
function writeOrder(root: string, env: Record<string, string> = {}): number {
  put(root, "shop/domain/order.py", `${LEAK}X = 1\n`);
  const stdin = payload("post-write-order", root, {
    session_id: "stop-test",
    tool_name: "Write",
    tool_input: { file_path: join(root, "shop/domain/order.py"), content: `${LEAK}X = 1\n` },
  });
  return inwards(["hook", "claude-code"], { cwd: root, stdin, env }).code;
}

describe("run log", () => {
  test("nothing is written unless it is enabled", () => {
    const root = session();
    writeOrder(root);
    inwards(["check"], { cwd: root });
    expect(existsSync(join(root, ".inwards/runs.jsonl"))).toBe(false);
  });

  test("a hook run is one versioned line: files, lines written, fingerprints, exit", () => {
    const root = session();
    expect(writeOrder(root, ON)).toBe(2);
    const [line] = runs(root).filter((r) => r["event"] === "PostToolUse");
    expect(line).toMatchObject({
      v: 1,
      session_id: "stop-test",
      tool: "Write",
      files: ["shop/domain/order.py"],
      lines: [{ file: "shop/domain/order.py", added: 2, removed: 0 }],
      exit: 2,
    });
    expect(line?.["fingerprints"]).toHaveLength(1);
  });

  test("run-log = true in the config turns it on, and check --log logs a single run", () => {
    const configured = project({
      "pyproject.toml": LAYERS.replace("[tool.inwards]", "[tool.inwards]\nrun-log = true"),
      "shop/domain/order.py": LEAK,
      "shop/infrastructure/db.py": "",
    });
    inwards(["check"], { cwd: configured });
    expect(runs(configured)).toMatchObject([{ event: "check", exit: 1 }]);
    const flagged = project({ "pyproject.toml": LAYERS, "shop/domain/order.py": "" });
    inwards(["check", "--log"], { cwd: flagged });
    expect(runs(flagged)).toMatchObject([{ event: "check", exit: 0, fingerprints: [] }]);
  });

  test("a full log is rotated", () => {
    const root = session();
    writeOrder(root, ON);
    writeFileSync(join(root, ".inwards/runs.jsonl"), "x".repeat(5 * 1024 * 1024));
    writeOrder(root, ON);
    expect(existsSync(join(root, ".inwards/runs.1.jsonl"))).toBe(true);
    expect(runs(root)).toHaveLength(1);
  });
});

describe("run log: review round 1", () => {
  test("a broken config can't turn a hook's exit or output into a crash", () => {
    if (process.platform === "win32" || process.getuid?.() === 0) {
      return; // chmod means nothing on Windows or to root
    }
    const root = session();
    chmodSync(join(root, "pyproject.toml"), 0o000);
    const stdin = payload("post-write-readme", root, { session_id: "stop-test" });
    const run = inwards(["hook", "claude-code"], { cwd: root, stdin });
    chmodSync(join(root, "pyproject.toml"), 0o644);
    expect(run).toEqual({ code: 0, stdout: "", stderr: "" });
  });

  test("the env switch writes nothing in a project without Inwards, and 0 wins over the config", () => {
    const plain = project({ "app.py": "" });
    const stdin = payload("pre-write-readme", plain, { session_id: "s" });
    inwards(["hook", "claude-code"], { cwd: plain, stdin, env: ON });
    expect(existsSync(join(plain, ".inwards"))).toBe(false);
    const configured = project({
      "pyproject.toml": LAYERS.replace("[tool.inwards]", "[tool.inwards]\nrun-log = true"),
      "shop/domain/order.py": "",
    });
    inwards(["check"], { cwd: configured, env: { INWARDS_RUN_LOG: "0" } });
    expect(existsSync(join(configured, ".inwards/runs.jsonl"))).toBe(false);
  });

  test("an Edit counts the lines it changed, not the context it repeats", () => {
    const root = session();
    put(root, "shop/domain/order.py", "X = 1\nY = 2\n");
    const stdin = payload("post-edit-order", root, {
      session_id: "stop-test",
      tool_input: {
        file_path: join(root, "shop/domain/order.py"),
        old_string: "X = 1\n",
        new_string: "X = 1\nY = 2\n",
      },
    });
    inwards(["hook", "claude-code"], { cwd: root, stdin, env: ON });
    const [line] = runs(root).filter((r) => r["event"] === "PostToolUse");
    expect(line?.["lines"]).toEqual([{ file: "shop/domain/order.py", added: 1, removed: 0 }]);
  });

  test("files that weren't checked get no line counts", () => {
    const root = session();
    const stdin = payload("post-write-readme", root, { session_id: "stop-test" });
    inwards(["hook", "claude-code"], { cwd: root, stdin, env: ON });
    expect(runs(root).filter((r) => r["event"] === "PostToolUse")).toMatchObject([
      { files: [], lines: [] },
    ]);
  });

  test("a whole-project check logs '.', and init keeps the log out of git for every agent", () => {
    const root = project({ "pyproject.toml": LAYERS, "shop/domain/order.py": "" });
    inwards(["init", "--agent", "aider"], { cwd: root });
    expect(readFileSync(join(root, ".gitignore"), "utf8")).toContain(".inwards/");
    inwards(["check", "--log"], { cwd: root });
    expect(runs(root)).toMatchObject([{ event: "check", files: ["."] }]);
  });
});
