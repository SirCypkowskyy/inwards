/**
 * @file The command line's first-touch output end to end (#335): `--help` on
 * every command, an unknown option or command, a bad option value, a missing
 * config, and a rule name written where a code belongs. Exit codes and text
 * are pinned in a snapshot, with the version masked; help goes to stdout with
 * exit 0, and every mistake is one line on stderr with exit 2.
 */
import { expect, test } from "bun:test";
import { VERSION } from "@inwards/core";
import { COMMANDS } from "../../src/commands/usage.ts";
import { inwards, LAYERS, project, type RunResult } from "../support/run.ts";

const empty = project({ "README.md": "hi" });
const configured = project({ "pyproject.toml": LAYERS, "shop/domain/order.py": "" });

/**
 * Runs the CLI and masks the version, ready for a snapshot.
 *
 * @param cwd - the directory to run in.
 * @param args - CLI arguments.
 * @returns the exit code and output, with the version replaced by `<version>`.
 */
function run(cwd: string, args: string[]): RunResult {
  const { code, stdout, stderr } = inwards(args, { cwd });
  return { code, stdout: masked(stdout), stderr: masked(stderr) };
}

/**
 * Replaces the version in the overview's first line.
 *
 * @param s - stdout or stderr.
 * @returns the text with `inwards <version>` for `inwards 0.1.0`.
 */
function masked(s: string): string {
  return s.replaceAll(`inwards ${VERSION}`, "inwards <version>");
}

test("--help prints the overview with every style", () => {
  const result = run(empty, ["--help"]);
  expect(result).toMatchSnapshot();
  expect(result.stdout).toContain("vertical-slices|bounded-contexts|django|fastapi");
});

test.each([...COMMANDS])("%s --help prints that command's usage, exit 0", (command) => {
  const result = run(empty, [command, "--help"]);
  expect(result.code).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout).toStartWith(`Usage: inwards ${command}`);
  expect(result).toMatchSnapshot();
});

test.each(["check --bogus", "-x", "init -hx", "check --format", "check --log=yes", "frobnicate"])(
  "a usage mistake is one line, exit 2: inwards %s",
  (line) => {
    const result = run(configured, line.split(" "));
    expect(result.code).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr.trimEnd().split("\n")).toHaveLength(1);
    expect(result).toMatchSnapshot();
  },
);

test("a missing config suggests inwards init", () => {
  expect(run(empty, ["check"])).toMatchSnapshot();
});

test("a rule name where a code belongs suggests the code", () => {
  const named = project({
    "pyproject.toml": `${LAYERS}\n[tool.inwards.rules]\nignore = ["layer-dependency"]\n`,
  });
  expect(run(named, ["check"])).toMatchSnapshot();
});
