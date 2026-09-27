/**
 * @file The compiled binary end to end against the recorded Claude Code hook
 * payloads in `support/fixtures/claude-code`. The exit codes and output are
 * pinned in a snapshot, and garbage on stdin is a clean exit 1.
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

test.each(["json", "sarif", "concise"])("check --format %s", (format) => {
  expect(run(root, ["check", "--format", format])).toMatchSnapshot();
});

test.each([
  ["json", "0"],
  ["concise", "0"],
  ["sarif", "1"],
  ["text", "some"],
])("check --format %s --max-diagnostics %s", (format, max) => {
  expect(run(root, ["check", "--format", format, "--max-diagnostics", max])).toMatchSnapshot();
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

test("hook with garbage on stdin", () => {
  expect(run(root, ["hook", "claude-code"], "not json")).toMatchSnapshot();
});
