/**
 * @file The config guard covers `[tool.inwards.templates]` (#97): a template
 * is part of `[tool.inwards]`, so an agent can't add a role, loosen a
 * template's `public` list or point an entry at another template to let an
 * import through. Each case runs the real PreToolUse hook.
 */
import { expect, test } from "bun:test";
import { denied, pre } from "../support/guard-helpers.ts";
import { project } from "../support/run.ts";

const TEMPLATES = `[tool.inwards]
layers = [{ name = "domain", modules = ["shop.*"], template = "slice" }]

[tool.inwards.templates.slice]
roles = ["models | schemas", "service"]
public = ["service"]
`;

test.each([
  ["making a template's models public", 'public = ["service"]', 'public = ["service", "models"]'],
  ["merging two sibling roles", '"models | schemas"', '"models", "schemas"'],
  ["dropping the template from a layer", ', template = "slice"', ""],
])("an Edit %s is denied", (_what, oldString, newString) => {
  const root = project({ "pyproject.toml": TEMPLATES });
  const edit = { file_path: "pyproject.toml", old_string: oldString, new_string: newString };
  expect(denied(pre(root, "Edit", edit))).toBeDefined();
});
