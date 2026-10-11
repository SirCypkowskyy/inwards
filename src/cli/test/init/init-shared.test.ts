/**
 * @file `inwards init --agent claude --shared` (#342): the hooks go into the
 * committed `.claude/settings.json` and the MCP server into `.mcp.json`, with
 * no machine path in either. A rerun changes nothing, the team's own hooks
 * and servers stay, an `inwards` server that runs something else stops init,
 * and Inwards' hooks leave `.claude/settings.local.json` so they don't run twice.
 */
import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { inwards, LAYERS, project, type RunResult } from "../support/run.ts";
import { tempDir } from "../support/temp.ts";

const SHARED = ".claude/settings.json";
const LOCAL = ".claude/settings.local.json";
const UV_RUN = 'cd "$CLAUDE_PROJECT_DIR" && uv run inwards hook claude-code';
const EVENTS = ["PostToolUse", "PreToolUse", "SessionStart", "Stop"];

/** One hook entry in Claude Code settings. */
interface HookEntry {
  type: string;
  command: string;
  args?: string[];
}

/** The parts of a Claude Code settings file these tests look at. */
interface Settings {
  hooks?: Record<string, { matcher?: string; hooks: HookEntry[] }[]>;
  permissions?: { allow?: string[]; deny?: string[] };
}

/** The parts of `.mcp.json` these tests look at. */
interface McpJson {
  mcpServers: Record<string, { command: string; args?: string[]; env?: unknown }>;
}

/**
 * Runs `inwards init` in a project.
 *
 * @param root - the project directory.
 * @param args - arguments after `init`.
 * @param env - extra environment, e.g. a `PATH`.
 * @returns the exit code and output.
 */
function init(root: string, args: string[], env: Record<string, string> = {}): RunResult {
  return inwards(["init", ...args], { cwd: root, env });
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
 * Parses a project's committed Claude Code settings.
 *
 * @param root - the project directory.
 * @param rel - the settings file.
 * @returns the parsed settings.
 */
function settings(root: string, rel = SHARED): Settings {
  return JSON.parse(read(root, rel));
}

/**
 * Lists the hook entries of every event in a settings file.
 *
 * @param s - parsed settings.
 * @returns the entries, in order.
 */
function entries(s: Settings): HookEntry[] {
  return Object.values(s.hooks ?? {}).flatMap((groups) => groups.flatMap((g) => g.hooks));
}

/**
 * Makes a directory holding a stand-in `inwards` executable, for a `PATH`
 * that has Inwards on it and nothing else.
 *
 * @returns the directory.
 */
function pathWithInwards(): string {
  const dir = tempDir("inwards-path-");
  for (const name of ["inwards", "inwards.exe"]) {
    writeFileSync(join(dir, name), "#!/bin/sh\n");
    chmodSync(join(dir, name), 0o755);
  }
  return dir;
}

describe("inwards init --agent claude --shared", () => {
  test("writes settings.json and .mcp.json with the launcher, ignores only .inwards/, and a rerun is a no-op", () => {
    const root = project({ "pyproject.toml": LAYERS });
    const first = init(root, ["--agent", "claude", "--shared", "--launcher", "uv run"]);
    expect(first.code).toBe(0);
    const shared = settings(root);
    expect(Object.keys(shared.hooks ?? {}).sort()).toEqual(EVENTS);
    expect(entries(shared).every((e) => e.command === UV_RUN && e.args === undefined)).toBe(true);
    expect(shared.permissions?.deny).toContain("Edit(/.claude/settings*.json)");
    const mcp: McpJson = JSON.parse(read(root, ".mcp.json"));
    expect(mcp.mcpServers).toEqual({ inwards: { command: "uv", args: ["run", "inwards", "mcp"] } });
    expect(existsSync(join(root, LOCAL))).toBe(false);
    const ignored = read(root, ".gitignore");
    expect(ignored).toContain(".inwards/");
    expect(ignored).not.toContain("settings");
    expect(ignored).not.toContain(".mcp.json");

    const files = [SHARED, ".mcp.json", ".gitignore", "pyproject.toml"];
    const before = files.map((f) => read(root, f));
    const again = init(root, ["--agent", "claude", "--shared", "--launcher", "uv run"]);
    expect(again.stdout).toContain("nothing to change");
    expect(files.map((f) => read(root, f))).toEqual(before);
  });

  test("without a launcher it needs inwards on PATH, and then records no path", () => {
    const root = project({ "pyproject.toml": LAYERS });
    const refused = init(root, ["--agent", "claude", "--shared"], {
      PATH: tempDir("inwards-empty-path-"),
    });
    expect(refused.code).toBe(2);
    expect(refused.stderr).toContain("--shared");
    expect(refused.stderr).toContain('--launcher "uv run"');
    expect(existsSync(join(root, SHARED))).toBe(false);
    expect(existsSync(join(root, ".mcp.json"))).toBe(false);

    const bin = pathWithInwards();
    expect(init(root, ["--agent", "claude", "--shared"], { PATH: bin }).code).toBe(0);
    const commands = new Set(entries(settings(root)).map((e) => e.command));
    expect([...commands]).toEqual(["inwards hook claude-code"]);
    expect(read(root, SHARED)).not.toContain(bin);
    const mcp: McpJson = JSON.parse(read(root, ".mcp.json"));
    expect(mcp.mcpServers["inwards"]).toEqual({ command: "inwards", args: ["mcp"] });
    // A PATH with more entries finds the same inwards, and the rerun changes nothing.
    expect(
      init(root, ["--agent", "claude", "--shared"], { PATH: `${bin}${delimiter}${bin}` }).stdout,
    ).toContain("nothing to change");
  });

  test("keeps the team's own hooks and servers, and moves Inwards' hooks out of the local file", () => {
    const own = { type: "command", command: "ruff check" };
    const root = project({
      "pyproject.toml": LAYERS,
      [SHARED]: JSON.stringify({
        permissions: { allow: ["Bash(ls)"] },
        // biome-ignore lint/style/useNamingConvention: Claude Code's own key.
        hooks: { PostToolUse: [{ matcher: "Edit", hooks: [own] }] },
      }),
      ".mcp.json": JSON.stringify({ mcpServers: { db: { command: "db-mcp" } } }),
    });
    // A machine-local setup from before, plus the user's own local hook and rule.
    expect(init(root, ["--agent", "claude"]).code).toBe(0);
    const local = settings(root, LOCAL);
    // biome-ignore lint/style/useNamingConvention: Claude Code's own key.
    local.hooks = { ...local.hooks, Notification: [{ hooks: [own] }] };
    writeFileSync(join(root, LOCAL), JSON.stringify(local));

    expect(init(root, ["--agent", "claude", "--shared", "--launcher", "uv run"]).code).toBe(0);
    const shared = settings(root);
    expect(shared.hooks?.["PostToolUse"]?.[0]).toEqual({ matcher: "Edit", hooks: [own] });
    expect(shared.permissions?.allow).toEqual(["Bash(ls)"]);
    const mcp: McpJson = JSON.parse(read(root, ".mcp.json"));
    expect(Object.keys(mcp.mcpServers)).toEqual(["db", "inwards"]);
    const after = settings(root, LOCAL);
    // biome-ignore lint/style/useNamingConvention: Claude Code's own key.
    expect(after.hooks).toEqual({ Notification: [{ hooks: [own] }] });
    expect(after.permissions?.deny).toContain("Edit(/.inwards/**)");

    // Back to a local setup: init warns that the hooks would run twice.
    expect(init(root, ["--agent", "claude"]).stdout).toContain("runs twice");
  });

  test("updates its own .mcp.json entry and keeps its env", () => {
    const root = project({
      "pyproject.toml": LAYERS,
      ".mcp.json": JSON.stringify({
        mcpServers: { inwards: { command: "inwards", args: ["mcp"], env: { A: "1" } } },
      }),
    });
    expect(init(root, ["--agent", "claude", "--shared", "--launcher", "uv run"]).code).toBe(0);
    const mcp: McpJson = JSON.parse(read(root, ".mcp.json"));
    expect(mcp.mcpServers["inwards"]).toEqual({
      command: "uv",
      args: ["run", "inwards", "mcp"],
      env: { A: "1" },
    });
  });

  test.each([
    ['{ "mcpServers": { "inwards": { "command": "node", "args": ["server.js"] } } }', "rename"],
    ['{ "mcpServers": { "inwards": { "type": "http", "url": "https://x.test/mcp" } } }', "rename"],
    ['{ "mcpServers": [] }', "not an object"],
    ["{ not json", "not valid JSON"],
  ])(".mcp.json %s stops init with exit 2 and nothing written", (text, message) => {
    const root = project({ "pyproject.toml": LAYERS, ".mcp.json": text });
    const pyproject = read(root, "pyproject.toml");
    const { code, stderr } = init(root, ["--agent", "claude", "--shared", "--launcher", "uv run"]);
    expect(code).toBe(2);
    expect(stderr).toContain(message);
    expect(read(root, ".mcp.json")).toBe(text);
    expect(read(root, "pyproject.toml")).toBe(pyproject);
    expect(existsSync(join(root, SHARED))).toBe(false);
  });

  test("works with Claude Code only", () => {
    const root = project({ "pyproject.toml": LAYERS });
    const { code, stderr } = init(root, [
      "--agent",
      "agents-md",
      "--shared",
      "--launcher",
      "uv run",
    ]);
    expect(code).toBe(2);
    expect(stderr).toContain("--agent claude only");
  });
});
