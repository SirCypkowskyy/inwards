import { describe, expect, test } from "bun:test";
import { parseConfig } from "../src/index.ts";
import { checkPrefixes } from "../src/unassigned.ts";
import { check, engine, file, OWNERS } from "./helpers.ts";

describe("INW006 unassigned-module", () => {
  test("a layer importing first-party code outside every layer is an error", () => {
    const [d, ...rest] = check(file("shop/domain/order.py", "from shop.persistence import repo\n"));
    expect(rest).toEqual([]);
    expect(d).toMatchObject({ code: "INW006", severity: "error", line: 1 });
    expect(d?.message).toContain('"shop.persistence"');
  });

  test("so is the same import inside a function (the full parse agrees with the prescan)", () => {
    const src = "def f():\n    import shop.persistence.repo\n";
    expect(check(file("shop/domain/order.py", src)).map((d) => d.code)).toEqual(["INW006"]);
  });

  test.each([
    ["third-party code", "import requests\n"],
    ["an inner layer", "from shop.domain import order\n"],
  ])("importing %s is fine", (_, src) => {
    expect(check(file("shop/application/place_order.py", src))).toEqual([]);
  });

  test.each([
    ["a name from the package above the layers", "from shop import VERSION\n"],
    ["that package itself", "import shop\n"],
    ["a star import from it", "from shop import *\n"],
    [
      "a dynamic import of unassigned code",
      'import importlib\nimportlib.import_module("shop.persistence.repo")\n',
    ],
  ])("importing %s is an error: nothing checks what it re-exports", (_, src) => {
    expect(check(file("shop/domain/order.py", src)).map((d) => d.code)).toContain("INW006");
  });

  test("a bare top-level directory is not first-party: it loses to the stdlib", () => {
    expect(check(file("shop/domain/order.py", "import logging\n"))).toEqual([]);
  });

  test("a file outside every layer gets one warning naming its package", () => {
    const [d, ...rest] = check(file("shop/persistence/repo.py", "import shop.infrastructure\n"));
    expect(rest).toEqual([]);
    expect(d).toMatchObject({ code: "INW006", severity: "warning" });
    expect(d?.message).toContain('"shop.persistence" belongs to no layer');
  });

  test.each([
    ["an ignored package", "scripts/seed.py"],
    ["a package that only holds layers", "shop/__init__.py"],
  ])("%s gets no warning", (_, path) => {
    expect(check(file(path, "import os\n"))).toEqual([]);
  });

  test("checkFiles warns once per package", () => {
    const files = [file("shop/persistence/a.py", ""), file("shop/persistence/b.py", "")];
    expect(engine.checkFiles(files, OWNERS)).toHaveLength(1);
  });
});

describe("INW006 layer prefixes", () => {
  const text = `[tool.inwards]
layers = [
  { name = "domain", modules = ["shop.domain", "shop.model"] },
  { name = "infra", modules = ["shop.infra"] },
]
`;
  const config = parseConfig(text);
  const pyproject = { path: "pyproject.toml", text };

  test("a dead prefix warns, and points at it; a layer with no live prefix is an error", () => {
    const found = checkPrefixes(config, new Set(["shop.domain.order"]), pyproject);
    expect(found.map((d) => [d.severity, d.line, d.column])).toEqual([
      ["warning", 3, 48],
      ["error", 4, 32],
    ]);
    expect(found[1]?.message).toContain('layer "infra" is empty');
  });

  test("a prefix that matched at session start and doesn't now is an error", () => {
    const before = new Set(["shop.domain.order", "shop.model.user", "shop.infra.db"]);
    const now = new Set(["shop.domain.order", "shop.core.user", "shop.infra.db"]);
    const [d, ...rest] = checkPrefixes(config, now, pyproject, before);
    expect(rest).toEqual([]);
    expect(d).toMatchObject({ severity: "error", file: "pyproject.toml" });
    expect(d?.message).toContain("matched modules when the session started");
  });
});
