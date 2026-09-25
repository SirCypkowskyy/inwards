import { describe, expect, test } from "bun:test";
import { mentionsDynamicImport } from "../src/dynamic.ts";
import { skeletonImports } from "../src/prescan.ts";
import { engine, file, parser } from "./helpers.ts";

const TARGET = /imports "(?<t>[^"]+)"/u;

/**
 * Checks a snippet as a domain module and lists what INW011 reports.
 *
 * @param src - Python source.
 * @param path - where the file sits; a domain module by default.
 * @returns `[code, target]` for each diagnostic, the target read from the message.
 */
function found(src: string, path = "shop/domain/order.py"): [string, string][] {
  return engine
    .checkFile(file(path, src))
    .map((d) => [d.code, TARGET.exec(d.message)?.groups?.["t"] ?? ""]);
}

describe("INW011 dynamic-import: call forms", () => {
  test.each([
    [
      "importlib.import_module",
      'import importlib\nimportlib.import_module("shop.infrastructure.db")\n',
    ],
    [
      "import_module(name=...)",
      'import importlib\nimportlib.import_module(name="shop.infrastructure.db")\n',
    ],
    ["__import__", '__import__("shop.infrastructure.db")\n'],
    ["builtins.__import__", 'import builtins\nbuiltins.__import__("shop.infrastructure.db")\n'],
    ["importlib.__import__", 'import importlib\nimportlib.__import__("shop.infrastructure.db")\n'],
    ["runpy.run_module", 'import runpy\nrunpy.run_module("shop.infrastructure.db")\n'],
    ["exec", 'exec("from shop.infrastructure import db")\n'],
    [
      "exec with a triple-quoted block",
      'exec("""\nif True:\n    import shop.infrastructure.db\n""")\n',
    ],
    ["eval of __import__", "eval(\"__import__('shop.infrastructure.db')\")\n"],
    ["compile", 'compile("import shop.infrastructure.db", "<x>", "exec")\n'],
    [
      "compile(source=...)",
      'compile(source="import shop.infrastructure.db", filename="x", mode="exec")\n',
    ],
    ["builtins.exec", 'import builtins\nbuiltins.exec("import shop.infrastructure.db")\n'],
    ["__builtins__ subscript", '__builtins__["exec"]("import shop.infrastructure.db")\n'],
  ])("%s is reported as INW011", (_, src) => {
    expect(found(src)).toEqual([["INW011", "shop.infrastructure.db"]]);
  });
});

describe("INW011: aliases", () => {
  test.each([
    [
      "import importlib as il",
      'import importlib as il\nil.import_module("shop.infrastructure.db")\n',
    ],
    [
      "from importlib import import_module",
      'from importlib import import_module\nimport_module("shop.infrastructure.db")\n',
    ],
    [
      "from importlib import import_module as im",
      'from importlib import import_module as im\nim("shop.infrastructure.db")\n',
    ],
    [
      "from importlib import *",
      'from importlib import *\nimport_module("shop.infrastructure.db")\n',
    ],
    [
      "import importlib.util",
      'import importlib.util\nimportlib.import_module("shop.infrastructure.db")\n',
    ],
    [
      "from runpy import run_module as rm",
      'from runpy import run_module as rm\nrm("shop.infrastructure.db")\n',
    ],
    ["import builtins as b", 'import builtins as b\nb.__import__("shop.infrastructure.db")\n'],
    [
      "from builtins import exec as run",
      'from builtins import exec as run\nrun("import shop.infrastructure.db")\n',
    ],
    [
      "assigned alias",
      'import importlib\nload = importlib.import_module\nload("shop.infrastructure.db")\n',
    ],
    [
      "chained assignment",
      'import importlib as a\nb = a\nc = b.import_module\nc("shop.infrastructure.db")\n',
    ],
    [
      "getattr with a literal name",
      'import importlib\ngetattr(importlib, "import_module")("shop.infrastructure.db")\n',
    ],
    [
      "__import__ of importlib",
      '__import__("importlib").import_module("shop.infrastructure.db")\n',
    ],
    ["parenthesised callee", '(exec)("import shop.infrastructure.db")\n'],
    ["NFKC identifiers", 'ｅxec("import shop.infrastructure.db")\n'],
    [
      "alias bound inside the exec source",
      "exec(\"import importlib as i; i.import_module('shop.infrastructure.db')\")\n",
    ],
  ])("%s", (_, src) => {
    expect(found(src)).toEqual([["INW011", "shop.infrastructure.db"]]);
  });
});

describe("INW011: literal spellings", () => {
  test.each([
    ["implicit concatenation", 'exec("from shop.infra" "structure import db")\n'],
    ["escapes", 'exec("\\x69mport shop.infrastructure.db")\n'],
    ["octal and \\u escapes", 'exec("\\151mport shop.\\u0069nfrastructure.db")\n'],
    ["bytes source", 'exec(b"import shop.infrastructure.db")\n'],
    ["raw string", 'exec(r"import shop.infrastructure.db")\n'],
    ["f-string without fields", 'exec(f"import shop.infrastructure.db")\n'],
    ["parenthesised literal", 'exec(("import shop.infrastructure.db"))\n'],
    ["CRLF file", 'exec("""\r\nimport shop.infrastructure.db\r\n""")\r\n'],
  ])("%s", (_, src) => {
    expect(found(src)).toEqual([["INW011", "shop.infrastructure.db"]]);
  });
});

describe("INW011: relative and partial targets", () => {
  test.each([
    [
      "import_module with a literal package",
      'import importlib\nimportlib.import_module(".db", "shop.infrastructure")\n',
    ],
    [
      "import_module with package=__package__",
      'import importlib\nimportlib.import_module("..infrastructure.db", package=__package__)\n',
    ],
    ["__import__ with a level", '__import__("infrastructure.db", globals(), None, [], 2)\n'],
    ["relative import inside exec", 'exec("from ..infrastructure import db")\n'],
  ])("%s resolves against the file's package", (_, src) => {
    expect(found(src)).toEqual([["INW011", "shop.infrastructure.db"]]);
  });

  test("__import__ with a fromlist imports each listed name", () => {
    expect(found('__import__("shop", fromlist=["infrastructure", "domain"])\n')).toEqual([
      ["INW011", "shop.infrastructure"],
    ]);
  });

  test("a relative import_module without a package is skipped, as it fails at runtime", () => {
    expect(found('import importlib\nimportlib.import_module(".db")\n')).toEqual([]);
  });
});

describe("INW011: what is not reported", () => {
  test.each([
    ["a computed target", "import importlib\nimportlib.import_module(name)\n"],
    ["an f-string with a field", 'exec(f"import {mod}")\n'],
    ["an inward target", 'import importlib\nimportlib.import_module("shop.domain.money")\n'],
    ["a third-party target", 'import importlib\nimportlib.import_module("json")\n'],
    ["re.compile", 'import re\nre.compile("import shop.infrastructure.db")\n'],
    ["a loader named in a docstring", '"""importlib.import_module("shop.infrastructure.db")"""\n'],
    [
      "another module's import_module",
      'import mylib\nmylib.import_module("shop.infrastructure.db")\n',
    ],
  ])("%s", (_, src) => {
    expect(found(src)).toEqual([]);
  });

  test("files outside every layer are not checked", () => {
    expect(found('__import__("shop.infrastructure.db")\n', "scripts/seed.py")).toEqual([]);
  });

  test("a builtin shadowed in one scope stays a builtin elsewhere", () => {
    const src = 'def f():\n    from mylib import exec\nexec("import shop.infrastructure.db")\n';
    expect(found(src)).toEqual([["INW011", "shop.infrastructure.db"]]);
  });
});

describe("INW011: report", () => {
  const src = [
    "import importlib",
    "import shop.api",
    "def load():",
    '    return importlib.import_module("shop.infrastructure.db")',
    "",
  ].join("\n");
  const diagnostics = engine.checkFile(file("shop/domain/order.py", src));

  test("static and dynamic findings come back in source order", () => {
    expect(diagnostics.map((d) => [d.code, d.line, d.column])).toEqual([
      ["INW001", 2, 8],
      ["INW011", 4, 12],
    ]);
  });

  test("the message names the loader and the fix says to remove it, not hide it", () => {
    const [, d] = diagnostics;
    expect(d?.message).toContain("dynamic import (importlib.import_module)");
    expect(d?.fix.steps[0]).toStartWith(
      'Delete `importlib.import_module("shop.infrastructure.db")`.',
    );
    expect(d?.fix.steps.join(" ")).toContain("Protocol");
    expect(d?.endColumn).toBe(61);
  });
});

describe("INW011 and the import skeleton", () => {
  const src =
    'import importlib\n\ndef f():\n    return importlib.import_module("shop.infrastructure.db")\n';

  test("the skeleton alone accepts the file and sees no violation", () => {
    const refs = skeletonImports(parser, file("shop/domain/order.py", src));
    expect(refs?.map((r) => r.target)).toEqual(["importlib"]);
  });

  test("the loader name forces the full parse, so the dynamic import is found", () => {
    expect(mentionsDynamicImport(src)).toBe(true);
    expect(found(src)).toEqual([["INW011", "shop.infrastructure.db"]]);
  });

  test.each([
    ["re.compile", "import re\nP = re.compile('x')\n", false],
    ["no loader", "import shop.domain.money\n", false],
    ["fullwidth exec", "ｅｘｅｃ('x')\n", true],
    ["builtins", "import builtins\n", true],
  ])("hint: %s", (_, text, expected) => {
    expect(mentionsDynamicImport(text)).toBe(expected);
  });
});
