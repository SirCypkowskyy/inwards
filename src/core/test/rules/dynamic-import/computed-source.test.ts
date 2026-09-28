/**
 * @file INW011 for computed targets: a loader or `exec` whose target isn't a literal
 * is unverifiable in an inner layer. The tests cover aliases, the exempt cases
 * and how the report is worded and re-levelled.
 */
import { describe, expect, test } from "bun:test";
import { Engine, parseConfig } from "../../../src/index.ts";
import { check, file, found, grammars, PROJECT, unverifiable } from "../../support/helpers.ts";

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
    [
      "relative import_module with the package behind **kwargs",
      'import importlib\nimportlib.import_module(".infrastructure.db", **opts)\n',
    ],
    ["__import__(variable)", "__import__(name)\n"],
    ["__import__ with a computed level", '__import__("db", globals(), None, [], level)\n'],
    [
      "__import__ with the level behind *args",
      '__import__("infrastructure.db", *(globals(), None, None, 2))\n',
    ],
    ["__import__ with a computed fromlist", '__import__("shop.domain", fromlist=names)\n'],
    ["__import__ with a computed fromlist entry", '__import__("shop.domain", fromlist=[name])\n'],
    ["builtins.__import__(variable)", "import builtins\nbuiltins.__import__(name)\n"],
    ["importlib.__import__(variable)", "import importlib\nimportlib.__import__(name)\n"],
    ["runpy.run_module(variable)", "import runpy\nrunpy.run_module(name)\n"],
    ["exec(variable)", "exec(code)\n"],
    ["eval(variable)", "eval(expr)\n"],
    ["exec(f-string with a field)", 'exec(f"import {mod}")\n'],
    ["exec(f-string field with !r)", "exec(f\"import shop.{'infrastructure'!r}.db\")\n"],
    ["exec of a code object compiled from a variable", 'exec(compile(src, "<x>", "exec"))\n'],
    [
      "a computed import_module inside a literal exec source",
      'exec("import importlib; importlib.import_module(name)")\n',
    ],
    [
      "one name bound to two loaders reports once",
      "import importlib, runpy\nload = importlib.import_module\nload = runpy.run_module\nload(name)\n",
    ],
  ])("%s", (_, src) => {
    expect(unverifiable(src)).toEqual(["unverifiable"]);
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
    ["from builtins import eval", "from builtins import eval\neval(expr)\n"],
    ["builtins.eval next to a local eval", "import builtins\neval = make()\nbuiltins.eval(expr)\n"],
    [
      "a method named eval does not rebind",
      "class M:\n    def eval(self):\n        pass\neval(expr)\n",
    ],
  ])("%s", (_, src) => {
    expect(unverifiable(src)).toEqual(["unverifiable"]);
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
      'relative import_module with package=""',
      'import importlib\nimportlib.import_module(".db", package="")\n',
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
    [
      "exec of a code object compiled from a literal",
      'exec(compile("import shop.domain.money", "<x>", "exec"))\n',
    ],
    ["another module's import_module", "import mylib\nmylib.import_module(name)\n"],
    ["a method named eval", "model.eval(batch)\n"],
    ["session.exec", "session.exec(select(User))\n"],
    ["cursor.execute", "cursor.execute(q)\n"],
    ["df.eval", "df.eval(expr)\n"],
  ])("%s", (_, src) => {
    expect(found(src)).toEqual([]);
  });

  test("the outermost layer may load anything first-party", () => {
    const src = "import importlib\nimportlib.import_module(name)\n";
    expect(found(src, "shop/api/app.py")).toEqual([]);
  });

  test("files outside every layer are not checked", () => {
    const src = "import importlib\nimportlib.import_module(name)\n";
    expect(found(src, "scripts/seed.py")).toEqual([]);
  });

  test("every layer but the outermost is checked", () => {
    const src = "import importlib\nimportlib.import_module(name)\n";
    expect(unverifiable(src, "shop/application/service.py")).toEqual(["unverifiable"]);
    expect(unverifiable(src, "shop/infrastructure/db.py")).toEqual(["unverifiable"]);
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
      `Layer "domain" makes a dynamic import (importlib.import_module) with an argument Inwards can't read`,
    );
    expect(d?.message).toEndWith("can't verify that it points toward inner layers.");
  });

  test("the fix says how to make it verifiable", () => {
    expect(d?.fix.summary).toBe(
      'Name the target with string literals, or move the dynamic import to the outermost layer "interface".',
    );
    expect(d?.fix.steps[0]).toStartWith(
      "If the module is fixed, replace `importlib.import_module(name)`",
    );
    expect(d?.fix.steps[1]).toContain('outermost layer "interface"');
    expect(d?.fix.steps[2]).toContain("`shop.domain.ports`");
  });

  test("an unverifiable fromlist reports once, next to what the call does load", () => {
    const fromlist = '__import__("shop.infrastructure", fromlist=names)\n';
    expect(unverifiable(fromlist).map((m) => m.split(" through")[0])).toEqual([
      'Layer "domain" imports "shop.infrastructure" from outer layer "infrastructure"',
      "unverifiable",
    ]);
  });
});

test("a literal **{...} is read exactly", () => {
  const src =
    'import importlib\nimportlib.import_module(".infrastructure.db", **{"package": "shop"})\n';
  expect(found(src)).toEqual([["INW011", "shop.infrastructure.db"]]);
});

test("[tool.inwards.rules] severity re-levels an unverifiable report", async () => {
  const config = parseConfig(`[tool.inwards]
layers = [
  { name = "domain", modules = ["shop.domain"] },
  { name = "infrastructure", modules = ["shop.infrastructure"] },
]
[tool.inwards.rules]
severity = { INW011 = "warning" }
`);
  const engine = await Engine.create(grammars(), config);
  const src = "import importlib\nimportlib.import_module(name)\n";
  const reported = engine.checkFile(file("shop/domain/order.py", src), PROJECT);
  expect(reported.map((d) => [d.code, d.severity])).toEqual([["INW011", "warning"]]);
});
