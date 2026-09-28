/**
 * @file INW011 on targets that are constant without being literals (#79): module-level
 * string constants and constant string expressions (`join`, `%`, `*`,
 * `format`, slicing, f-string conversions and format specs). It pins what
 * stays unverifiable too: a name that may be rebound, and folds outside the
 * supported subset. The string operations are checked against CPython's
 * results directly.
 */
import { describe, expect, test } from "bun:test";
import {
  braceFormatted,
  formatted,
  percentFormatted,
  repeated,
  sliced,
} from "../../../src/python/string-ops.ts";
import { found, unverifiable } from "../../support/helpers.ts";

const EXACT: [string, string][] = [["INW011", "shop.infrastructure.db"]];

describe("INW011: module-level constants", () => {
  test.each([
    [
      "a constant",
      'import importlib\nTARGET = "shop.infrastructure.db"\nimportlib.import_module(TARGET)\n',
    ],
    [
      "a constant read in a function",
      'import importlib\nTARGET = "shop.infrastructure.db"\ndef f():\n    return importlib.import_module(TARGET)\n',
    ],
    [
      "a constant built from another",
      'import importlib\nBASE = "shop.infrastructure"\nTARGET = BASE + ".db"\nimportlib.import_module(TARGET)\n',
    ],
    [
      "an annotated constant",
      'import importlib\nfrom typing import Final\nTARGET: Final = "shop.infrastructure.db"\nimportlib.import_module(TARGET)\n',
    ],
    [
      "a constant in an f-string",
      'import importlib\nBASE = "shop.infrastructure"\nimportlib.import_module(f"{BASE}.db")\n',
    ],
    [
      "a constant package",
      'import importlib\nPKG = "shop.infrastructure"\nimportlib.import_module(".db", PKG)\n',
    ],
  ])("%s", (_, src) => {
    expect(found(src)).toEqual(EXACT);
  });

  test.each([
    ["assigned twice", 'TARGET = "shop.domain"\nTARGET = "shop.infrastructure.db"\n'],
    ["augmented", 'TARGET = "shop.infrastructure"\nTARGET += ".db"\n'],
    ["a parameter of the same name", 'TARGET = "shop.domain"\ndef f(TARGET):\n    pass\n'],
    ["global in a function", 'TARGET = "shop.domain"\ndef f():\n    global TARGET\n'],
    ["a for target", 'TARGET = "shop.domain"\nfor TARGET in names:\n    pass\n'],
    ["a comprehension variable", 'TARGET = "shop.domain"\n[TARGET for TARGET in names]\n'],
    ["deleted", 'TARGET = "shop.domain"\ndel TARGET\n'],
    ["assigned under if", 'if flag:\n    TARGET = "shop.domain"\n'],
    ["a namespace writer", 'TARGET = "shop.domain"\nglobals().update(TARGET=name)\n'],
    ["a wildcard import", 'from settings import *\nTARGET = "shop.domain"\n'],
    ["an exec in the file", 'TARGET = "shop.domain"\nexec("x = 1")\n'],
    ["a non-constant value", "TARGET = input()\n"],
  ])("not a constant: %s", (_, head) => {
    const src = `import importlib\n${head}importlib.import_module(TARGET)\n`;
    expect(unverifiable(src)).toEqual(["unverifiable"]);
  });

  test("a constant exec source is still unverifiable, as exec may rebind names", () => {
    expect(unverifiable('CODE = "import shop.infrastructure.db"\nexec(CODE)\n')).toEqual([
      "unverifiable",
    ]);
  });
});

describe("INW011: constant string expressions", () => {
  test.each([
    ['"".join', '"".join(["shop", ".infrastructure", ".db"])'],
    ['".".join of a tuple', '".".join(("shop", "infrastructure", "db"))'],
    ["% with one value", '"%s.db" % "shop.infrastructure"'],
    ["% with a tuple", '"%s.%s" % ("shop.infrastructure", "db")'],
    ["* repetition", '"shop." + "infrastructure" * 1 + ".db"'],
    ["str.format", '"{}.db".format("shop.infrastructure")'],
    ["str.format by index and keyword", '"{0}.{name}".format("shop.infrastructure", name="db")'],
    ["slicing", '"xxshop.infrastructure.db"[2:]'],
    ["reverse slicing", '"bd.erutcurtsarfni.pohs"[::-1]'],
    ["indexing", '"s" + "_h"[-1] + "op.infrastructure.db"'],
    ["f-string !s", "f\"{'shop'!s}.infrastructure.db\""],
    ["f-string format spec", "f\"{'shop':>4}.infrastructure.db\""],
    ["f-string precision", "f\"{'shopping':.4}.infrastructure.db\""],
  ])("%s", (_, target) => {
    expect(found(`import importlib\nimportlib.import_module(${target})\n`)).toEqual(EXACT);
  });

  test("an exec source built with %", () => {
    expect(found('exec("import %s" % "shop.infrastructure.db")\n')).toEqual(EXACT);
  });

  test.each([
    ["%d", '"shop.%d" % 1'],
    ["% of a name", '"%s.db" % name'],
    ["{!r}", '"{!r}".format("shop")'],
    ["an attribute field", '"{0.x}".format("shop")'],
    ["f-string !r", "f\"{'shop'!r}\""],
    ["a nested format spec", "f\"{'shop':>{width}}\""],
    ["a computed slice bound", '"shop"[n:]'],
  ])("unverifiable: %s", (_, target) => {
    expect(unverifiable(`import importlib\nimportlib.import_module(${target})\n`)).toEqual([
      "unverifiable",
    ]);
  });
});

describe("string operations match CPython", () => {
  test.each([
    ["abcdef", [1, -1, null], "bcde"],
    ["abcdef", [null, null, -2], "fdb"],
    ["abcdef", [-2, null, null], "ef"],
    ["abcdef", [10, null, null], ""],
    ["abcdef", [4, 1, -1], "edc"],
  ] as const)("%p sliced by %p is %p", (value, [start, stop, step], expected) => {
    expect(sliced(value, start, stop, step)).toBe(expected);
  });

  test("a zero step is refused", () => {
    expect(sliced("abc", null, null, 0)).toBeNull();
  });

  test.each([
    ["ab", ">4", "  ab"],
    ["ab", "*^5", "*ab**"],
    ["abc", ".2", "ab"],
    ["ab", "s", "ab"],
    ["ab", "04", null],
    ["ab", "+", null],
  ])("format(%p, %p) is %p", (value, spec, expected) => {
    expect(formatted(value, spec)).toBe(expected);
  });

  test.each([
    ["%s-%s", ["a", "b"], "a-b"],
    ["100%%", [], "100%"],
    ["%s", ["a", "b"], null],
    ["%s %s", ["a"], null],
    ["%5s", ["a"], null],
  ])("%p %% %p is %p", (template, args, expected) => {
    expect(percentFormatted(template, args)).toBe(expected);
  });

  test.each([
    ["{}{}", ["a", "b"], "ab"],
    ["{1}{0}", ["a", "b"], "ba"],
    ["{{}}{}", ["a"], "{}a"],
    ["{}{0}", ["a"], null],
    ["{2}", ["a"], null],
    ["{", [], null],
  ])("%p.format(%p) is %p", (template, args, expected) => {
    expect(braceFormatted(template, args, new Map())).toBe(expected);
  });

  test("repetition is capped", () => {
    expect(repeated("ab", 2)).toBe("abab");
    expect(repeated("ab", -1)).toBe("");
    expect(repeated("ab", 1_000_000)).toBeNull();
  });
});
