/**
 * @file The config guard covers `[[tool.inwards.contexts]]` (#51): the table is
 * part of `[tool.inwards]`, so an agent can't add a context or loosen a
 * context's `depends-on` or `public` to let an import through.
 */
import { expect, test } from "bun:test";
import { denied, pre } from "../support/guard-helpers.ts";
import { LAYERS, project } from "../support/run.ts";

const CONTEXTS = `${LAYERS}
[[tool.inwards.contexts]]
name = "orders"
modules = ["shop.domain"]
public = []
`;

test.each([
  [
    "adding a context",
    `${LAYERS}`,
    `${LAYERS}\n[[tool.inwards.contexts]]\nname = "orders"\nmodules = ["shop.domain"]\n`,
  ],
  ["making a context's modules public", "public = []", 'public = ["shop.domain"]'],
])("an Edit %s is denied", (_what, oldString, newString) => {
  const root = project({ "pyproject.toml": CONTEXTS });
  const edit = { file_path: "pyproject.toml", old_string: oldString, new_string: newString };
  expect(denied(pre(root, "Edit", edit))).toBeDefined();
});
