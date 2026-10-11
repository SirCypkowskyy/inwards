/**
 * @file The compiled binary end to end against the recorded Claude Code hook
 * payloads in `support/fixtures/claude-code`. The exit codes and output are
 * pinned in a snapshot, and garbage on stdin is a clean exit 1. A PreToolUse
 * Write of a Python file the package shape forbids is denied (#96), and a
 * whole-project check reads the marked diagrams `diagrams` lists (#344), and
 * PostToolUse checks an edit of one of them (#348). The
 * Stop gate accepts hooks that live only in the committed
 * `.claude/settings.json` (`init --shared`, #342) and refuses once they are gone.
 */
import { expect, test } from "bun:test";
import { readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { VERSION } from "@inwards/core";
import { inwards, LAYERS, payload, project, type RunResult } from "../support/run.ts";
import { git, ID } from "../support/stop-helpers.ts";

// The contract agents and CI depend on: exit codes and output for every
// recorded payload, every machine format and the error paths. Any change fails
// here until the snapshot is updated on purpose (`bun test --update-snapshots`).
// Fix wording is pinned too: it is part of what the model reads.
const files = { "shop/domain/order.py": "import shop.infrastructure.db\n", "README.md": "hi" };
const root = project({ "pyproject.toml": LAYERS, ...files });
const DURATION = /"durationMs":[\d.]+/gu;
/** The same inside a JSON string, as in a hook's `additionalContext`. */
const QUOTED_DURATION = /\\"durationMs\\":[\d.]+/gu;
const TEXT_DURATION = /\([\d.]+ ms\)/gu;
const JSON_SUFFIX = /\.json$/u;

/**
 * Masks the parts of CLI output that change between runs: duration and version.
 *
 * @param s - raw stdout or stderr.
 * @returns the text with every duration set to 0 and the version as `<version>`.
 */
function stable(s: string): string {
  return s
    .replace(DURATION, '"durationMs":0')
    .replace(QUOTED_DURATION, '\\"durationMs\\":0')
    .replace(TEXT_DURATION, "(0 ms)")
    .replaceAll(`"${VERSION}"`, '"<version>"');
}

/**
 * Runs the CLI and masks run-dependent output, ready for a snapshot.
 *
 * @param cwd - the project directory.
 * @param args - CLI arguments.
 * @param stdin - text for stdin, if any.
 * @returns the exit code and masked output.
 */
function run(cwd: string, args: string[], stdin?: string): RunResult {
  const { code, stdout, stderr } = inwards(args, { cwd, stdin });
  return { code, stdout: stable(stdout), stderr: stable(stderr) };
}

const fixtures = readdirSync(join(import.meta.dir, "../support/fixtures/claude-code"))
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.replace(JSON_SUFFIX, ""))
  .sort();

test.each(fixtures)("hook claude-code < %s", (name) => {
  expect(run(root, ["hook", "claude-code"], payload(name, root))).toMatchSnapshot();
});

test.each(["json", "sarif", "concise", "github"])("check --format %s", (format) => {
  expect(run(root, ["check", "--format", format])).toMatchSnapshot();
});

test("check --format json reads the marked diagrams `diagrams` lists (INW017)", () => {
  const drawn = project({
    "pyproject.toml": `${LAYERS}diagrams = ["docs/*.md", "docs/missing.mmd"]

[tool.inwards.rules]
extend-select = ["INW017"]
`,
    ...files,
    "shop/infrastructure/db.py": "",
    "docs/architecture.md": [
      "# Architecture",
      "",
      "```mermaid",
      "%% inwards: layers",
      "flowchart LR",
      '  infra --> domain["shop.domian"]',
      "  infra --> pg[(Postgres)]:::external",
      "```",
      "",
    ].join("\n"),
  });
  expect(run(drawn, ["check", "--format", "json"])).toMatchSnapshot();
});

test("PostToolUse checks an edited diagram that `diagrams` lists, and only that one", () => {
  /**
   * Builds a project whose config lists docs/architecture.md, with a typo in its diagram.
   *
   * @param rules - the `[tool.inwards.rules]` table.
   * @returns the project directory.
   */
  function drawn(rules: string): string {
    return project({
      "pyproject.toml": `${LAYERS}diagrams = ["docs/architecture.md"]\n\n[tool.inwards.rules]\n${rules}`,
      ...files,
      "shop/infrastructure/db.py": "",
      "docs/architecture.md": [
        "```mermaid",
        "%% inwards: layers",
        "flowchart LR",
        '  infrastructure --> domain["shop.domian"]',
        "```",
        "",
      ].join("\n"),
      "docs/notes.md": "# Notes\n",
    });
  }
  /**
   * Sends the recorded PostToolUse Write, pointed at one file of the project.
   *
   * @param dir - the project.
   * @param rel - the written file, relative to the project.
   * @returns the hook's exit code and output.
   */
  function wrote(dir: string, rel: string): RunResult {
    const stdin = payload("post-write-readme", dir, {
      tool_input: { file_path: join(dir, rel) },
    });
    return run(dir, ["hook", "claude-code"], stdin);
  }
  const warned = drawn('extend-select = ["INW017", "INW018"]\n');
  expect(wrote(warned, "docs/architecture.md")).toMatchSnapshot("a warning is context");
  expect(wrote(warned, "docs/notes.md")).toEqual({ code: 0, stdout: "", stderr: "" });
  const raised = drawn('extend-select = ["INW017"]\nseverity = { INW017 = "error" }\n');
  expect(wrote(raised, "docs/architecture.md")).toMatchSnapshot("an error blocks");
  const off = drawn("");
  expect(wrote(off, "docs/architecture.md")).toEqual({ code: 0, stdout: "", stderr: "" });
});

test.each([
  ["json", "0"],
  ["concise", "0"],
  ["sarif", "1"],
  ["github", "0"],
  ["text", "some"],
])("check --format %s --max-diagnostics %s", (format, max) => {
  expect(run(root, ["check", "--format", format, "--max-diagnostics", max])).toMatchSnapshot();
});

test("check --format github names files from GITHUB_WORKSPACE", () => {
  const repo = project({
    "packages/api/pyproject.toml": LAYERS,
    "packages/api/shop/domain/order.py": "import shop.infrastructure.db\n",
    "packages/api/shop/infrastructure/db.py": "",
  });
  const { code, stdout } = inwards(["check", "--format", "github"], {
    cwd: join(repo, "packages/api"),
    env: { GITHUB_WORKSPACE: repo },
  });
  expect({ code, stdout: stable(stdout) }).toMatchSnapshot();
});

test.each([
  ["empty layers", "[tool.inwards]\nlayers = []\n"],
  ["invalid TOML", "[tool.inwards\nlayers = [\n"],
])("hook with a broken config: %s", (_, config) => {
  const broken = project({ "pyproject.toml": config, ...files });
  expect(
    run(broken, ["hook", "claude-code"], payload("post-write-order", broken)),
  ).toMatchSnapshot();
});

test("PreToolUse denies a Write of a new app/orders/helpers.py and passes utils.py", () => {
  const shaped = project({
    "pyproject.toml": `[tool.inwards]
layers = [{ name = "app", modules = ["app"] }]

[[tool.inwards.shape]]
packages = ["app.*"]
allow = ["router", "service", "utils"]
`,
    "app/__init__.py": "",
    "app/orders/__init__.py": "",
    "app/orders/service.py": "",
  });
  /**
   * Sends the recorded PreToolUse Write, pointed at one file of the project.
   *
   * @param rel - the file to write, relative to the project.
   * @returns the hook's exit code and output.
   */
  function write(rel: string): RunResult {
    const stdin = payload("pre-write-order", shaped, {
      tool_input: { file_path: join(shaped, rel) },
    });
    return run(shaped, ["hook", "claude-code"], stdin);
  }
  expect(write("app/orders/helpers.py")).toMatchInlineSnapshot(`
    {
      "code": 0,
      "stderr": "",
      "stdout": 
    "{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"inwards: app/orders/helpers.py was not created.\\nINW007 \\"helpers.py\\" is not an allowed member of package \\"app.orders\\". Move the code in \\"helpers.py\\" into utils.py. Move the code into app/orders/utils.py and delete helpers.py. Package \\"app.orders\\" may hold: router, service, utils. Don't edit [tool.inwards] yourself. If the package really needs this member, ask the user to change its [[tool.inwards.shape]]."}}
    "
    ,
    }
  `);
  expect(write("app/orders/utils.py")).toEqual({ code: 0, stdout: "", stderr: "" });
});

test("hook with garbage on stdin", () => {
  expect(run(root, ["hook", "claude-code"], "not json")).toMatchSnapshot();
});

test("Stop gate with the hooks only in the committed .claude/settings.json", () => {
  const shared = project({ "pyproject.toml": LAYERS, "shop/domain/order.py": "X = 1\n" });
  git(shared, "init", "-q");
  git(shared, "add", "-A");
  git(shared, "commit", "-qm", "start");
  expect(run(shared, ["init", "--agent", "claude", "--shared", "--launcher", "uv run"]).code).toBe(
    0,
  );
  /**
   * Sends one recorded hook payload for the test session.
   *
   * @param name - the fixture, e.g. `stop`.
   * @param extra - payload fields to override.
   * @returns the masked exit code and output.
   */
  function hook(name: string, extra: Record<string, unknown> = {}): RunResult {
    return run(
      shared,
      ["hook", "claude-code"],
      payload(name, shared, { session_id: ID, ...extra }),
    );
  }
  expect(hook("session-start", { source: "startup" })).toMatchSnapshot("session start");
  expect(hook("stop")).toMatchSnapshot("project-scope hooks pass");
  rmSync(join(shared, ".claude", "settings.json"));
  expect(hook("stop")).toMatchSnapshot("hooks missing everywhere");
});
