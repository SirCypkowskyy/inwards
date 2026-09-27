/**
 * @file INW002 context-independence on three slices, `orders`, `billing` and
 * `shipping`, with a `tax` context nested in billing and a shared kernel that
 * belongs to no context. Orders may depend on billing; nothing else is
 * declared. A declared dependency is allowed, an undeclared or reverse one is
 * reported, a nested context needs its own declaration, and either end
 * outside every context is left alone. Relative, `from package import
 * module`, function-level and dynamic imports count; a file in a context but
 * in no layer is still checked; and INW001 and INW002 add up.
 */
import { describe, expect, test } from "bun:test";
import { Engine, parseConfig } from "../../src/index.ts";
import { CONTEXT_PROJECT, type ContextFixture, contextFixture } from "../support/contexts.ts";
import { file, grammars } from "../support/helpers.ts";

const { check, across }: ContextFixture = await contextFixture();

describe("declared and undeclared dependencies", () => {
  test("orders may import billing, which it declares", () => {
    expect(across("shop/orders/app/place.py", "from shop.billing.app import charge\n")).toEqual([]);
  });

  test("orders may not import shipping, which it doesn't declare", () => {
    expect(across("shop/orders/app/place.py", "from shop.shipping.app import ship\n")).toEqual([
      [
        1,
        'Context "orders" imports "shop.shipping.app.ship" from context "shipping", which it doesn\'t declare in depends-on.',
      ],
    ]);
  });

  test("a dependency isn't granted in return: billing may not import orders", () => {
    expect(across("shop/billing/app/charge.py", "import shop.orders.domain.order\n")).toHaveLength(
      1,
    );
  });

  test("a module in its own context is always fine", () => {
    expect(across("shop/orders/app/place.py", "from shop.orders.domain import order\n")).toEqual(
      [],
    );
  });

  test("either end outside every context is left alone", () => {
    expect(across("shop/shipping/app/ship.py", "from shop.shared import money\n")).toEqual([]);
    expect(across("shop/shared/money.py", "import shop.orders.domain.order\n")).toEqual([]);
    expect(across("shop/orders/app/place.py", "import json\nimport requests\n")).toEqual([]);
  });
});

describe("nested contexts", () => {
  test("depending on billing doesn't cover the tax context nested in it", () => {
    const found = across("shop/orders/app/place.py", "from shop.billing.tax import rates\n");
    expect(found.map(([, m]) => m)).toEqual([
      'Context "orders" imports "shop.billing.tax.rates" from context "tax", which it doesn\'t declare in depends-on.',
    ]);
  });

  test("a nested context uses only its own declarations", () => {
    expect(
      across("shop/billing/tax/rates.py", "from shop.billing.domain import invoice\n"),
    ).toHaveLength(1);
    expect(
      across("shop/billing/app/charge.py", "from shop.billing.tax import rates\n"),
    ).toHaveLength(1);
  });
});

describe("every way to import counts", () => {
  test("relative, package-member and function-level imports", () => {
    const text = [
      "from ...shipping.app import ship",
      "from shop import shipping",
      "def later():",
      "    import shop.shipping.domain.parcel",
      "",
    ].join("\n");
    expect(across("shop/orders/app/place.py", text).map(([line]) => line)).toEqual([1, 2, 4]);
  });

  test("a dynamic import", () => {
    const text = 'import importlib\nimportlib.import_module("shop.shipping.app.ship")\n';
    expect(across("shop/orders/app/place.py", text).map(([line]) => line)).toEqual([2]);
  });

  test("a file in a context but in no layer is checked too, and warned about", () => {
    const found = check("shop/shipping/api.py", "from shop.orders.app import place\n");
    expect(found.map((d) => [d.code, d.severity])).toEqual([
      ["INW006", "warning"],
      ["INW002", "error"],
    ]);
    expect(found[0]?.message).toBe(
      '"shop.shipping.api" belongs to no layer, so no layer rule checks its imports.',
    );
  });
});

describe("with the other rules", () => {
  test("an import that breaks a layer and a context boundary gets INW001 and INW002", () => {
    const codes = check("shop/orders/domain/order.py", "from shop.shipping.app import ship\n").map(
      (d) => d.code,
    );
    expect(codes).toEqual(["INW001", "INW002"]);
  });

  test("a reasoned suppression hides INW002", () => {
    const text =
      'from shop.shipping.app import ship  # inwards: ignore[INW002] reason="moving in #9"\n';
    expect(check("shop/orders/app/place.py", text)).toEqual([]);
  });

  test("without contexts, nothing is reported", async () => {
    const layersOnly = parseConfig(`[tool.inwards]
layers = [{ name = "all", modules = ["shop"] }]
`);
    const plain = await Engine.create(grammars(), layersOnly);
    const found = plain.checkFiles(
      [file("shop/orders/app/place.py", "from shop.shipping.app import ship\n")],
      CONTEXT_PROJECT,
    );
    expect(found.filter((d) => d.code === "INW002")).toEqual([]);
  });
});
