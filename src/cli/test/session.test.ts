import { describe, expect, test } from "bun:test";
import { readdirSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readSession } from "../src/session.ts";
import { inwards, inwardsAsync, LAYERS, payload, project, type RunResult } from "./run.ts";

const ID = "session-test-1";

/**
 * Runs `inwards hook claude-code` in a project with the given payload.
 *
 * @param root - the project directory, used as the working directory.
 * @param stdin - the payload text.
 * @returns the exit code and output.
 */
function hook(root: string, stdin: string): RunResult {
  return inwards(["hook", "claude-code"], { cwd: root, stdin });
}

/**
 * Sends a recorded SessionStart payload for one session.
 *
 * @param root - the project directory.
 * @param id - the session id to report.
 * @returns the exit code and output.
 */
function start(root: string, id: string = ID): RunResult {
  return hook(root, payload("session-start", root, { session_id: id }));
}

/**
 * Builds a PostToolUse Write payload for one project file in the test session.
 *
 * @param root - the project directory.
 * @param file - the file, relative to the project.
 * @returns the payload as JSON text.
 */
function edit(root: string, file: string): string {
  return payload("post-write-order", root, {
    session_id: ID,
    tool_input: { file_path: join(root, file) },
  });
}

describe("session state", () => {
  test("SessionStart records the config and a manifest, silently", () => {
    const root = project({ "pyproject.toml": LAYERS, "shop/domain/order.py": "X = 1\n" });
    expect(start(root)).toEqual({ code: 0, stdout: "", stderr: "" });
    const state = readSession(realpathSync(root), ID);
    expect(state?.start.config.layers.map((l) => l.name)).toEqual(["domain", "infrastructure"]);
    expect(Object.keys(state?.start.manifest ?? {})).toEqual(["shop/domain/order.py"]);
    expect(state?.start.head).toBeNull(); // not a git repo
  });

  test("edits and the fingerprints of their violations are recorded", () => {
    const root = project({
      "pyproject.toml": LAYERS,
      "shop/domain/order.py": "import shop.infrastructure.db\n",
      "shop/domain/clean.py": "X = 1\n",
    });
    start(root);
    expect(hook(root, edit(root, "shop/domain/order.py")).code).toBe(2);
    expect(hook(root, edit(root, "shop/domain/order.py")).code).toBe(2);
    expect(hook(root, edit(root, "shop/domain/clean.py")).code).toBe(0);
    const state = readSession(realpathSync(root), ID);
    expect(state?.edited).toEqual(["shop/domain/order.py", "shop/domain/clean.py"]);
    expect([...(state?.seen.values() ?? [])]).toEqual([2]); // one violation, seen twice
  });

  test("20 parallel hooks leave a log with every fingerprint", async () => {
    const files: Record<string, string> = { "pyproject.toml": LAYERS };
    for (let i = 0; i < 20; i += 1) {
      files[`shop/domain/f${i}.py`] = `import shop.infrastructure.m${i}\n`;
    }
    const root = project(files);
    start(root);
    const runs = Array.from({ length: 20 }, (_, i) =>
      inwardsAsync(["hook", "claude-code"], {
        cwd: root,
        stdin: edit(root, `shop/domain/f${i}.py`),
      }),
    );
    expect((await Promise.all(runs)).map((r) => r.code)).toEqual(new Array<number>(20).fill(2));
    const state = readSession(realpathSync(root), ID);
    expect(state?.edited).toHaveLength(20);
    expect(state?.seen.size).toBe(20);
  });

  test("a session id that isn't a plain name writes nothing", () => {
    const root = project({ "pyproject.toml": LAYERS, "shop/domain/order.py": "X = 1\n" });
    start(root, "../escape");
    expect(readdirSync(root)).not.toContain(".inwards");
  });

  test("without its start record, a session has no state (callers fail closed)", () => {
    const root = project({ "pyproject.toml": LAYERS, "shop/domain/order.py": "X = 1\n" });
    start(root);
    rmSync(join(root, ".inwards"), { recursive: true });
    hook(root, edit(root, "shop/domain/order.py")); // recreates the log without a start
    expect(readSession(realpathSync(root), ID)).toBeUndefined();
  });

  test("a new session prunes logs past 50 or older than a week", () => {
    const root = project({ "pyproject.toml": LAYERS, "shop/domain/order.py": "X = 1\n" });
    const dir = join(root, ".inwards/state");
    for (let i = 0; i < 55; i += 1) {
      start(root, `old-${i}`);
    }
    writeFileSync(join(dir, "ancient.jsonl"), "");
    const eightDaysAgo = (Date.now() - 8 * 86_400_000) / 1000;
    utimesSync(join(dir, "ancient.jsonl"), eightDaysAgo, eightDaysAgo);
    start(root, "newest");
    const left = readdirSync(dir);
    expect(left.length).toBeLessThanOrEqual(51);
    expect(left).not.toContain("ancient.jsonl");
    expect(left).toContain("newest.jsonl");
  });
});
