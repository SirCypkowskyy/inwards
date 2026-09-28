/**
 * @file The config guard in a uv workspace whose members have their own
 * `[tool.inwards]` and whose root has none (#57). Before any session state
 * exists, an edit of a member's config or baseline is still denied. The
 * root's pyproject.toml stays editable, and a config outside the project is
 * still guarded in a project that uses Inwards.
 */
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { denied, pre } from "../support/guard-helpers.ts";
import { LAYERS, project } from "../support/run.ts";

describe("config guard: uv workspace members (#57)", () => {
  // No config at the root and no session state yet: only the members use Inwards.
  const root = project({
    "pyproject.toml": '[project]\nname = "ws"\n\n[tool.uv.workspace]\nmembers = ["packages/*"]\n',
    "packages/core/pyproject.toml": `[project]\nname = "core"\n\n${LAYERS}`,
    "packages/core/inwards-baseline.json": "{}\n",
  });

  test("an edit of a member's [tool.inwards] is denied", () => {
    const edit = {
      file_path: "packages/core/pyproject.toml",
      old_string: '"shop.domain"',
      new_string: '"shop.core"',
    };
    expect(denied(pre(root, "Edit", edit))).toContain("[tool.inwards]");
  });

  test("an edit of a member's baseline is denied", () => {
    const write = { file_path: "packages/core/inwards-baseline.json", content: "{}\n" };
    expect(denied(pre(root, "Write", write))).toContain("inwards-baseline.json");
  });

  test("the workspace root's pyproject.toml without [tool.inwards] stays editable", () => {
    const edit = { file_path: "pyproject.toml", old_string: '"ws"', new_string: '"ws2"' };
    expect(denied(pre(root, "Edit", edit))).toBeUndefined();
  });
});

test("a project with a root config still guards a config outside it", () => {
  // The member-directory lookup stays inside the project; the project-level answer still holds.
  const parent = project({
    "proj/pyproject.toml": LAYERS,
    "other/pyproject.toml": LAYERS,
  });
  const edit = {
    file_path: join(parent, "other/pyproject.toml"),
    old_string: '"shop.domain"',
    new_string: '"shop.core"',
  };
  expect(denied(pre(join(parent, "proj"), "Edit", edit))).toContain("[tool.inwards]");
});
