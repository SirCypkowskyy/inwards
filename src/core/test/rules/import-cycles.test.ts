/**
 * @file INW004 import-cycles through the engine. A whole-project check
 * reports one cycle per strongly connected component, with its full path, on
 * the import that makes the first step; a check of some files reports none.
 * `cycles` picks modules, contexts, both or neither, and the default is
 * contexts only. An import the skeleton reads out of a string can't make a
 * cycle, since each reported step is confirmed with the full parse. An
 * inline suppression can't hide a cycle; the rule can be turned off.
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
const CONTEXTS = `
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
      "shop/domain/orders/a.py",
      "shop/domain/orders/b.py",
      "shop/domain/orders/c.py",
      "shop/domain/orders/d.py",
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
 * @param whole - false for a run over some files only.
 * @returns the INW004 findings.
 */
async function cycles(
  toml: string,
  files: Record<string, string>,
  whole = true,
): Promise<Diagnostic[]> {
  const engine = await Engine.create(grammars(), parseConfig(toml));
  const sources: SourceFile[] = Object.entries(files).map(([path, text]) => file(path, text));
  return engine
    .check(sources, PROJECT, undefined, { whole })
    .diagnostics.filter((d) => d.code === "INW004");
}

const MODULE_CYCLE = {
  "shop/domain/orders/order.py": "from shop.domain.orders.line import Line\n",
  "shop/domain/orders/line.py": "from shop.domain.orders.total import total\n",
  "shop/domain/orders/total.py": "import shop.domain.orders.order\n",
};

describe("module cycles", () => {
  test("one cycle, reported once with its path, on the first step's import", async () => {
    const found = await cycles(`${LAYERS}cycles = ["modules"]\n`, MODULE_CYCLE);
    expect(found.map((d) => [d.file, d.line, d.message])).toEqual([
      [
        "shop/domain/orders/line.py",
        1,
        "Modules import each other in a cycle: shop.domain.orders.line -> shop.domain.orders.total -> shop.domain.orders.order -> shop.domain.orders.line. The group holds 3 modules and 3 links between them.",
      ],
    ]);
    expect(found[0]?.fix.steps[0]).toContain(
      "`import shop.domain.orders.order` in shop.domain.orders.total",
    );
  });

  test("a check of some files, or the default mode without contexts, reports none", async () => {
    expect(await cycles(`${LAYERS}cycles = ["modules"]\n`, MODULE_CYCLE, false)).toEqual([]);
    expect(await cycles(LAYERS, MODULE_CYCLE)).toEqual([]);
    expect(await cycles(`${LAYERS}cycles = []\n`, MODULE_CYCLE)).toEqual([]);
  });

  test("an import the skeleton reads out of a string makes no cycle", async () => {
    const files = {
      "shop/domain/orders/order.py": "from shop.domain.orders.line import Line\n",
      "shop/domain/orders/line.py": 'NOTE = """\nimport shop.domain.orders.order\n"""\n',
    };
    expect(await cycles(`${LAYERS}cycles = ["modules"]\n`, files)).toEqual([]);
  });

  test("an inline suppression can't hide a cycle, and the rules table can", async () => {
    const hidden = {
      ...MODULE_CYCLE,
      "shop/domain/orders/line.py":
        'from shop.domain.orders.total import total  # inwards: ignore[INW004] reason="x"\n',
    };
    expect(await cycles(`${LAYERS}cycles = ["modules"]\n`, hidden)).toHaveLength(1);
    const off = `${LAYERS}cycles = ["modules"]\n[tool.inwards.rules]\nignore = ["INW004"]\n`;
    expect(await cycles(off, MODULE_CYCLE)).toEqual([]);
  });
});

describe("context cycles", () => {
  const files = {
    "shop/app/orders/place.py": "from shop.domain.billing.invoice import Invoice\n",
    "shop/app/billing/charge.py": "from shop.domain.orders.order import Order\n",
    "shop/domain/orders/order.py": "X = 1\n",
    "shop/domain/billing/invoice.py": "Y = 1\n",
  };

  test("contexts that import each other are a cycle, even when depends-on allows both ways", async () => {
    const found = await cycles(`${LAYERS}${CONTEXTS}`, files);
    expect(found.map((d) => [d.file, d.message])).toEqual([
      [
        "shop/app/billing/charge.py",
        "Contexts import each other in a cycle: billing -> orders -> billing. The group holds 2 contexts and 2 links between them.",
      ],
    ]);
    expect(found[0]?.fix.steps.at(-1)).toContain("Don't edit [tool.inwards] yourself.");
  });

  test("the modules behind it make no module cycle", async () => {
    expect(await cycles(`${LAYERS}cycles = ["modules"]\n${CONTEXTS}`, files)).toEqual([]);
  });

  test("both modes report both kinds", async () => {
    const both = {
      ...files,
      ...MODULE_CYCLE,
      "shop/domain/orders/order.py": MODULE_CYCLE["shop/domain/orders/order.py"],
    };
    const found = await cycles(`${LAYERS}cycles = ["modules", "contexts"]\n${CONTEXTS}`, both);
    expect(found.map((d) => d.message.split(":")[0])).toEqual([
      "Modules import each other in a cycle",
      "Contexts import each other in a cycle",
    ]);
  });
});

describe("what the report stands on", () => {
  const Modules = `${LAYERS}cycles = ["modules"]\n`;

  test("an import in a string can't join two groups into one", async () => {
    // Real: a <-> b, b -> c, c <-> d. The string in d only looks like an import of a.
    const files = {
      "shop/domain/orders/a.py": "import shop.domain.orders.b\n",
      "shop/domain/orders/b.py": "import shop.domain.orders.a\nimport shop.domain.orders.c\n",
      "shop/domain/orders/c.py": "import shop.domain.orders.d\n",
      "shop/domain/orders/d.py":
        'import shop.domain.orders.c\nNOTE = """\nimport shop.domain.orders.a\n"""\n',
    };
    const found = await cycles(Modules, files);
    expect(found.map((d) => d.message.split(":")[1]?.split(".")[0])).toHaveLength(2);
  });

  test("an import inside brackets a malformed file never closes makes no cycle", async () => {
    const files = {
      "shop/domain/orders/order.py": "items = (\nimport shop.domain.orders.line\n)\n",
      "shop/domain/orders/line.py": "import shop.domain.orders.order\n",
    };
    expect(await cycles(Modules, files)).toEqual([]);
  });

  test("a module and its stub are one node", async () => {
    const files = {
      "shop/domain/orders/order.py": "X = 1\n",
      "shop/domain/orders/order.pyi": "from shop.domain.orders.line import Line\n",
      "shop/domain/orders/line.py": "import shop.domain.orders.order\n",
    };
    expect(await cycles(Modules, files)).toHaveLength(1);
  });

  test("a group that grows gets a new message, so a baseline can't hide the new cycle", async () => {
    const two = {
      "shop/domain/orders/a.py": "import shop.domain.orders.b\n",
      "shop/domain/orders/b.py": "import shop.domain.orders.a\n",
    };
    const three = {
      ...two,
      "shop/domain/orders/b.py": "import shop.domain.orders.a\nimport shop.domain.orders.c\n",
      "shop/domain/orders/c.py": "import shop.domain.orders.b\n",
    };
    const [before] = await cycles(Modules, two);
    const [after] = await cycles(Modules, three);
    expect(before?.message).toContain("2 modules and 2 links");
    expect(after?.message).toContain("3 modules and 4 links");
    expect(after?.message).not.toBe(before?.message);
  });

  test("an inline suppression of INW004 is itself an INW009 error", async () => {
    const engine = await Engine.create(grammars(), parseConfig(Modules));
    const text = 'import shop.domain.orders.order  # inwards: ignore[INW004] reason="x"\n';
    const found = engine.check([file("shop/domain/orders/line.py", text)], PROJECT).diagnostics;
    expect(found.map((d) => [d.code, d.severity])).toContainEqual(["INW009", "error"]);
  });
});
