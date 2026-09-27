/**
 * @file INW003 public-api-only on the shared slices fixture, with billing's
 * public module set per test. Code outside a context, in another context or
 * in none, imports only modules at or under its `public` prefixes; the
 * context itself may import anything of its own; an import INW002 reports
 * gets no INW003 as well. The fix names the public module that exposes the
 * imported name, falls back to re-exporting, and asks the user when a
 * context has no public modules.
 */
import { describe, expect, test } from "bun:test";
import type { Diagnostic } from "../../src/index.ts";
import { type ContextFixture, contextFixture } from "../support/contexts.ts";

const PLACE = "shop/orders/app/place.py";
const OPEN = { public: { billing: ["shop.billing.domain", "shop.billing.api"] } };
/** Billing with one public module, so its domain is internal. */
const API_ONLY = { public: { billing: ["shop.billing.api"] } };

/**
 * Picks the codes of a file's findings.
 *
 * @param found - the diagnostics.
 * @returns their codes, in order.
 */
function codes(found: readonly Diagnostic[]): string[] {
  return found.map((d) => d.code);
}

describe("which imports stay inside the public modules", () => {
  test("a public module and anything under its prefix are fine", async () => {
    const { check }: ContextFixture = await contextFixture(OPEN);
    expect(check(PLACE, "from shop.billing.domain import invoice\n")).toEqual([]);
    expect(check(PLACE, "import shop.billing.domain.invoice\n")).toEqual([]);
    expect(check(PLACE, "import shop.billing.domain\n")).toEqual([]);
  });

  test("an internal module is reported, with the module it lands in", async () => {
    const { check }: ContextFixture = await contextFixture(OPEN);
    const [found] = check(PLACE, "from shop.billing.app.charge import refund\n");
    expect(found?.code).toBe("INW003");
    expect(found?.message).toBe(
      'Context "orders" imports "shop.billing.app.charge.refund" from context "billing", but "shop.billing.app.charge" isn\'t one of its public modules.',
    );
  });

  test("a caller in no context is held to the public modules too", async () => {
    const { check }: ContextFixture = await contextFixture(API_ONLY);
    const found = check("shop/shared/money.py", "import shop.billing.domain.invoice\n");
    expect(found.map((d) => d.code)).toEqual(["INW003"]);
    expect(found[0]?.message).toStartWith(
      '"shop.shared.money" imports "shop.billing.domain.invoice"',
    );
  });

  test("a context imports its own internals freely", async () => {
    const { check }: ContextFixture = await contextFixture(API_ONLY);
    expect(check("shop/billing/app/charge.py", "import shop.billing.domain.invoice\n")).toEqual([]);
  });

  test("an import INW002 reports gets no INW003 as well", async () => {
    const { check }: ContextFixture = await contextFixture(OPEN);
    expect(codes(check("shop/shipping/app/ship.py", "import shop.billing.app.charge\n"))).toEqual([
      "INW002",
    ]);
  });

  test("a nested context has public modules of its own", async () => {
    const { check }: ContextFixture = await contextFixture({
      ...OPEN,
      dependsOn: { orders: ["tax"] },
    });
    expect(codes(check(PLACE, "from shop.billing.tax import rates\n"))).toEqual(["INW003"]);
  });

  test("dynamic imports and files in a context but in no layer count", async () => {
    const { check }: ContextFixture = await contextFixture({
      ...OPEN,
      dependsOn: { shipping: ["billing"] },
    });
    const dynamic = 'import importlib\nimportlib.import_module("shop.billing.app.charge")\n';
    expect(codes(check(PLACE, dynamic))).toEqual(["INW003"]);
    expect(codes(check("shop/shipping/api.py", "import shop.billing.app.charge\n"))).toEqual([
      "INW006",
      "INW003",
    ]);
  });
});

describe("what else counts", () => {
  test("a caller outside every layer and every context is held to them too", async () => {
    const { check }: ContextFixture = await contextFixture(API_ONLY);
    const text =
      'import shop.billing.domain.invoice\nimport importlib\nimportlib.import_module("shop.billing.app.charge")\n';
    expect(codes(check("shop/main.py", text))).toEqual(["INW006", "INW003", "INW003"]);
  });

  test("with INW002 off, an undeclared dependency still gets INW003", async () => {
    const { check }: ContextFixture = await contextFixture({
      ...API_ONLY,
      toml: '\n[tool.inwards.rules]\nignore = ["INW002"]\n',
    });
    expect(
      codes(check("shop/shipping/app/ship.py", "import shop.billing.domain.invoice\n")),
    ).toEqual(["INW003"]);
  });

  test("a parent context's public prefix doesn't open a nested context", async () => {
    const { check }: ContextFixture = await contextFixture({
      public: { billing: ["shop.billing"] },
      dependsOn: { orders: ["tax"] },
    });
    expect(codes(check(PLACE, "from shop.billing.domain import invoice\n"))).toEqual([]);
    expect(codes(check(PLACE, "from shop.billing.tax import rates\n"))).toEqual(["INW003"]);
  });

  test("a name with no module on disk is judged by its spelling", async () => {
    const { check }: ContextFixture = await contextFixture({
      dependsOn: { orders: ["vendor"] },
      toml: '\n[[tool.inwards.contexts]]\nname = "vendor"\nmodules = ["plugins.vendor"]\n',
    });
    expect(codes(check(PLACE, "import plugins.vendor.sdk\n"))).toContain("INW003");
  });

  test("a dynamic import from a file in a context but in no layer", async () => {
    const { check }: ContextFixture = await contextFixture({
      ...API_ONLY,
      dependsOn: { shipping: ["billing"] },
    });
    const text = 'import importlib\nimportlib.import_module("shop.billing.domain.invoice")\n';
    expect(codes(check("shop/shipping/api.py", text))).toEqual(["INW006", "INW003"]);
  });
});

describe("the fix", () => {
  const texts = new Map([
    [
      "shop/billing/api.py",
      "from shop.billing.app.charge import refund\n\n\ndef total(order_id: int) -> int:\n    return 0\n\n\nRATE: float = 0.2\n",
    ],
  ]);

  test("names the public module that re-exports or defines the name", async () => {
    const { check }: ContextFixture = await contextFixture({ ...OPEN, texts });
    /**
     * The fix summary for one import from orders.
     *
     * @param text - the import statement.
     * @returns the first finding's fix summary.
     */
    function summary(text: string): string | undefined {
      return check(PLACE, text)[0]?.fix.summary;
    }
    expect(summary("from shop.billing.app.charge import refund\n")).toBe(
      'Import "refund" from "shop.billing.api", the public module of "billing" that exposes it.',
    );
    expect(check(PLACE, "from shop.billing.app.charge import refund\n")[0]?.fix.steps[0]).toBe(
      "Replace `from shop.billing.app.charge import refund` with `from shop.billing.api import refund`.",
    );
    expect(summary("from shop.billing.app.charge import total\n")).toContain('"shop.billing.api"');
    expect(summary("from shop.billing.app.charge import RATE\n")).toContain('"shop.billing.api"');
  });

  test("keeps an alias and the other names of the statement", async () => {
    const { check }: ContextFixture = await contextFixture({ ...OPEN, texts });
    for (const text of [
      "from shop.billing.app.charge import refund as credit\n",
      "from shop.billing.app.charge import refund, other\n",
    ]) {
      const [step] = check(PLACE, text)[0]?.fix.steps ?? [];
      expect(step).toContain("keeping its `as` name if it has one");
      expect(step).toStartWith("In `from shop.billing.app.charge import refund");
    }
  });

  test("lists the public modules when none exposes the name", async () => {
    const { check }: ContextFixture = await contextFixture({ ...OPEN, texts });
    const [found] = check(PLACE, "from shop.billing.app.charge import missing\n");
    expect(found?.fix.summary).toBe(
      'Go through a public module of "billing": `shop.billing.domain`, `shop.billing.api`.',
    );
    expect(found?.fix.steps[1]).toContain("re-export it from one");
  });

  test("asks the user when the context has no public modules", async () => {
    const { check }: ContextFixture = await contextFixture();
    const [found] = check(PLACE, "from shop.billing.app.charge import refund\n");
    expect(found?.fix.summary).toBe(
      '"billing" declares no public modules; ask the user which of its modules other code may import.',
    );
    expect(found?.fix.steps.at(-1)).toContain("Don't edit [tool.inwards] yourself.");
  });
});
