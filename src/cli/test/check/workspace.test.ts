/**
 * @file INW005's wording in a uv workspace (#203): with the config in one
 * member, an import of a sibling member is a "workspace package", while a
 * third-party import is still a "library". The fixture is a root
 * pyproject.toml with `[tool.uv.workspace]` and two `src/` layout members.
 */
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { inwards, project } from "../support/run.ts";

const MEMBER_CONFIG = `[project]
name = "qv-datasources"

[tool.inwards]
root = "src"
layers = [
  { name = "core", modules = ["qv_datasources.core"], allow-libraries = ["attrs"] },
  { name = "adapters", modules = ["qv_datasources.adapters"] },
]
`;

/**
 * Builds the workspace and checks the member that holds the config.
 *
 * @param source - the text of `qv_datasources/core/x.py`.
 * @returns the INW005 messages and fix summaries of `inwards check --format json`.
 */
function inw005(source: string): { message: string; fix: { summary: string } }[] {
  const root = project({
    "pyproject.toml": '[project]\nname = "qv"\n\n[tool.uv.workspace]\nmembers = ["packages/*"]\n',
    "packages/qv-core/pyproject.toml": '[project]\nname = "qv-core"\n',
    "packages/qv-core/src/qv_core/__init__.py": "",
    "packages/qv-datasources/pyproject.toml": MEMBER_CONFIG,
    "packages/qv-datasources/src/qv_datasources/__init__.py": "",
    "packages/qv-datasources/src/qv_datasources/core/__init__.py": "",
    "packages/qv-datasources/src/qv_datasources/core/x.py": source,
    "packages/qv-datasources/src/qv_datasources/adapters/__init__.py": "",
  });
  const { stdout } = inwards(["check", "--format", "json"], {
    cwd: join(root, "packages/qv-datasources"),
  });
  const report: { diagnostics: { code: string; message: string; fix: { summary: string } }[] } =
    JSON.parse(stdout);
  return report.diagnostics.filter((d) => d.code === "INW005");
}

describe("INW005 in a uv workspace (#203)", () => {
  test("an import of a sibling member says workspace package", () => {
    const [d, ...rest] = inw005("import qv_core.models\n");
    expect(rest).toEqual([]);
    expect(d?.message).toBe(
      'Layer "core" imports "qv_core.models" from workspace package "qv_core", which "core" may not use.',
    );
    expect(d?.fix.summary).toBe(
      '"core" may not use workspace package "qv_core": use a package it may use, or ask the user to allow "qv_core".',
    );
  });

  test("a third-party import still says library", () => {
    const [d] = inw005("import requests\n");
    expect(d?.message).toBe(
      'Layer "core" imports "requests" from library "requests", which "core" may not use.',
    );
  });
});
