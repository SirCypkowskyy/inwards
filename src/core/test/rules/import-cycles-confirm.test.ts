/**
 * @file How INW004 confirms the files inside a cyclic group. A file that holds
 * only top-level imports, comments and blank lines up to its last import
 * needs no parse, since its skeleton is its text there. Any other file is
 * parsed up to its last import when that text parses cleanly, and in full
 * otherwise; either way the cycle stands on the imports the full parse finds.
 */
import { describe, expect, test } from "bun:test";
import { type Diagnostic, Engine, parseConfig, type SourceFile } from "../../src/index.ts";
import { onlyImportsUpTo } from "../../src/python/prescan.ts";
import { file, grammars, indexOn } from "../support/helpers.ts";

describe("a head of imports only", () => {
  test("imports, comments and blank lines are one", () => {
    const text = "# header\n\nimport os\nfrom shop import (\n    a,\n    b,\n)\n\nx = 1\n";
    expect(onlyImportsUpTo(text, 5)).toBe(true);
    expect(onlyImportsUpTo("import os\n", 1)).toBe(true);
    expect(onlyImportsUpTo("", 0)).toBe(true);
  });

  test("a docstring, code or an indented import before the last import is not", () => {
    for (const [text, line] of [
      ['"""Doc."""\nimport os\n', 2],
      ["x = 1\nimport os\n", 2],
      ["if x:\n    import os\n", 2],
      ["    import os\n", 1],
      ['x = f"""{"""\nimport os\n"""}"""\n', 2],
    ] as const) {
      expect([text, onlyImportsUpTo(text, line)]).toEqual([text, false]);
    }
  });
});

const TOML = `[tool.inwards]
cycles = ["modules"]
layers = [{ name = "domain", modules = ["shop.domain"] }]
`;
const PROJECT = indexOn(
  new Map<string, "file" | "dir">([
    ["shop", "dir"],
    ["shop/domain", "dir"],
    ["shop/domain/a.py", "file"],
    ["shop/domain/b.py", "file"],
  ]),
);

const ENGINE: Engine = await Engine.create(grammars(), parseConfig(TOML));

/**
 * Checks two modules as a whole-project run.
 *
 * @param a - the text of `shop/domain/a.py`.
 * @param b - the text of `shop/domain/b.py`.
 * @returns the INW004 findings.
 */
function cycles(a: string, b: string): Diagnostic[] {
  const sources: SourceFile[] = [file("shop/domain/a.py", a), file("shop/domain/b.py", b)];
  return ENGINE.check(sources, PROJECT, undefined, { whole: true }).diagnostics.filter(
    (d) => d.code === "INW004",
  );
}

describe("the cycle stands on the full parse", () => {
  const B = "import shop.domain.a\n";

  test("imports after a docstring or inside a block still make a cycle", () => {
    for (const a of [
      '"""The a module."""\nfrom shop.domain import (\n    b,\n)\n\nX = 1\n',
      "from typing import TYPE_CHECKING\n\nif TYPE_CHECKING:\n    import shop.domain.b\n",
      "def f():\n    import shop.domain.b\n    return 1\n",
    ]) {
      expect([a, cycles(a, B).length]).toEqual([a, 1]);
    }
  });

  test("an import line inside a string, or after a syntax error, makes no cycle", () => {
    for (const a of [
      'NOTE = """\nimport shop.domain.b\n"""\n',
      'x = f"""{"""\nimport shop.domain.b\n"""}"""\n',
      "if x\nimport shop.domain.b\n",
      "x = [)\nimport shop.domain.b\n]\n",
    ]) {
      expect([a, cycles(a, B)]).toEqual([a, []]);
    }
  });
});
