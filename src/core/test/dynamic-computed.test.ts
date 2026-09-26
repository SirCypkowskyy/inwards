import { describe, expect, test } from "bun:test";
import { check, file, found } from "./helpers.ts";

/** What `found` returns for one unverifiable call: its message names no target. */
const UNVERIFIABLE: [string, string][] = [["INW011", ""]];

describe("INW011: computed targets in an inner layer are unverifiable", () => {
  test.each([
    ["import_module(variable)", "import importlib\nimportlib.import_module(name)\n"],
    [
      "import_module(f-string with a field)",
      'import importlib\nimportlib.import_module(f"shop.{layer}.db")\n',
    ],
    ["import_module(name=variable)", "import importlib\nimportlib.import_module(name=mod)\n"],
    ["import_module(*args)", "import importlib\nimportlib.import_module(*args)\n"],
    [
      "import_module with a \\N{...} escape",
      'import importlib\nimportlib.import_module("shop.\\N{LATIN SMALL LETTER I}nfrastructure.db")\n',
    ],
    [
      "relative import_module with a variable package",
      'import importlib\nimportlib.import_module(".db", pkg)\n',
    ],
    [
      "relative import_module with package=variable",
      'import importlib\nimportlib.import_module(".db", package=settings.PACKAGE)\n',
    ],
    ["__import__(variable)", "__import__(name)\n"],
    ["__import__ with a computed level", '__import__("db", globals(), None, [], level)\n'],
    ["__import__ with a computed fromlist", '__import__("shop.domain", fromlist=names)\n'],
    ["__import__ with a computed fromlist entry", '__import__("shop.domain", fromlist=[name])\n'],
    ["builtins.__import__(variable)", "import builtins\nbuiltins.__import__(name)\n"],
    ["importlib.__import__(variable)", "import importlib\nimportlib.__import__(name)\n"],
    ["runpy.run_module(variable)", "import runpy\nrunpy.run_module(name)\n"],
    ["exec(variable)", "exec(code)\n"],
    ["eval(variable)", "eval(expr)\n"],
    ["exec(f-string with a field)", 'exec(f"import {mod}")\n'],
    ["exec(f-string field with a conversion)", "exec(f\"import shop.{'infrastructure'!s}.db\")\n"],
    ["exec of a compiled code object", 'exec(compile(src, "<x>", "exec"))\n'],
    [
      "a computed import_module inside a literal exec source",
      'exec("import importlib; importlib.import_module(name)")\n',
    ],
  ])("%s", (_, src) => {
    expect(found(src)).toEqual(UNVERIFIABLE);
  });
});

describe("INW011: computed targets through aliases", () => {
  test.each([
    [
      "from importlib import import_module as im",
      "from importlib import import_module as im\nim(name)\n",
    ],
    ["import importlib as il", "import importlib as il\nil.import_module(name)\n"],
    ["assigned alias", "import importlib\nload = importlib.import_module\nload(name)\n"],
    [
      "getattr with a literal name",
      'import importlib\ngetattr(importlib, "import_module")(name)\n',
    ],
    ["import builtins as b", "import builtins as b\nb.__import__(name)\n"],
    ["from runpy import run_module as rm", "from runpy import run_module as rm\nrm(name)\n"],
    ["from builtins import exec as run", "from builtins import exec as run\nrun(code)\n"],
  ])("%s", (_, src) => {
    expect(found(src)).toEqual(UNVERIFIABLE);
  });
});

describe("INW011: computed targets that are not reported", () => {
  test.each([
    ["compile, which only builds a code object", 'compile(src, "<x>", "exec")\n'],
    ["compile rebound from re", "from re import compile\nPATTERN = compile(RAW)\n"],
    [
      "relative import_module with package=None",
      'import importlib\nimportlib.import_module(".db", None)\n',
    ],
    [
      "__import__ with an empty literal fromlist",
      '__import__("shop.domain", globals(), None, [], 0)\n',
    ],
    ["__import__ with fromlist=None", '__import__("json", fromlist=None)\n'],
    [
      "run_module of a relative name, which fails at runtime",
      'import runpy\nrunpy.run_module(".x")\n',
    ],
    ["another module's import_module", "import mylib\nmylib.import_module(name)\n"],
    ["a method named eval", "model.eval(batch)\n"],
  ])("%s", (_, src) => {
    expect(found(src)).toEqual([]);
  });

  test("the outermost layer may load anything first-party", () => {
    expect(found("import importlib\nimportlib.import_module(name)\n", "shop/api/app.py")).toEqual(
      [],
    );
  });

  test("files outside every layer are not checked", () => {
    expect(found("import importlib\nimportlib.import_module(name)\n", "scripts/seed.py")).toEqual(
      [],
    );
  });

  test("every layer but the outermost is checked", () => {
    const src = "import importlib\nimportlib.import_module(name)\n";
    expect(found(src, "shop/application/service.py")).toEqual(UNVERIFIABLE);
    expect(found(src, "shop/infrastructure/db.py")).toEqual(UNVERIFIABLE);
  });
});

describe("INW011: unverifiable report", () => {
  const src = "import importlib\n\ndef load(name):\n    return importlib.import_module(name)\n";
  const [d, ...rest] = check(file("shop/domain/order.py", src));

  test("one error spanning the call", () => {
    expect(rest).toEqual([]);
    expect([d?.code, d?.severity, d?.line, d?.column, d?.endColumn]).toEqual([
      "INW011",
      "error",
      4,
      12,
      41,
    ]);
  });

  test("the message says the target can't be verified", () => {
    expect(d?.message).toStartWith(
      'Layer "domain" makes a dynamic import (importlib.import_module) whose module name or source is not a string literal',
    );
    expect(d?.message).toContain("can't verify that it points toward inner layers");
  });

  test("the fix says how to make it verifiable", () => {
    expect(d?.fix.summary).toBe(
      'Name the target with a string literal, or move the dynamic import to the outermost layer "interface".',
    );
    expect(d?.fix.steps[0]).toStartWith(
      "If the module is fixed, replace `importlib.import_module(name)`",
    );
    expect(d?.fix.steps[1]).toContain('outermost layer "interface"');
    expect(d?.fix.steps[2]).toContain("`shop.domain.ports`");
  });

  test("an unverifiable call reports once, next to what it does load", () => {
    const both = check(
      file("shop/domain/order.py", '__import__("shop.infrastructure", fromlist=names)\n'),
    );
    expect(both.map((x) => x.message.includes('imports "shop.infrastructure"'))).toEqual([
      true,
      false,
    ]);
  });
});
