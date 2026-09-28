/**
 * @file INW011 on the routes to a loader and the loading APIs added in #79: walrus,
 * tuple and chained assignment, class and instance attributes,
 * `functools.partial`, names bound inside `exec`, builtins reached through an
 * object, `pkgutil.resolve_name`, `find_spec` and the file loaders. Each route
 * also passes the loader hint, so the engine parses the file in full.
 */
import { describe, expect, test } from "bun:test";
import { mentionsDynamicImport } from "../../../src/rules/dynamic-import/imports.ts";
import { found, unverifiable } from "../../support/helpers.ts";

const EXACT: [string, string][] = [["INW011", "shop.infrastructure.db"]];

describe("INW011: loaders reached through bindings", () => {
  test.each([
    ["walrus", 'import importlib\n(im := importlib.import_module)("shop.infrastructure.db")\n'],
    [
      "walrus, then the name",
      'import importlib\nif (im := importlib.import_module):\n    im("shop.infrastructure.db")\n',
    ],
    [
      "tuple assignment",
      'import importlib\nim, _ = importlib.import_module, None\nim("shop.infrastructure.db")\n',
    ],
    [
      "starred assignment",
      'import importlib\n*_, im = 1, 2, importlib.import_module\nim("shop.infrastructure.db")\n',
    ],
    [
      "nested tuple assignment",
      'import importlib\na, (im, b) = 1, (importlib.import_module, 2)\nim("shop.infrastructure.db")\n',
    ],
    [
      "chained assignment",
      'import importlib\na = im = importlib.import_module\nim("shop.infrastructure.db")\n',
    ],
    [
      "class attribute",
      'import importlib\nclass L:\n    load = importlib.import_module\nL.load("shop.infrastructure.db")\n',
    ],
    [
      "class attribute through self",
      'class L:\n    run = exec\n    def f(self):\n        self.run("import shop.infrastructure.db")\n',
    ],
    [
      "instance attribute",
      [
        "import importlib",
        "class L:",
        "    def __init__(self):",
        "        self.load = importlib.import_module",
        "    def get(self):",
        '        return self.load("shop.infrastructure.db")',
        "",
      ].join("\n"),
    ],
    [
      "functools.partial with the target bound",
      'import functools, importlib\nfunctools.partial(importlib.import_module, "shop.infrastructure.db")()\n',
    ],
    [
      "partial of exec",
      'from functools import partial\npartial(exec, "import shop.infrastructure.db")()\n',
    ],
    [
      "partial with a keyword",
      'import functools, importlib\nfunctools.partial(importlib.import_module, name="shop.infrastructure.db")\n',
    ],
    [
      "partial with nothing bound, called later",
      'from functools import partial\nimport importlib\nload = partial(importlib.import_module)\nload("shop.infrastructure.db")\n',
    ],
    [
      "a loader imported inside exec",
      'exec("from importlib import import_module as im")\nim("shop.infrastructure.db")\n',
    ],
    [
      "a loader assigned inside exec",
      'exec("import importlib; load = importlib.import_module")\nload("shop.infrastructure.db")\n',
    ],
    ["print.__self__", 'print.__self__.exec("import shop.infrastructure.db")\n'],
    ["getattr of __self__", 'getattr(len.__self__, "exec")("import shop.infrastructure.db")\n'],
    [
      "a function's __globals__",
      '(lambda: 0).__globals__["__builtins__"]["exec"]("import shop.infrastructure.db")\n',
    ],
    [
      "sys.modules",
      'import sys\nsys.modules["importlib"].import_module("shop.infrastructure.db")\n',
    ],
    [
      "globals()",
      'import importlib\nglobals()["importlib"].import_module("shop.infrastructure.db")\n',
    ],
  ])("%s", (_, src) => {
    expect(mentionsDynamicImport(src)).toBe(true);
    expect(found(src)).toEqual(EXACT);
  });

  test.each([
    ["walrus", "import importlib\n(im := importlib.import_module)(name)\n"],
    ["partial of exec", "from functools import partial\npartial(exec, code)()\n"],
    [
      "partial with only the package bound",
      'import functools, importlib\nfunctools.partial(importlib.import_module, package="shop")\n',
    ],
    [
      "class attribute",
      "import importlib\nclass L:\n    load = importlib.import_module\nL.load(n)\n",
    ],
  ])("a computed target through a %s is unverifiable", (_, src) => {
    expect(unverifiable(src)).toEqual(["unverifiable"]);
  });

  test.each([
    [
      "an attribute that holds no loader",
      "import json\nclass L:\n    load = json.loads\nL.load(s)\n",
    ],
    [
      "a partial of another function",
      "import functools\ndef eval(m):\n    pass\nfunctools.partial(print, 1)()\neval(model)\n",
    ],
    ["a tuple with too few values", "import importlib\na, b = importlib.import_module\na(x)\n"],
  ])("not a loader: %s", (_, src) => {
    expect(found(src)).toEqual([]);
  });
});

describe("INW011: other loading APIs", () => {
  test.each([
    [
      "pkgutil.resolve_name",
      'import pkgutil\npkgutil.resolve_name("shop.infrastructure.db:Repo")\n',
    ],
    [
      "resolve_name without a colon",
      'from pkgutil import resolve_name\nresolve_name("shop.infrastructure.db")\n',
    ],
    [
      "find_spec with module_from_spec and exec_module",
      [
        "import importlib.util",
        'spec = importlib.util.find_spec("shop.infrastructure.db")',
        "mod = importlib.util.module_from_spec(spec)",
        "spec.loader.exec_module(mod)",
        "",
      ].join("\n"),
    ],
    [
      "relative find_spec",
      'from importlib.util import find_spec\nfind_spec(".db", "shop.infrastructure")\n',
    ],
    [
      "SourceFileLoader(...).load_module()",
      'from importlib.machinery import SourceFileLoader\nSourceFileLoader("db", "shop/infrastructure/db.py").load_module()\n',
    ],
    [
      "SourceFileLoader(...).exec_module()",
      'import importlib.machinery\nimportlib.machinery.SourceFileLoader("x", path="./shop/infrastructure/db.py").exec_module(m)\n',
    ],
    [
      "spec_from_file_location",
      'import importlib.util\nimportlib.util.spec_from_file_location("db", "shop/infrastructure/db.py")\n',
    ],
  ])("%s", (_, src) => {
    expect(mentionsDynamicImport(src)).toBe(true);
    expect(found(src)).toEqual(EXACT);
  });

  test.each([
    ["resolve_name(variable)", "import pkgutil\npkgutil.resolve_name(spec)\n"],
    ["find_spec(variable)", "import importlib.util\nimportlib.util.find_spec(name)\n"],
    [
      "SourceFileLoader with a computed path",
      'from importlib.machinery import SourceFileLoader\nSourceFileLoader("db", path).load_module()\n',
    ],
    [
      "SourceFileLoader with an absolute path",
      'from importlib.machinery import SourceFileLoader\nSourceFileLoader("db", "/srv/shop/infrastructure/db.py").load_module()\n',
    ],
    [
      "spec_from_file_location with a parent path",
      'import importlib.util\nimportlib.util.spec_from_file_location("db", "../shop/infrastructure/db.py")\n',
    ],
  ])("%s is unverifiable", (_, src) => {
    expect(unverifiable(src)).toEqual(["unverifiable"]);
  });
});
