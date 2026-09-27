import { describe, expect, test } from "bun:test";
import { chmodSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { agentWrites, git, LEAK, put, session, stop } from "../support/stop-helpers.ts";

describe("Stop gate: edits made around the hooks", () => {
  test.each([
    [
      "a commit",
      (root: string): void => {
        put(root, "shop/domain/order.py", LEAK);
        git(root, "commit", "-qam", "sneaky");
      },
    ],
    [
      "assume-unchanged",
      (root: string): void => {
        git(root, "update-index", "--assume-unchanged", "shop/domain/order.py");
        put(root, "shop/domain/order.py", LEAK);
      },
    ],
    [
      ".gitignore",
      (root: string): void => {
        put(root, ".gitignore", "shop/domain/hidden/\n");
        put(root, "shop/domain/hidden/x.py", LEAK);
      },
    ],
    [
      "a new untracked directory",
      (root: string): void => put(root, "shop/domain/fresh/x.py", LEAK),
    ],
    [
      "a pyvenv.cfg disguise, untracked (git status)",
      (root: string): void => {
        put(root, "shop/domain/disguised/pyvenv.cfg", "");
        put(root, "shop/domain/disguised/x.py", LEAK);
      },
    ],
    [
      "a pyvenv.cfg disguise, committed (git diff)",
      (root: string): void => {
        put(root, "shop/domain/disguised/pyvenv.cfg", "");
        put(root, "shop/domain/disguised/x.py", LEAK);
        git(root, "add", "-A");
        git(root, "commit", "-qm", "sneaky");
      },
    ],
    [
      "a gitignored pyvenv.cfg disguise",
      (root: string): void => {
        put(root, ".gitignore", "shop/domain/disguised/\n");
        put(root, "shop/domain/disguised/pyvenv.cfg", "");
        put(root, "shop/domain/disguised/x.py", LEAK);
      },
    ],
    [
      "a gitignored node_modules directory",
      (root: string): void => {
        put(root, ".gitignore", "node_modules/\n");
        put(root, "shop/domain/node_modules/x.py", LEAK);
      },
    ],
    [
      "a non-ASCII name in a committed disguise",
      (root: string): void => {
        put(root, "shop/domain/disguised/pyvenv.cfg", "");
        put(root, "shop/domain/disguised/z\u00e9.py", LEAK);
        git(root, "add", "-A");
        git(root, "commit", "-qm", "sneaky");
      },
    ],
    [
      "a pyvenv.cfg above the layer",
      (root: string): void => {
        put(root, "shop/pyvenv.cfg", "");
        put(root, "shop/domain/order.py", LEAK);
      },
    ],
    [
      "a symlink from the layer into a disguised directory",
      (root: string): void => {
        put(root, "vendor/pyvenv.cfg", "");
        put(root, "vendor/leak.py", LEAK);
        symlinkSync(join(root, "vendor"), join(root, "shop/domain/sub"), "dir");
      },
    ],
  ])("an edit hidden by %s is still checked", (_, hide) => {
    const root = session();
    hide(root);
    const { code, stderr } = stop(root);
    expect(code).toBe(2);
    expect(stderr).toContain("INW001");
  });

  test("a new nested config in a disguised directory can't waive the layers", () => {
    const root = session();
    put(root, "shop/domain/impl/pyvenv.cfg", "");
    put(
      root,
      "shop/domain/impl/pyproject.toml",
      '[tool.inwards]\nlayers = [{ name = "x", modules = ["nothing"] }]\n',
    );
    put(root, "shop/domain/impl/leak.py", LEAK);
    const { code, stderr } = stop(root);
    expect(code).toBe(2);
    expect(stderr).toContain("which didn't exist when the session started");
  });

  test("a FIFO named like a module doesn't hang the gate", () => {
    if (process.platform === "win32") {
      return; // no FIFOs
    }
    const root = session();
    agentWrites(root, "shop/domain/order.py", LEAK);
    expect(Bun.spawnSync(["mkfifo", join(root, "shop/domain/z.py")]).exitCode).toBe(0);
    expect(stop(root).code).toBe(2);
  });

  test("a failing gate blocks once, then lets the turn end", () => {
    if (process.platform === "win32" || process.getuid?.() === 0) {
      return; // chmod means nothing on Windows or to root (act runs tests as root)
    }
    const root = session();
    agentWrites(root, "shop/domain/order.py", "X = 2\n");
    chmodSync(join(root, "shop/domain/order.py"), 0o000);
    const first = stop(root);
    expect(first.code).toBe(2);
    expect(first.stderr).toContain("the Stop gate failed");
    expect(stop(root, { stop_hook_active: true }).code).toBe(1);
  });

  test("an invalid [tool.inwards] fixture doesn't break the session, nor block edits under it", () => {
    const root = session({
      "tests/fixtures/bad/pyproject.toml": "[tool.inwards]\nlayers = 5\n",
      "tests/fixtures/bad/x.py": "X = 1\n",
    });
    agentWrites(root, "shop/domain/order.py", "X = 2\n");
    agentWrites(root, "tests/fixtures/bad/x.py", "X = 2\n");
    expect(stop(root).code).toBe(0);
  });

  test.each([
    ["a commented-out shell command", { command: "exit 0 # inwards hook claude-code" }],
    ["a look-alike binary", { command: "/bin/inwards-noop", args: ["hook", "claude-code"] }],
  ])("a SessionStart hook replaced by %s fails the gate", (_, entry) => {
    const root = session();
    const path = join(root, ".claude/settings.local.json");
    const hook = JSON.stringify({ type: "command", ...entry });
    writeFileSync(path, `{"hooks":{"SessionStart":[{"hooks":[${hook}]}]}}`);
    expect(stop(root).stderr).toContain("SessionStart");
  });

  test("a PostToolUse matcher that no longer covers the edit tools fails the gate", () => {
    const root = session();
    const path = join(root, ".claude/settings.local.json");
    const text = readFileSync(path, "utf8");
    expect(text).toContain('"Edit|Write|MultiEdit"');
    writeFileSync(path, text.replace('"Edit|Write|MultiEdit"', '"NoSuchTool"'));
    expect(stop(root).stderr).toContain("PostToolUse hook is missing");
  });
});
