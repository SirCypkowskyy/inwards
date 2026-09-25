import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { inwards, LAYERS, payload, project, type RunResult } from "./run.ts";

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

/** An absolute, quoted Inwards command running the Claude Code hook. */
const HOOK_COMMAND = /^".+" hook claude-code$/u;

/** Shape of the parts of .claude/settings.json these tests look at. */
interface Settings {
  hooks: Record<string, { matcher?: string; hooks: { command: string }[] }[]>;
  permissions?: unknown;
}

describe("inwards init --agent claude", () => {
  test("installs the hooks, ignores .inwards/ and pins required-version; a second run is a no-op", () => {
    const root = project({ "pyproject.toml": LAYERS, "shop/domain/order.py": "X = 1\n" });
    expect(init(root, "--agent", "claude").code).toBe(0);
    const settings: Settings = JSON.parse(read(root, ".claude/settings.json"));
    expect(Object.keys(settings.hooks).sort()).toEqual(["PostToolUse", "SessionStart"]);
    const command = settings.hooks["PostToolUse"]?.[0]?.hooks[0]?.command ?? "";
    expect(command).toMatch(HOOK_COMMAND);
    expect(read(root, ".gitignore")).toContain(".inwards/");
    expect(read(root, "pyproject.toml")).toContain('required-version = "0.0.1"');

    const before = ["pyproject.toml", ".gitignore", ".claude/settings.json"].map((f) =>
      read(root, f),
    );
    const again = init(root, "--agent", "claude");
    expect(again.stdout).toContain("nothing to change");
    expect(
      ["pyproject.toml", ".gitignore", ".claude/settings.json"].map((f) => read(root, f)),
    ).toEqual(before);
  });

  test("keeps the user's own hooks and settings", () => {
    const own = { type: "command", command: "ruff check" };
    const root = project({
      "pyproject.toml": LAYERS,
      ".claude/settings.json": JSON.stringify({
        permissions: { allow: ["Bash(ls)"] },
        // biome-ignore lint/style/useNamingConvention: Claude Code's own key.
        hooks: { PostToolUse: [{ matcher: "Edit", hooks: [own] }] },
      }),
    });
    init(root, "--agent", "claude");
    const settings: Settings = JSON.parse(read(root, ".claude/settings.json"));
    expect(settings.permissions).toEqual({ allow: ["Bash(ls)"] });
    expect(settings.hooks["PostToolUse"]?.[0]).toEqual({ matcher: "Edit", hooks: [own] });
    expect(settings.hooks["PostToolUse"]).toHaveLength(2);
  });

  test("the installed hook works from a fresh shell with no PATH or virtualenv", () => {
    const root = project({
      "pyproject.toml": LAYERS,
      "shop/domain/order.py": "import shop.infrastructure.db\n",
    });
    init(root, "--agent", "claude");
    const settings: Settings = JSON.parse(read(root, ".claude/settings.json"));
    const command = settings.hooks["PostToolUse"]?.[0]?.hooks[0]?.command ?? "";
    const windows = process.platform === "win32";
    const p = Bun.spawnSync(["sh", "-c", command], {
      cwd: root,
      stdin: new TextEncoder().encode(payload("post-write-order", root)),
      env: { PATH: windows ? (process.env["PATH"] ?? "") : "/usr/bin:/bin" },
    });
    expect(p.exitCode).toBe(2);
    expect(p.stderr.toString()).toContain("INW001");
  });

  test("--dry-run prints the diff and writes nothing", () => {
    const root = project({ "pyproject.toml": LAYERS });
    const { code, stdout } = init(root, "--agent", "claude", "--dry-run");
    expect(code).toBe(0);
    expect(stdout).toContain('+required-version = "0.0.1"');
    expect(stdout).toContain("+.inwards/");
    expect(read(root, "pyproject.toml")).toBe(LAYERS);
  });

  test("an invalid settings.json stops init with exit 2", () => {
    const root = project({ "pyproject.toml": LAYERS, ".claude/settings.json": "{ not json" });
    expect(init(root, "--agent", "claude").code).toBe(2);
  });
});

describe("other agents", () => {
  test("agents-md adds a marked section once and keeps the rest", () => {
    const root = project({ "pyproject.toml": LAYERS, "AGENTS.md": "# Rules\n\nBe nice.\n" });
    init(root, "--agent", "agents-md");
    const text = read(root, "AGENTS.md");
    expect(text.startsWith("# Rules\n\nBe nice.\n\n<!-- inwards:begin -->")).toBe(true);
    expect(text).toContain("check --format json");
    expect(init(root, "--agent", "agents-md").stdout).toContain("nothing to change");
  });

  test("aider prints the lint command", () => {
    const root = project({ "pyproject.toml": LAYERS });
    expect(init(root, "--agent", "aider").stdout).toContain('lint-cmd: "python: ');
  });

  test("without a config, or with an unknown agent, init exits 2", () => {
    const root = project({});
    mkdirSync(join(root, "sub"));
    expect(init(root, "--agent", "claude").code).toBe(2);
    writeFileSync(join(root, "pyproject.toml"), LAYERS);
    expect(init(root, "--agent", "cursor").code).toBe(2);
  });
});

test("a project that requires a newer Inwards fails every check with exit 2", () => {
  const root = project({
    "pyproject.toml": LAYERS.replace(
      "[tool.inwards]",
      '[tool.inwards]\nrequired-version = "99.0.0"',
    ),
    "shop/domain/order.py": "X = 1\n",
  });
  const { code, stderr } = inwards(["check"], { cwd: root });
  expect(code).toBe(2);
  expect(stderr).toContain("requires Inwards 99.0.0 or newer");
});
