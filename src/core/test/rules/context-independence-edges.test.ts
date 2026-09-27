/**
 * @file INW002 at its edges, one test per way the rule could be subtly wrong.
 * An imported name is judged by the module it lives in, and a name with no
 * module by its own spelling. Declarations are neither inherited by a nested
 * context nor passed along a chain. A file in a context but in no layer gets
 * dynamic imports, the confirming parse, INW000 and suppressions like any
 * other. Star, TYPE_CHECKING and climbing relative imports behave, and one
 * unassigned package gets one warning whatever owns its files.
 */
import { describe, expect, test } from "bun:test";
import { CONTEXT_PROJECT, type ContextFixture, contextFixture } from "../support/contexts.ts";
import { file } from "../support/helpers.ts";

const PLACE = "shop/orders/app/place.py";
const API = "shop/shipping/api.py";

describe("what an import is judged by", () => {
  test("an imported name counts as the module it lives in, not its spelling", async () => {
    // A context whose prefix spells a name inside billing's module, not a module of its own.
    const { across }: ContextFixture = await contextFixture({
      toml: '\n[[tool.inwards.contexts]]\nname = "refunds"\nmodules = ["shop.billing.app.charge.refund"]\n',
    });
    expect(across(PLACE, "from shop.billing.app.charge import refund\n")).toEqual([]);
  });

  test("a name with no module on disk is judged by its spelling", async () => {
    const { check }: ContextFixture = await contextFixture();
    const codes = check(PLACE, "import shop.shipping.gone\n").map((d) => d.code);
    expect(codes).toContain("INW002");
  });
});

describe("declarations stay where they are written", () => {
  test("a nested context doesn't inherit its parent's depends-on", async () => {
    const { across }: ContextFixture = await contextFixture({
      dependsOn: { billing: ["shipping"] },
    });
    expect(across("shop/billing/app/charge.py", "import shop.shipping.app.ship\n")).toEqual([]);
    expect(across("shop/billing/tax/rates.py", "import shop.shipping.app.ship\n")).toHaveLength(1);
  });

  test("a dependency isn't passed along a chain", async () => {
    const { across }: ContextFixture = await contextFixture({
      dependsOn: { billing: ["shipping"] },
    });
    expect(across(PLACE, "from shop.billing.app import charge\n")).toEqual([]);
    expect(across(PLACE, "import shop.shipping.app.ship\n")).toHaveLength(1);
  });
});

describe("a file in a context but in no layer", () => {
  test("gets its dynamic imports checked", async () => {
    const { across }: ContextFixture = await contextFixture();
    const text = 'import importlib\nimportlib.import_module("shop.orders.app.place")\n';
    expect(across(API, text).map(([line]) => line)).toEqual([2]);
  });

  test("is confirmed by the full parse: an import inside a string isn't one", async () => {
    const { across }: ContextFixture = await contextFixture();
    expect(across(API, 'x = """\nimport shop.orders.app.place\n"""\n')).toEqual([]);
  });

  test("gets INW000 for an encoding that can hide imports", async () => {
    const { check }: ContextFixture = await contextFixture();
    const codes = check(API, "# coding: utf-7\nimport shop.orders.app.place\n").map((d) => d.code);
    expect(codes).toEqual(["INW000"]);
  });

  test("can suppress an import with a reason", async () => {
    const { check }: ContextFixture = await contextFixture();
    const text = 'import shop.orders.app.place  # inwards: ignore[INW002] reason="#9"\n';
    expect(check(API, text).map((d) => d.code)).toEqual(["INW006"]);
  });
});

describe("import forms", () => {
  test("a star import and one behind TYPE_CHECKING are reported", async () => {
    const { across }: ContextFixture = await contextFixture();
    const text = [
      "from typing import TYPE_CHECKING",
      "from shop.shipping.app.ship import *",
      "if TYPE_CHECKING:",
      "    from shop.shipping.domain import parcel",
      "",
    ].join("\n");
    expect(across(PLACE, text).map(([line]) => line)).toEqual([2, 4]);
  });

  test("a relative import that climbs above the top-level package isn't INW002", async () => {
    const { check }: ContextFixture = await contextFixture();
    const codes = check(PLACE, "from ..... import x\n").map((d) => d.code);
    expect(codes).not.toContain("INW002");
  });
});

test("one unassigned package gets one warning, whatever owns its files", async () => {
  const { engine }: ContextFixture = await contextFixture({
    toml: '\n[[tool.inwards.contexts]]\nname = "cli"\nmodules = ["shop.tools.cli"]\n',
  });
  const found = engine.checkFiles(
    [file("shop/tools/util.py", "x = 1\n"), file("shop/tools/cli/main.py", "x = 1\n")],
    CONTEXT_PROJECT,
  );
  expect(found.filter((d) => d.code === "INW006")).toHaveLength(1);
});
