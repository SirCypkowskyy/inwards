/**
 * @file INW004 and imports under `if TYPE_CHECKING:` (#375). Such an import
 * never runs, so it makes no edge, for module and context cycles alike,
 * whether the check read the file through the skeleton or the full parse.
 * The `else` branch runs, and so does a negated or compound guard, so their
 * imports still close a cycle; so does a function-level import.
 */
import { describe, expect, test } from "bun:test";
import { type Diagnostic, Engine, parseConfig, type SourceFile } from "../../src/index.ts";
import { file, grammars, indexOn } from "../support/helpers.ts";

const LAYERS = `[tool.inwards]
layers = [
  { name = "domain", modules = ["shop.domain"] },
  { name = "app", modules = ["shop.app"] },
]
`;
const MODULES = `${LAYERS}cycles = ["modules"]\n`;
const BOTH = `${LAYERS}cycles = ["modules", "contexts"]

[[tool.inwards.contexts]]
name = "orders"
modules = ["shop.domain.orders", "shop.app.orders"]
depends-on = ["billing"]

[[tool.inwards.contexts]]
name = "billing"
modules = ["shop.domain.billing", "shop.app.billing"]
depends-on = ["orders"]
`;

const PROJECT = indexOn(
  new Map<string, "file" | "dir">(
    [
      "shop/domain/orders/order.py",
      "shop/domain/orders/line.py",
      "shop/domain/orders/total.py",
      "shop/domain/billing/invoice.py",
      "shop/app/orders/place.py",
      "shop/app/billing/charge.py",
    ].flatMap((path): [string, "file" | "dir"][] => {
      const parts = path.split("/");
      const dirs = parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join("/"));
      return [...dirs.map((dir): [string, "dir"] => [dir, "dir"]), [path, "file"]];
    }),
  ),
);

/**
 * Checks files as a whole-project run under a config.
 *
 * @param toml - the `[tool.inwards]` text.
 * @param files - the files, by path.
 * @returns the INW004 findings.
 */
async function cycles(toml: string, files: Record<string, string>): Promise<Diagnostic[]> {
  const engine = await Engine.create(grammars(), parseConfig(toml));
  const sources: SourceFile[] = Object.entries(files).map(([path, text]) => file(path, text));
  return engine
    .check(sources, PROJECT, undefined, { whole: true })
    .diagnostics.filter((d) => d.code === "INW004");
}

/**
 * Builds a three-module cycle whose last step, `total` back to `order`, sits under a guard.
 *
 * @param guard - the code after the imports of `total.py`, holding the import of `order`.
 * @returns the three files.
 */
function closedBy(guard: string): Record<string, string> {
  return {
    "shop/domain/orders/order.py": "from shop.domain.orders.line import Line\n",
    "shop/domain/orders/line.py": "from shop.domain.orders.total import total\n",
    "shop/domain/orders/total.py": `import typing\nfrom typing import TYPE_CHECKING\n\n${guard}`,
  };
}

/**
 * Counts the cycles of each guard's project.
 *
 * @param guards - the guards to try, one project each.
 * @returns each guard with its number of INW004 findings.
 */
async function countEach(guards: readonly string[]): Promise<[string, number][]> {
  const found = await Promise.all(guards.map((guard) => cycles(MODULES, closedBy(guard))));
  return guards.map((guard, i) => [guard, found[i]?.length ?? -1]);
}

describe("module cycles", () => {
  test("a cycle closed only through a type-only import is no cycle", async () => {
    const guards = [
      "if TYPE_CHECKING:\n    import shop.domain.orders.order\n",
      "if typing.TYPE_CHECKING:\n    from shop.domain.orders.order import Order\n",
      "if x:\n    pass\nelif TYPE_CHECKING:\n    import shop.domain.orders.order\n",
      "if TYPE_CHECKING:\n    try:\n        import shop.domain.orders.order\n    except ImportError:\n        pass\n",
      // The prescan refuses `x = 1; import os`, so the check itself parses the file in full.
      "x = 1; import os\nif TYPE_CHECKING:\n    import shop.domain.orders.order\n",
    ];
    expect(await countEach(guards)).toEqual(guards.map((guard) => [guard, 0]));
  });

  test("the same import at runtime, in an else branch or under a negated guard, is a cycle", async () => {
    const guards = [
      "import shop.domain.orders.order\n",
      "if TYPE_CHECKING:\n    pass\nelse:\n    import shop.domain.orders.order\n",
      "if not TYPE_CHECKING:\n    import shop.domain.orders.order\n",
      "if TYPE_CHECKING or DEBUG:\n    import shop.domain.orders.order\n",
      "def f():\n    import shop.domain.orders.order\n",
    ];
    expect(await countEach(guards)).toEqual(guards.map((guard) => [guard, 1]));
  });
});

describe("context cycles", () => {
  const files = {
    "shop/app/orders/place.py": "from shop.domain.billing.invoice import Invoice\n",
    "shop/app/billing/charge.py":
      "from typing import TYPE_CHECKING\n\nif TYPE_CHECKING:\n    from shop.domain.orders.order import Order\n",
    "shop/domain/orders/order.py": "X = 1\n",
    "shop/domain/billing/invoice.py": "Y = 1\n",
  };

  test("a context cycle closed only through a type-only import is no cycle", async () => {
    expect(await cycles(BOTH, files)).toEqual([]);
  });

  test("the same import at runtime closes it", async () => {
    const runtime = {
      ...files,
      "shop/app/billing/charge.py": "from shop.domain.orders.order import Order\n",
    };
    const found = await cycles(BOTH, runtime);
    expect(found.map((d) => d.message.split(":")[0])).toEqual([
      "Contexts import each other in a cycle",
    ]);
  });
});
