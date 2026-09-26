import { describe, expect, test } from "bun:test";
import { rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { denied, pre } from "./guard-helpers.ts";
import { CLAUDE_USER_DIR, inwards, LAYERS, payload, project } from "./run.ts";
import { agentWrites, LEAK, put, session } from "./stop-helpers.ts";

const PYPROJECT = `[project]\nname = "shop"\ndependencies = ["attrs==23.1"]\n\n${LAYERS}`;

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
      "an Edit that sets the Stop gate mode",
      "Edit",
      { old_string: "[tool.inwards]\n", new_string: '[tool.inwards]\nstop-gate = "changed"\n' },
    ],
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

describe("config guard: review round 1", () => {
  test.each([
    ["curly quotes Claude Code would straighten", "modules = [“shop.domain”]"],
    ["an escape Claude Code would decode", 'modules = ["shop.\\u0064omain"]'],
  ])("an Edit it can't simulate exactly is denied: %s", (_, from) => {
    const root = project({ "pyproject.toml": PYPROJECT });
    const edit = {
      file_path: "pyproject.toml",
      old_string: from,
      new_string: 'modules = ["shop.core"]',
    };
    expect(denied(pre(root, "Edit", edit))).toContain("verbatim");
  });

  test("a file with mixed line ends is matched as Claude Code does", () => {
    const mixed = PYPROJECT.replace("\n\n", "\r\n\r\n");
    const root = project({ "pyproject.toml": mixed });
    const edit = {
      file_path: "pyproject.toml",
      old_string:
        'dependencies = ["attrs==23.1"]\n\n[tool.inwards]\nlayers = [\n  { name = "domain", modules = ["shop.domain"] },',
      new_string:
        'dependencies = ["attrs==23.1"]\n\n[tool.inwards]\nlayers = [\n  { name = "domain", modules = ["shop.core"] },',
    };
    expect(denied(pre(root, "Edit", edit))).toContain("[tool.inwards]");
  });

  test("an empty old_string creating a nested config is denied", () => {
    const root = project({ "pyproject.toml": PYPROJECT });
    const edit = { file_path: "shop/pyproject.toml", old_string: "", new_string: LAYERS };
    expect(denied(pre(root, "Edit", edit))).toContain("[tool.inwards]");
  });

  test("shell-form hooks in a hand-written settings.json are protected", () => {
    const root = project({ "pyproject.toml": PYPROJECT });
    const hook = { type: "command", command: "inwards hook claude-code" };
    put(root, ".claude/settings.json", `{"hooks":{"Stop":[{"hooks":[${JSON.stringify(hook)}]}]}}`);
    expect(
      denied(pre(root, "Write", { file_path: ".claude/settings.json", content: "{}" })),
    ).toContain("holds the Inwards hooks");
  });

  test("user settings reached through a symlink are protected", () => {
    const root = session();
    const dotfile = join(project({ "settings.json": '{"model":"opus"}' }), "settings.json");
    const link = join(CLAUDE_USER_DIR, "settings.json");
    rmSync(link, { force: true });
    symlinkSync(dotfile, link);
    try {
      const write = { file_path: link, content: '{"disableAllHooks":true}' };
      expect(denied(pre(root, "Write", write))).toContain("disableAllHooks");
    } finally {
      rmSync(link, { force: true });
    }
  });

  test("a config symlinked under another name is protected", () => {
    const root = project({ "config/base.toml": PYPROJECT });
    symlinkSync(join(root, "config/base.toml"), join(root, "pyproject.toml"));
    const edit = {
      file_path: "config/base.toml",
      old_string: '"shop.domain"',
      new_string: '"shop.core"',
    };
    expect(denied(pre(root, "Edit", edit))).toContain("[tool.inwards]");
  });

  test("a project without Inwards can fix and adopt its pyproject.toml freely", () => {
    const root = project({ "pyproject.toml": '[project\nname = "x"\n' });
    const fix = {
      file_path: "pyproject.toml",
      old_string: "[project\n",
      new_string: "[project]\n",
    };
    expect(denied(pre(root, "Edit", fix))).toBeUndefined();
    const adopt = { file_path: "pyproject.toml", content: LAYERS };
    expect(denied(pre(root, "Write", adopt))).toBeUndefined();
  });

  test("reordering keys inside a layer isn't a change", () => {
    const root = project({ "pyproject.toml": PYPROJECT });
    const edit = {
      file_path: "pyproject.toml",
      old_string: '{ name = "domain", modules = ["shop.domain"] }',
      new_string: '{ modules = ["shop.domain"], name = "domain" }',
    };
    expect(denied(pre(root, "Edit", edit))).toBeUndefined();
  });

  test.each([
    "rm -rf .inw*",
    "rm -rf {.inwards,x}",
    'rm -rf .inw"ards"',
    'inwards "hook" claude-code < fake.json',
  ])("Bash %s is denied", (command) => {
    expect(denied(pre(session(), "Bash", { command }))).toContain("ask the user");
  });

  test.each([
    "grep -rn TODO --exclude-dir=.inwards .",
    'rg -n "inwards hook" docs/',
    'git commit -m "docs: explain inwards baseline"',
    "cat .claude/settings.json",
  ])("Bash %s passes", (command) => {
    expect(denied(pre(session(), "Bash", { command }))).toBeUndefined();
  });
});
