/**
 * @file `inwards init --launcher`: the hooks, the AGENTS.md section and Aider's
 * line start Inwards through a launcher such as `uv run` and hold no path. The
 * hook still works from a fresh shell in another worktree, a launcher a shell
 * would misread is refused, and init warns when it runs from uv's cache.
 */
import { describe, expect, test } from "bun:test";
import { chmodSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import process from "node:process";
import { holdsInwardsHooks } from "../../src/claude-code/settings.ts";
import { CMD, inwards, LAYERS, payload, project, type RunResult } from "../support/run.ts";
import { git } from "../support/stop-helpers.ts";

const SETTINGS = ".claude/settings.local.json";
const UV_RUN = 'cd "$CLAUDE_PROJECT_DIR" && uv run inwards hook claude-code';

/** One hook entry in Claude Code settings. */
interface HookEntry {
  command: string;
  args?: string[];
}

/**
 * Runs `inwards init` in a project.
 *
 * @param root - the project directory.
 * @param args - arguments after `init`.
 * @returns the exit code and output.
 */
function init(root: string, ...args: string[]): RunResult {
  return inwards(["init", ...args], { cwd: root });
}

/**
 * Reads a file of a project.
 *
 * @param root - the project directory.
 * @param rel - the file, relative to the project.
 * @returns the file's text.
 */
function read(root: string, rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

/**
 * Lists every hook entry in a project's local Claude Code settings.
 *
 * @param root - the project directory.
 * @returns the entries of every event, in order.
 */
function hookEntries(root: string): HookEntry[] {
  const settings: { hooks: Record<string, { hooks: HookEntry[] }[]> } = JSON.parse(
    read(root, SETTINGS),
  );
  return Object.values(settings.hooks).flatMap((groups) => groups.flatMap((g) => g.hooks));
}

describe("inwards init --launcher", () => {
  test("claude gets shell-form hooks with no path, and a second run is a no-op", () => {
    const root = project({ "pyproject.toml": LAYERS });
    expect(init(root, "--agent", "claude", "--launcher", "uv run").code).toBe(0);
    const entries = hookEntries(root);
    expect(entries).toHaveLength(4);
    expect(entries.every((e) => e.command === UV_RUN && e.args === undefined)).toBe(true);
    const before = read(root, SETTINGS);
    expect(init(root, "--agent", "claude", "--launcher", " uv  run ").stdout).toContain(
      "nothing to change",
    );
    // Back to the binary: the launcher entries are replaced, not kept beside it.
    init(root, "--agent", "claude");
    expect(read(root, SETTINGS)).not.toContain("uv run");
    expect(before).toContain("uv run");
  });

  test("the launcher hook works from a fresh shell in another worktree of the same repo", () => {
    if (process.platform === "win32") {
      return; // the launcher here is a POSIX shell script
    }
    const main = project({ "pyproject.toml": LAYERS, "shop/domain/order.py": "X = 1\n" });
    // A stand-in for uv on PATH: `uv run inwards …` starts this build, and only
    // from a directory with a pyproject.toml, as uv finds the project.
    const bin = project({});
    const quoted = CMD.map((word) => `'${word}'`).join(" ");
    const uv = `#!/bin/sh\n[ "$1" = run ] && [ -f pyproject.toml ] || exit 9\nshift 2\nexec ${quoted} "$@"\n`;
    writeFileSync(join(bin, "uv"), uv);
    chmodSync(join(bin, "uv"), 0o755);
    git(main, "init", "-q");
    git(main, "add", "-A");
    git(main, "commit", "-qm", "start");
    expect(init(main, "--agent", "claude", "--launcher", "uv run").code).toBe(0);
    const other = `${main}-other`;
    git(main, "worktree", "add", "-q", other);
    mkdirSync(join(other, ".claude"));
    copyFileSync(join(main, SETTINGS), join(other, SETTINGS));
    writeFileSync(join(other, "shop/domain/order.py"), "import shop.infrastructure.db\n");

    const command = hookEntries(other)[0]?.command ?? "";
    const p = Bun.spawnSync(["sh", "-c", command], {
      cwd: project({}), // Claude Code may run hooks from anywhere in the session
      stdin: new TextEncoder().encode(payload("post-write-order", other)),
      env: { CLAUDE_PROJECT_DIR: other, PATH: `${bin}:/usr/bin:/bin` },
    });
    expect(p.stderr.toString()).toContain("INW001");
    expect(p.exitCode).toBe(2);
  });

  test("agents-md and aider name the launcher", () => {
    const root = project({ "pyproject.toml": LAYERS });
    init(root, "--agent", "agents-md", "--launcher", "uv run");
    expect(read(root, "AGENTS.md")).toContain("\n    uv run inwards check --format json\n");
    expect(init(root, "--agent", "agents-md", "--launcher", "uv run").stdout).toContain(
      "nothing to change",
    );
    expect(init(root, "--agent", "aider", "--launcher", "uv run").stdout).toContain(
      'lint-cmd: "python: uv run inwards check --format text"',
    );
  });

  test.each([
    ["uv run; rm -rf ~", '"run;"'],
    ['uv run "$(id)"', "isn't one"],
    ["", "needs a command"],
    ["./run-inwards", "tool runner"],
    ["echo", "tool runner"],
  ])("a launcher of %j is refused with exit 2 and nothing written", (launcher, message) => {
    const root = project({ "pyproject.toml": LAYERS });
    const { code, stderr } = init(root, "--agent", "claude", "--launcher", launcher);
    expect(code).toBe(2);
    expect(stderr).toContain(message);
    expect(read(root, "pyproject.toml")).toBe(LAYERS);
  });

  test("run from uv's cache, init warns and names the fix; with a launcher it doesn't", () => {
    const root = project({ "pyproject.toml": LAYERS });
    const [exe = "", ...rest] = CMD;
    const bin = join(root, ".cache/uv/archive-v0/IRixQr87/bin");
    mkdirSync(bin, { recursive: true });
    const cached = join(bin, basename(exe));
    copyFileSync(exe, cached);
    chmodSync(cached, 0o755);
    /**
     * Runs init with the copy in the cache.
     *
     * @param args - arguments after `init`.
     * @returns what it printed.
     */
    function run(...args: string[]): string {
      return Bun.spawnSync([cached, ...rest, "init", ...args], { cwd: root }).stdout.toString();
    }
    const warned = run("--agent", "claude", "--dry-run");
    expect(warned).toContain("is in uv's cache");
    expect(warned).toContain('--launcher "uv run"');
    expect(run("--agent", "claude", "--launcher", "uv run", "--dry-run")).not.toContain("warning");
  });
});

test("the Stop gate counts a launcher hook only behind a tool runner", () => {
  /**
   * Settings text with one PreToolUse hook.
   *
   * @param command - the hook's shell command.
   * @returns the settings.json text.
   */
  function settings(command: string): string {
    const group = [{ hooks: [{ type: "command", command }] }];
    // biome-ignore lint/style/useNamingConvention: Claude Code's own key.
    return JSON.stringify({ hooks: { PreToolUse: group } });
  }
  const cd = 'cd "$CLAUDE_PROJECT_DIR" && ';
  expect(holdsInwardsHooks(settings(`${cd}uv run inwards hook claude-code`))).toBe(true);
  expect(holdsInwardsHooks(settings("uvx --from inwards==0.4.0 inwards hook claude-code"))).toBe(
    true,
  );
  expect(holdsInwardsHooks(settings(`${cd}echo inwards hook claude-code`))).toBe(false);
  expect(holdsInwardsHooks(settings("./fake inwards hook claude-code"))).toBe(false);
});

test("--launcher with --agent opencode is refused and writes nothing", () => {
  const root = project({ "pyproject.toml": LAYERS });
  const result = init(root, "--agent", "opencode", "--launcher", "uv run");
  expect([result.code, result.stderr]).toEqual([2, expect.stringContaining("--agent opencode")]);
  expect(read(root, "pyproject.toml")).toBe(LAYERS);
});
