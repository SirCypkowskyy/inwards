import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { VERSION } from "@inwards/core";
import { CMD, inwards, LAYERS, payload, project, type RunResult } from "./run.ts";

/** The line `init` pins, built from the engine version so a release PR's bump doesn't break the tests. */
const PINNED = `required-version = "${VERSION.replace(/-.*$/u, "")}"`;

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

const SETTINGS = ".claude/settings.local.json";

/** One hook entry in Claude Code settings. */
interface HookEntry {
  command: string;
  args?: string[];
}

/** Shape of the parts of the Claude settings these tests look at. */
interface Settings {
  hooks: Record<string, { matcher?: string; hooks: HookEntry[] }[]>;
  permissions?: unknown;
}

/**
 * Reads the Inwards PostToolUse entry init wrote.
 *
 * @param root - the project directory.
 * @returns the last PostToolUse hook entry.
 */
function ourEntry(root: string): HookEntry {
  const settings: Settings = JSON.parse(read(root, SETTINGS));
  return settings.hooks["PostToolUse"]?.at(-1)?.hooks[0] ?? { command: "" };
}

describe("inwards init --agent claude", () => {
  test("installs the hooks, ignores .inwards/ and pins required-version; a second run is a no-op", () => {
    const root = project({ "pyproject.toml": LAYERS, "shop/domain/order.py": "X = 1\n" });
    expect(init(root, "--agent", "claude").code).toBe(0);
    const settings: Settings = JSON.parse(read(root, SETTINGS));
    expect(Object.keys(settings.hooks).sort()).toEqual([
      "PostToolUse",
      "PreToolUse",
      "SessionStart",
      "Stop",
    ]);
    expect(settings.permissions).toEqual({
      deny: ["Edit(/.claude/settings*.json)", "Edit(/.inwards/**)"],
    });
    const entry = ourEntry(root);
    expect(entry.args?.slice(-2)).toEqual(["hook", "claude-code"]);
    expect(read(root, ".gitignore")).toContain(".inwards/");
    expect(read(root, "pyproject.toml")).toContain(PINNED);

    const before = ["pyproject.toml", ".gitignore", SETTINGS].map((f) => read(root, f));
    const again = init(root, "--agent", "claude");
    expect(again.stdout).toContain("nothing to change");
    expect(["pyproject.toml", ".gitignore", SETTINGS].map((f) => read(root, f))).toEqual(before);
  });

  test("keeps the user's own hooks and settings", () => {
    const own = { type: "command", command: "ruff check" };
    const root = project({
      "pyproject.toml": LAYERS,
      ".claude/settings.local.json": JSON.stringify({
        permissions: { allow: ["Bash(ls)"] },
        // biome-ignore lint/style/useNamingConvention: Claude Code's own key.
        hooks: { PostToolUse: [{ matcher: "Edit", hooks: [own] }] },
      }),
    });
    init(root, "--agent", "claude");
    const settings: Settings = JSON.parse(read(root, SETTINGS));
    expect(settings.permissions).toEqual({
      allow: ["Bash(ls)"],
      deny: ["Edit(/.claude/settings*.json)", "Edit(/.inwards/**)"],
    });
    expect(settings.hooks["PostToolUse"]?.[0]).toEqual({ matcher: "Edit", hooks: [own] });
    expect(settings.hooks["PostToolUse"]).toHaveLength(2);
  });

  test("the installed hook runs with no shell, no PATH and no virtualenv", () => {
    const root = project({
      "pyproject.toml": LAYERS,
      "shop/domain/order.py": "import shop.infrastructure.db\n",
    });
    init(root, "--agent", "claude");
    const { command, args = [] } = ourEntry(root);
    const p = Bun.spawnSync([command, ...args], {
      cwd: root,
      stdin: new TextEncoder().encode(payload("post-write-order", root)),
      env: { SYSTEMROOT: process.env["SYSTEMROOT"] ?? "" }, // exec form, as Claude Code runs it
    });
    expect(p.exitCode).toBe(2);
    expect(p.stderr.toString()).toContain("INW001");
  });

  test("a user's own hook with the same arguments is left alone", () => {
    const own = { type: "command", command: "./scripts/audit.sh", args: ["hook", "claude-code"] };
    const root = project({
      "pyproject.toml": LAYERS,
      ".claude/settings.local.json": JSON.stringify({
        // biome-ignore lint/style/useNamingConvention: Claude Code's own key.
        hooks: { SessionStart: [{ hooks: [own] }] },
      }),
    });
    init(root, "--agent", "claude");
    const settings: Settings = JSON.parse(read(root, SETTINGS));
    expect(settings.hooks["SessionStart"]?.[0]?.hooks).toEqual([own]);
    expect(settings.hooks["SessionStart"]).toHaveLength(2);
  });

  test.each([
    ['{ "hooks": [] }', "not an object"],
    ['{ "hooks": { "SessionStart": {} } }', "not a list"],
    ["{ not json", "not valid JSON"],
  ])("settings %s stop init with exit 2", (settings, message) => {
    const root = project({ "pyproject.toml": LAYERS, ".claude/settings.local.json": settings });
    const { code, stderr } = init(root, "--agent", "claude");
    expect(code).toBe(2);
    expect(stderr).toContain(message);
    expect(read(root, SETTINGS)).toBe(settings);
  });

  test("run from a subdirectory, init writes next to pyproject.toml", () => {
    const root = project({ "pyproject.toml": LAYERS, "shop/domain/order.py": "X = 1\n" });
    inwards(["init", "--agent", "claude"], { cwd: join(root, "shop") });
    expect(read(root, SETTINGS)).toContain("claude-code");
    expect(read(root, ".gitignore")).toContain(".inwards/");
  });

  test("CRLF files stay CRLF", () => {
    const root = project({
      "pyproject.toml": LAYERS.replaceAll("\n", "\r\n"),
      ".gitignore": "dist/\r\n",
    });
    init(root, "--agent", "claude");
    expect(read(root, ".gitignore")).toBe(
      "dist/\r\n# Inwards: local state and machine-specific hooks\r\n.inwards/\r\n.claude/settings.local.json\r\n",
    );
    expect(read(root, "pyproject.toml")).toContain(`[tool.inwards]\r\n${PINNED}\r\n`);
  });

  test("required-version goes under a header with a comment, and is skipped with a warning where it can't go", () => {
    const commented = project({
      "pyproject.toml": LAYERS.replace("[tool.inwards]", "[tool.inwards]  # arch"),
    });
    init(commented, "--agent", "claude");
    expect(read(commented, "pyproject.toml")).toContain(PINNED);

    const tricky = `[project]\ndescription = """\n[tool.inwards]\n"""\n\n${LAYERS}`;
    const root = project({ "pyproject.toml": tricky });
    const { stdout } = init(root, "--agent", "claude");
    expect(stdout).toContain("could not add required-version");
    expect(read(root, "pyproject.toml")).toBe(tricky);
  });

  test("--dry-run prints the diff and writes nothing", () => {
    const root = project({ "pyproject.toml": LAYERS });
    const { code, stdout } = init(root, "--agent", "claude", "--dry-run");
    expect(code).toBe(0);
    expect(stdout).toContain(`+${PINNED}`);
    expect(stdout).toContain("+.inwards/");
    expect(read(root, "pyproject.toml")).toBe(LAYERS);
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

  test("agents-md refuses markers that don't form one pair", () => {
    const text = "<!-- inwards:end -->\nx\n<!-- inwards:begin -->\n";
    const root = project({ "pyproject.toml": LAYERS, "AGENTS.md": text });
    expect(init(root, "--agent", "agents-md").code).toBe(2);
    expect(read(root, "AGENTS.md")).toBe(text);
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

test("a reader that stops early (| head) gets no stack trace, and the exit code stands", () => {
  if (process.platform === "win32") {
    return; // no POSIX shell pipe
  }
  const root = project({ "pyproject.toml": LAYERS });
  // `| true` closes the pipe before anything is read, so every write hits EPIPE.
  const script = 'set -o pipefail; "$@" | true'; // the exit code is the CLI's
  const args = [...CMD, "init", "--agent", "claude", "--dry-run"];
  const run = Bun.spawnSync(["bash", "-c", script, "_", ...args], { cwd: root });
  expect(run.stderr.toString()).not.toContain("EPIPE");
  expect(run.exitCode).toBe(0);
});

test("init writes the default ignore list readably", () => {
  const root = project({ "pyproject.toml": LAYERS });
  inwards(["init", "--agent", "agents-md"], { cwd: root });
  expect(read(root, "pyproject.toml")).toContain(
    'ignore = ["tests", "scripts", "migrations", "conftest"]',
  );
});
