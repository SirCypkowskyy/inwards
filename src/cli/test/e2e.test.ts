import { expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { VERSION } from "@inwards/core";
import { inwards, LAYERS, payload, project } from "./run.ts";

// The contract agents and CI depend on: exit codes and output shape for every
// recorded payload and machine format. Any change fails here until the
// snapshot is updated on purpose (`bun test --update-snapshots`).
const root = project({
  "pyproject.toml": LAYERS,
  "shop/domain/order.py": "import shop.infrastructure.db\n",
  "README.md": "hi",
});
const stable = (s: string) =>
  s.replace(/"durationMs":[\d.]+/g, '"durationMs":0').replaceAll(`"${VERSION}"`, '"<version>"');
const run = (args: string[], stdin?: string) => {
  const { code, stdout, stderr } = inwards(args, { cwd: root, stdin });
  return { code, stdout: stable(stdout), stderr: stable(stderr) };
};

const fixtures = readdirSync(join(import.meta.dir, "fixtures/claude-code"))
  .map((f) => f.replace(/\.json$/, ""))
  .sort();

test.each(fixtures)("hook claude-code < %s", (name) => {
  expect(run(["hook", "claude-code"], payload(name, root))).toMatchSnapshot();
});

test.each(["json", "sarif"])("check --format %s", (format) => {
  expect(run(["check", "--format", format])).toMatchSnapshot();
});
