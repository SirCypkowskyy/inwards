/**
 * @file The rules under layer selectors (#191, ADR-034): the fix steps of
 * INW001, INW005 and both INW011 paths name the importing module's own
 * slice, and INW006 needs evidence before a package counts as holding a
 * selector's layer. The session checks (dead selectors, emptied slices,
 * moves out of every layer) are covered at the end.
 */
import { describe, expect, test } from "bun:test";
import {
  type Diagnostic,
  Engine,
  type InwardsConfig,
  type ProjectIndex,
  parseConfig,
  type SourceFile,
} from "../../src/index.ts";
import { indexEvidence } from "../../src/rules/unassigned-module/imports.ts";
import { checkMoves, checkPrefixes } from "../../src/rules/unassigned-module/layout.ts";
import { file, grammars, indexOn } from "../support/helpers.ts";

const TEXT = `[tool.inwards]
layers = [
  { name = "domain", modules = ["shop.*.domain"], deny-libraries = ["requests"] },
  { name = "infrastructure", modules = ["shop.*.infra"] },
]
`;
const DEEP_TEXT = `[tool.inwards]
layers = [
  { name = "domain", modules = ["shop.**.domain"] },
  { name = "infrastructure", modules = ["shop.*.infra"] },
]
`;
const CONFIG: InwardsConfig = parseConfig(TEXT);
const DEEP: InwardsConfig = parseConfig(DEEP_TEXT);
const PYPROJECT: { path: string; text: string } = { path: "pyproject.toml", text: TEXT };

/** What the test project holds on disk. */
const DISK: ReadonlyMap<string, "file" | "dir"> = new Map([
  ["shop", "dir"],
  ["shop/__init__.py", "file"],
  ["shop/util.py", "file"],
  ["shop/orders", "dir"],
  ["shop/orders/domain", "dir"],
  ["shop/orders/domain/__init__.py", "file"],
  ["shop/orders/domain/order.py", "file"],
  ["shop/orders/infra", "dir"],
  ["shop/orders/infra/db.py", "file"],
  ["shop/orders/core", "dir"],
  ["shop/orders/core/order.py", "file"],
  ["shop/billing", "dir"],
  ["shop/billing/domain.py", "file"],
  ["shop/billing/infra", "dir"],
  ["shop/billing/infra/db.py", "file"],
]);

const engine: Engine = await Engine.create(grammars(), CONFIG);
const deep: Engine = await Engine.create(grammars(), DEEP);
const PROJECT: ProjectIndex = indexOn(DISK);
/** The paths of the slices' layer packages, to drop them from the disk. */
const SLICE_PATH = /domain|infra/u;

/**
 * Checks one file against the selector config and the test project.
 *
 * @param src - the file.
 * @param with_ - the engine to use, the `shop.*.domain` one by default.
 * @returns its diagnostics.
 */
function check(src: SourceFile, with_: Engine = engine): Diagnostic[] {
  return with_.checkFile(src, indexOn(DISK));
}

describe("fix steps name the importing module's own slice", () => {
  test("INW001 names the slice's package, and suggests .ports under it", () => {
    const [d] = check(file("shop/orders/domain/order.py", "from shop.orders.infra import db\n"));
    expect(d?.code).toBe("INW001");
    expect(d?.fix.steps[1]).toContain(
      "in `shop.orders.domain` (for example `shop.orders.domain.ports`)",
    );
    expect(JSON.stringify(d?.fix)).not.toContain("*");
  });

  test("INW001 from a single-file member invents no module beneath it", () => {
    const [d] = check(file("shop/billing/domain.py", "from shop.billing.infra import db\n"));
    expect(d?.code).toBe("INW001");
    expect(d?.fix.steps[1]).toContain("Declare a typing.Protocol in `shop.billing.domain` that");
    expect(JSON.stringify(d?.fix)).not.toContain("domain.ports");
  });

  test("INW005 names the slice, not another one", () => {
    const [d] = check(file("shop/billing/domain.py", "import requests\n"));
    expect(d?.code).toBe("INW005");
    expect(JSON.stringify(d?.fix)).toContain("`shop.billing.domain` that");
    expect(JSON.stringify(d?.fix)).not.toContain("shop.orders");
  });

  test("INW011 on a readable dynamic import names the slice", () => {
    const src = 'import importlib\nimportlib.import_module("shop.orders.infra.db")\n';
    const [d] = check(file("shop/orders/domain/order.py", src));
    expect(d?.code).toBe("INW011");
    expect(JSON.stringify(d?.fix)).toContain("`shop.orders.domain.ports`");
  });

  test("INW011 on an unreadable dynamic import names the slice", () => {
    const src = "import importlib\nimportlib.import_module(name)\n";
    const [d] = check(file("shop/billing/domain.py", src));
    expect(d?.code).toBe("INW011");
    expect(d?.fix.steps[2]).toBe(
      "Type that parameter against a typing.Protocol declared in `shop.billing.domain`.",
    );
  });
});

describe("INW006 under selectors", () => {
  test("a wildcard ancestor doesn't exempt an ordinary module", () => {
    const [d] = check(file("shop/util.py", ""));
    expect(d).toMatchObject({ code: "INW006", severity: "warning" });
    expect(d?.message).toContain('"shop.util" belongs to no layer');
  });

  test("shop.**.domain doesn't exempt a sibling of a matching slice", () => {
    const [d] = check(file("shop/orders/core/order.py", ""), deep);
    expect(d?.message).toContain('"shop.orders.core" belongs to no layer');
  });

  test("a package with a matching module below it holds the layer", () => {
    expect(check(file("shop/__init__.py", ""))).toEqual([]);
  });

  test("without such a module, it doesn't", () => {
    const empty = new Map([...DISK].filter(([path]) => !SLICE_PATH.test(path)));
    const [d] = engine.checkFile(file("shop/__init__.py", ""), indexOn(empty));
    expect(d?.message).toContain('"shop" belongs to no layer');
  });

  test("importing a genuine container package stays an error", () => {
    const [d] = check(file("shop/orders/domain/order.py", "from shop import VERSION\n"));
    expect(d).toMatchObject({ code: "INW006", severity: "error" });
    expect(d?.message).toContain("the package above the layers");
  });

  test("importing an unassigned module next to the slices is an error", () => {
    const [d] = check(file("shop/orders/domain/order.py", "from shop.orders.core import order\n"));
    expect(d).toMatchObject({ code: "INW006", severity: "error" });
    expect(d?.message).toContain('"shop.orders.core"');
  });

  test("the evidence search lists only the directories the selector allows", () => {
    const listed: string[] = [];
    const spy = engine.index({
      kind: (rel: string): "file" | "dir" | undefined => DISK.get(rel),
      list: (): string[] => {
        throw new Error("the evidence search must not list the whole tree");
      },
      read: (): string => "",
      listDir: (rel: string): ReturnType<ProjectIndex["listDir"]> => {
        listed.push(rel);
        return PROJECT.listDir(rel);
      },
    });
    expect(indexEvidence(spy)("shop", "shop.*.infra")).toBe(true);
    expect(indexEvidence(spy)("shop.orders.core", "shop.*.infra")).toBe(false);
    expect(listed).toEqual(["shop", "shop/orders", "shop/orders/infra"]);
  });
});

describe("session checks under selectors", () => {
  const before = new Set([
    "shop",
    "shop.orders.domain",
    "shop.orders.domain.order",
    "shop.billing.domain",
    "shop.orders.infra.db",
    "shop.billing.infra.db",
  ]);

  test("a slice emptied while another keeps the selector alive is an error", () => {
    const now = new Set([...before].filter((m) => !m.startsWith("shop.orders.domain")));
    const found = checkPrefixes(CONFIG, now, PYPROJECT, before);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ severity: "error", line: 3 });
    expect(found[0]?.message).toBe(
      '"shop.orders.domain" (matched by "shop.*.domain", layer "domain") held modules when the session started and holds none now.',
    );
  });

  test("a dead selector is reported once, at its text, not per slice", () => {
    const now = new Set([...before].filter((m) => !m.includes("domain")));
    const found = checkPrefixes(CONFIG, now, PYPROJECT, before);
    expect(found.map((d) => d.message)).toEqual([
      '"shop.*.domain" (layer "domain") matched modules when the session started and matches none now.',
    ]);
    expect(found[0]?.column).toBe((TEXT.split("\n")[2] ?? "").indexOf('"shop.*.domain"') + 1);
  });

  test("without a session, a selector that matches nothing is a dead layer", () => {
    const found = checkPrefixes(CONFIG, new Set(["shop.orders.infra.db"]), PYPROJECT);
    expect(found.map((d) => d.message)).toEqual([
      '"shop.*.domain" (layer "domain") matches no module, so layer "domain" is empty.',
    ]);
  });

  test("routine edits under shop.** empty no slice (R1 to R4)", () => {
    const text = `[tool.inwards]
layers = [
  { name = "domain", modules = ["shop.*.domain"] },
  { name = "infrastructure", modules = ["shop.**"] },
]
`;
    const config = parseConfig(text);
    const start = new Set([...before, "shop.orders.helpers", "shop.orders.infra.old"]);
    const pyproject = { path: "pyproject.toml", text };
    /**
     * Drops modules from the start set.
     *
     * @param gone - the modules deleted.
     * @returns the modules left.
     */
    function without(...gone: string[]): Set<string> {
      return new Set([...start].filter((m) => !gone.includes(m)));
    }
    // R1 rm shop/orders/infra/old.py; R2 rm shop/orders/helpers.py; R3 git mv old.py legacy.py.
    expect(checkPrefixes(config, without("shop.orders.infra.old"), pyproject, start)).toEqual([]);
    expect(checkPrefixes(config, without("shop.orders.helpers"), pyproject, start)).toEqual([]);
    const renamed = new Set([...without("shop.orders.infra.old"), "shop.orders.infra.legacy"]);
    expect(checkPrefixes(config, renamed, pyproject, start)).toEqual([]);
    // R4: shop.*.infra.* names the slice shop.orders.infra, not one slice per module.
    const r4 = parseConfig(text.replace('"shop.**"', '"shop.*.infra.*"'));
    expect(checkPrefixes(r4, without("shop.orders.infra.old"), pyproject, start)).toEqual([]);
  });

  test("layer code moved out of every layer is caught per module, at the selector", () => {
    const was = new Map([...before].map((m) => [m, `hash-${m}`]));
    const is = new Map([...was]);
    is.delete("shop.orders.domain.order");
    is.set("shop.orders.core.order", "hash-shop.orders.domain.order");
    const [d, ...rest] = checkMoves(CONFIG, was, is, PYPROJECT);
    expect(rest).toEqual([]);
    expect(d?.message).toBe(
      'shop.orders.core.order moved out of layer "domain" to outside every layer, where nothing checks it.',
    );
    expect(d?.line).toBe(3);
  });
});
