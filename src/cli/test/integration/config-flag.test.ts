/**
 * @file `--config` that doesn't name a file (#212): every command that takes
 * the flag answers with one line and exit 2 instead of a stack trace, and
 * writes nothing.
 */
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { inwards, LAYERS, project } from "../support/run.ts";

test.each([
  ["check", "missing.toml"],
  ["baseline", "missing.toml"],
  ["context", "missing.toml"],
  ["check", "shop"],
])("inwards %s --config %s is a usage error", (command, flag) => {
  const root = project({ "pyproject.toml": LAYERS });
  const { code, stdout, stderr } = inwards([command, "--config", flag], { cwd: root });
  expect([code, stdout, stderr]).toEqual([2, "", `--config ${flag}: no such file.\n`]);
  expect(existsSync(join(root, "inwards-baseline.json"))).toBe(false);
});
