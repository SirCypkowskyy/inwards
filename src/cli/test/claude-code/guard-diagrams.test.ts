/**
 * @file The config guard covers `diagrams` (#344): the list of diagram files
 * is part of `[tool.inwards]`, so an agent can't drop a diagram INW017
 * reports on, or add one, to change what a whole-project check reads. Each
 * case runs the real PreToolUse hook.
 */
import { expect, test } from "bun:test";
import { denied, pre } from "../support/guard-helpers.ts";
import { project } from "../support/run.ts";

const DIAGRAMS = `[tool.inwards]
diagrams = ["docs/architecture.md"]
layers = [{ name = "domain", modules = ["shop.domain"] }]

[tool.inwards.rules]
extend-select = ["INW017"]
`;

test.each([
  ["dropping a diagram", '["docs/architecture.md"]', "[]"],
  ["adding a diagram", '["docs/architecture.md"]', '["docs/architecture.md", "README.md"]'],
])("an Edit %s is denied", (_what, oldString, newString) => {
  const root = project({ "pyproject.toml": DIAGRAMS });
  const edit = { file_path: "pyproject.toml", old_string: oldString, new_string: newString };
  expect(denied(pre(root, "Edit", edit))).toBeDefined();
});
