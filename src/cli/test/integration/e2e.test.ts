/**
 * @file The compiled binary end to end against the recorded Claude Code hook
 * payloads in `support/fixtures/claude-code`. The exit codes and output are
 * pinned in a snapshot, and garbage on stdin is a clean exit 1. A PreToolUse
 * Write of a Python file the package shape forbids is denied (#96).
 */
import { expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { VERSION } from "@inwards/core";
import { inwards, LAYERS, payload, project, type RunResult } from "../support/run.ts";

// The contract agents and CI depend on: exit codes and output for every
// recorded payload, every machine format and the error paths. Any change fails
// here until the snapshot is updated on purpose (`bun test --update-snapshots`).
// Fix wording is pinned too: it is part of what the model reads.
const files = { "shop/domain/order.py": "import shop.infrastructure.db\n", "README.md": "hi" };
const root = project({ "pyproject.toml": LAYERS, ...files });
const DURATION = /"durationMs":[\d.]+/gu;
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
