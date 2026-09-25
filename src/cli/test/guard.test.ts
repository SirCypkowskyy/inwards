import { describe, expect, test } from "bun:test";
import { symlinkSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { CLAUDE_USER_DIR, inwards, LAYERS, payload, project, type RunResult } from "./run.ts";
import { agentWrites, LEAK, put, session } from "./stop-helpers.ts";

const PYPROJECT = `[project]\nname = "shop"\ndependencies = ["attrs==23.1"]\n\n${LAYERS}`;

/**
 * Sends a PreToolUse event for one tool call.
 *
 * @param root - the project directory.
 * @param tool - the tool name.
 * @param input - the tool input; `file_path` is taken relative to the project.
 * @returns the hook's exit code and output.
 */
function pre(root: string, tool: string, input: Record<string, unknown>): RunResult {
  const file = input["file_path"];
  const relative = typeof file === "string" && !isAbsolute(file);
  const toolInput = relative ? { ...input, file_path: join(root, file) } : input;
  const stdin = payload("pre-edit-order", root, { tool_name: tool, tool_input: toolInput });
  return inwards(["hook", "claude-code"], { cwd: root, stdin });
}

/**
 * Reads the deny reason out of a PreToolUse response.
 *
 * @param result - the hook run.
 * @returns the reason, or undefined when the call was let through.
 */
function denied(result: RunResult): string | undefined {
  if (result.code !== 0) {
    throw new Error(`PreToolUse exited ${result.code}: ${result.stderr}`);
  }
  if (result.stdout === "") {
    return undefined;
  }
  const out: {
    hookSpecificOutput: { permissionDecision: string; permissionDecisionReason: string };
  } = JSON.parse(result.stdout);
  if (out.hookSpecificOutput.permissionDecision !== "deny") {
    throw new Error(`unexpected decision ${out.hookSpecificOutput.permissionDecision}`);
  }
  return out.hookSpecificOutput.permissionDecisionReason;
}

describe("config guard: pyproject.toml", () => {
  const root = project({ "pyproject.toml": PYPROJECT });

  test("a dependency bump passes", () => {
    const edit = {
      file_path: "pyproject.toml",
      old_string: "attrs==23.1",
      new_string: "attrs==24.2",
    };
    expect(denied(pre(root, "Edit", edit))).toBeUndefined();
  });

  test.each([
    ["an Edit to a layer", "Edit", { old_string: '"shop.domain"', new_string: '"shop.core"' }],
    [
      "a MultiEdit that drops a layer",
      "MultiEdit",
      {
        edits: [
          { old_string: "attrs==23.1", new_string: "attrs==24.2" },
          {
            old_string: '  { name = "infrastructure", modules = ["shop.infrastructure"] },\n',
            new_string: "",
          },
        ],
      },
    ],
    ["a Write that removes the table", "Write", { content: '[project]\nname = "shop"\n' }],
    [
      "an edit that breaks the TOML",
      "Edit",
      { old_string: "layers = [", new_string: "layers = [[" },
    ],
  ])("%s is denied and tells the agent to ask the user", (_, tool, input) => {
    const reason = denied(pre(root, tool, { file_path: "pyproject.toml", ...input }));
    expect(reason).toContain("[tool.inwards]");
    expect(reason).toContain("ask the user");
  });

  test("a CRLF file edited with LF strings is still compared", () => {
    const crlf = project({ "pyproject.toml": PYPROJECT.replaceAll("\n", "\r\n") });
    const edit = {
      file_path: "pyproject.toml",
      old_string: '  { name = "domain", modules = ["shop.domain"] },\n',
      new_string: '  { name = "domain", modules = ["shop.core"] },\n',
    };
    expect(denied(pre(crlf, "Edit", edit))).toContain("[tool.inwards]");
  });

  test("a new nested pyproject.toml with [tool.inwards] is denied, one without passes", () => {
    const nested = { file_path: "shop/pyproject.toml" };
    expect(denied(pre(root, "Write", { ...nested, content: LAYERS }))).toContain("[tool.inwards]");
    const plain = { ...nested, content: '[project]\nname = "sub"\n' };
    expect(denied(pre(root, "Write", plain))).toBeUndefined();
  });
});

describe("config guard: session state and settings", () => {
  test.each([
    ["Edit", { file_path: ".inwards/state/s.jsonl", old_string: "a", new_string: "b" }],
    ["Write", { file_path: ".inwards/state/s.start.json", content: "{}" }],
    ["Bash", { command: "echo '{}' > .inwards/state/s.start.json" }],
    ["Bash", { command: "rm -rf ./.inwards" }],
    ["Bash", { command: "inwards hook claude-code < fake.json" }],
    ["Bash", { command: "sed -i 's/Stop/X/' .claude/settings.local.json" }],
    ["Edit", { file_path: ".claude/settings.local.json", old_string: "Stop", new_string: "X" }],
  ])("%s %j is denied", (tool, input) => {
    const root = session();
    expect(denied(pre(root, tool, input))).toContain("ask the user");
  });

  test("a symlink can't disguise .inwards", () => {
    const root = session();
    symlinkSync(join(root, ".inwards"), join(root, "st"), "dir");
    expect(denied(pre(root, "Write", { file_path: "st/state/x.jsonl", content: "" }))).toContain(
      ".inwards",
    );
  });

  test("disableAllHooks in the user's settings is denied", () => {
    const root = session();
    const userSettings = join(CLAUDE_USER_DIR, "settings.json");
    const write = { file_path: userSettings, content: '{ "disableAllHooks": true }' };
    expect(denied(pre(root, "Write", write))).toContain("disableAllHooks");
  });

  test("ordinary commands and edits pass, and a project without Inwards is left alone", () => {
    const root = session();
    expect(denied(pre(root, "Bash", { command: "ls -la && bun test" }))).toBeUndefined();
    const edit = { file_path: "shop/domain/order.py", old_string: "X = 1", new_string: "X = 2" };
    expect(denied(pre(root, "Edit", edit))).toBeUndefined();
    const plain = project({ "app.py": "" });
    expect(denied(pre(plain, "Bash", { command: "cat .inwards/x" }))).toBeUndefined();
  });
});

describe("config discovery during a session", () => {
  test("a new nested config can't take over the files under it", () => {
    const root = session();
    put(
      root,
      "shop/pyproject.toml",
      '[tool.inwards]\nlayers = [{ name = "x", modules = ["y"] }]\n',
    );
    put(root, "shop/domain/order.py", LEAK);
    const stdin = payload("post-write-order", root, {
      session_id: "stop-test",
      tool_input: { file_path: join(root, "shop/domain/order.py") },
    });
    const { code, stderr } = inwards(["hook", "claude-code"], { cwd: root, stdin });
    expect(code).toBe(2);
    expect(stderr).toContain("INW001");
    agentWrites(root, "shop/domain/order.py", "X = 2\n");
    writeFileSync(join(root, "shop/pyproject.toml"), "");
  });
});
