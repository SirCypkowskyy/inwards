/**
 * @file #157: a file that was modified, untracked or outside git when the session
 * started still has a known start content, from the copy SessionStart keeps
 * in `.inwards/state/<id>.content.json`. Its old violations are context and a
 * new one blocks, as for a committed file. A copy past the size cap, one
 * edited after the start, or one a symlink alias would need falls back to
 * the old behaviour: no start content, so every error blocks.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { inwards, LAYERS, payload, project, type RunResult } from "../support/run.ts";
import { git, put } from "../support/stop-helpers.ts";

const ORDER = "shop/domain/order.py";
const OLD = "import shop.infrastructure.db\n";
const NEW = "import shop.infrastructure.cache\n";
const ID = "dirty-start";
const NOTE = "already in the file when the session started";
/** Git before 2.44 has no `--no-lazy-fetch`, so it can't be read safely and every file gets a copy. */
const OLD_GIT = Bun.spawnSync(["git", "--no-lazy-fetch", "version"]).exitCode !== 0;

/**
 * Sends one hook event for the test session.
 *
 * @param root - the project directory.
 * @param event - the payload fixture: `session-start`, `stop` or `post-write-order`.
 * @param patch - payload fields to set besides the session id.
 * @returns the hook's exit code and output.
 */
function send(root: string, event: string, patch: Record<string, unknown> = {}): RunResult {
  const stdin = payload(event, root, { session_id: ID, source: "startup", ...patch });
  return inwards(["hook", "claude-code"], { cwd: root, stdin });
}

/**
 * Writes a file the way the agent's Write tool does, then sends PostToolUse.
 *
 * @param root - the project directory.
 * @param rel - the file, relative to the project.
 * @param text - the new content.
 * @returns the hook's exit code and output.
 */
function agentWrites(root: string, rel: string, text: string): RunResult {
  put(root, rel, text);
  return send(root, "post-write-order", { tool_input: { file_path: join(root, rel) } });
}

/**
 * Makes a project with a clean domain module and an infrastructure it may not import.
 *
 * @param inGit - whether to commit it to a new git repository.
 * @returns the project directory.
 */
function app(inGit: boolean): string {
  const root = project({
    "pyproject.toml": LAYERS,
    [ORDER]: "X = 1\n",
    "shop/infrastructure/db.py": "",
    "shop/infrastructure/cache.py": "",
  });
  inwards(["init", "--agent", "claude"], { cwd: root });
  if (inGit) {
    git(root, "init", "-q");
    git(root, "add", "-A");
    git(root, "commit", "-qm", "start");
  }
  return root;
}

/**
 * Reads the copies SessionStart kept for the test session.
 *
 * @param root - the project directory.
 * @returns the copies by project path; empty when there is no copies file.
 */
function copies(root: string): Record<string, string> {
  const path = join(root, ".inwards/state", `${ID}.content.json`);
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
}

describe("a file dirty at session start keeps its old violations as context", () => {
  for (const [name, inGit] of [
    ["modified", true],
    ["outside git", false],
  ] as const) {
    test(`${name}: the old violation is a note, a new one in the same file blocks`, () => {
      const root = app(inGit);
      put(root, ORDER, `${OLD}X = 1\n`); // uncommitted when the session starts
      expect(send(root, "session-start").code).toBe(0);
      expect(copies(root)).toHaveProperty([ORDER]);

      const edit = agentWrites(root, ORDER, `${OLD}X = 2\n`);
      expect(edit.code).toBe(0);
      expect(edit.stdout).toContain(NOTE);
      expect(send(root, "stop").code).toBe(0);

      const added = agentWrites(root, ORDER, `${OLD}${NEW}X = 2\n`);
      expect(added.code).toBe(2);
      expect(added.stderr).toContain("shop.infrastructure.cache");
      const stop = send(root, "stop");
      expect(stop.code).toBe(2);
      expect(stop.stderr).toContain(NOTE);
      expect(stop.stderr).toContain('"violations":1,');
    });
  }

  test("an untracked file: its old violation is a note", () => {
    const root = app(true);
    const extra = "shop/domain/extra.py";
    put(root, extra, OLD);
    send(root, "session-start");
    expect(agentWrites(root, extra, `${OLD}X = 1\n`).code).toBe(0);
    expect(send(root, "stop").code).toBe(0);
  });

  test("a committed file unchanged since gets no copy: git has its start content", () => {
    const root = app(true);
    put(root, "shop/domain/extra.py", "Y = 1\n");
    send(root, "session-start");
    const copied = Object.keys(copies(root));
    expect(copied).toContain("shop/domain/extra.py");
    expect(copied.includes(ORDER)).toBe(OLD_GIT);
  });
});

describe("start content the copy can't prove falls back to blocking", () => {
  test("a file past the per-file cap gets no copy, so its old violation blocks", () => {
    const root = app(false);
    put(root, ORDER, `${OLD}${"# padding\n".repeat(60_000)}`); // about 600 KB
    send(root, "session-start");
    expect(copies(root)).not.toHaveProperty([ORDER]);
    expect(agentWrites(root, ORDER, `${OLD}X = 1\n`).code).toBe(2);
    expect(send(root, "stop").code).toBe(2);
  });

  test("a copy edited after the start fails its hash check and is ignored", () => {
    const root = app(false);
    put(root, ORDER, `${OLD}X = 1\n`);
    send(root, "session-start");
    // Through Bash, the agent makes its new violation look old.
    const path = join(root, ".inwards/state", `${ID}.content.json`);
    writeFileSync(path, JSON.stringify({ [ORDER]: `${OLD}${NEW}X = 1\n` }));
    put(root, ORDER, `${OLD}${NEW}X = 1\n`);
    const stop = send(root, "stop");
    expect(stop.code).toBe(2);
    expect(stop.stderr).not.toContain(NOTE);
    expect(stop.stderr).toContain('"violations":2,');
  });

  test("a deleted copy is the old behaviour: every error blocks", () => {
    const root = app(false);
    put(root, ORDER, `${OLD}X = 1\n`);
    send(root, "session-start");
    rmSync(join(root, ".inwards/state", `${ID}.content.json`));
    expect(agentWrites(root, ORDER, `${OLD}X = 2\n`).code).toBe(2);
  });

  test("a symlink alias gets no copy, and a file put in its place borrows none", () => {
    const root = app(false);
    put(root, ORDER, `${OLD}X = 1\n`);
    const alias = "shop/domain/alias.py";
    symlinkSync("order.py", join(root, alias));
    send(root, "session-start");
    expect(copies(root)).toHaveProperty([ORDER]);
    expect(copies(root)).not.toHaveProperty([alias]);
    // The alias becomes a real file with the start content of the file it named.
    rmSync(join(root, alias));
    const edit = agentWrites(root, alias, `${OLD}X = 1\n`);
    expect(edit.code).toBe(2);
    expect(send(root, "stop").code).toBe(2);
  });
});
