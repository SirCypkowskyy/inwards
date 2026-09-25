import { expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { VERSION } from "@inwards/core";
import { inwards, LAYERS, payload, project } from "./run.ts";

// The contract agents and CI depend on: exit codes and output for every
// recorded payload, every machine format and the error paths. Any change fails
// here until the snapshot is updated on purpose (`bun test --update-snapshots`).
// Fix wording is pinned too: it is part of what the model reads.
const files = { "shop/domain/order.py": "import shop.infrastructure.db\n", "README.md": "hi" };
const root = project({ "pyproject.toml": LAYERS, ...files });
const stable = (s: string) =>
  s.replace(/"durationMs":[\d.]+/g, '"durationMs":0').replaceAll(`"${VERSION}"`, '"<version>"');
const run = (cwd: string, args: string[], stdin?: string) => {
  const { code, stdout, stderr } = inwards(args, { cwd, stdin });
  return { code, stdout: stable(stdout), stderr: stable(stderr) };
};

const fixtures = readdirSync(join(import.meta.dir, "fixtures/claude-code"))
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.replace(/\.json$/, ""))
  .sort();

test.each(fixtures)("hook claude-code < %s", (name) => {
  expect(run(root, ["hook", "claude-code"], payload(name, root))).toMatchSnapshot();
});

test.each(["json", "sarif"])("check --format %s", (format) => {
  expect(run(root, ["check", "--format", format])).toMatchSnapshot();
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
