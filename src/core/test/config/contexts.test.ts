/**
 * @file `[[tool.inwards.contexts]]` (#51): the table parses into plain data with
 * every list filled in, and each invalid form is a config error naming the
 * indexed key. Ownership is by longest literal prefix, so a `public` entry
 * another context owns more specifically is rejected.
 */
import { describe, expect, test } from "bun:test";
import { isPublicModule, privateParentOf } from "../../src/config/index.ts";
import { ConfigError, parseConfig } from "../../src/index.ts";

/** A valid `[tool.inwards]` head the context tables are appended to. */
const HEAD = `[tool.inwards]
layers = [{ name = "domain", modules = ["shop"] }]
`;

/**
 * Parses a config made of the valid head and some context tables.
 *
 * @param tables - TOML for `[[tool.inwards.contexts]]` entries, or other keys.
 * @returns the parsed contexts, undefined when there are none.
 */
function contexts(tables: string): ReturnType<typeof parseConfig>["contexts"] {
  return parseConfig(`${HEAD}${tables}`).contexts;
}

/**
 * Parses a config that must fail and returns its message.
 *
 * @param tables - TOML appended to the valid head.
 * @returns the config error's message.
 * @throws {Error} when the config parses, or fails with something other than a ConfigError.
 */
function error(tables: string): string {
  try {
    parseConfig(`${HEAD}${tables}`);
  } catch (err) {
    if (err instanceof ConfigError) {
      return err.message;
    }
    throw err;
  }
  throw new Error("expected a config error");
}

const TWO = `
[[tool.inwards.contexts]]
name = "orders"
modules = ["shop.orders"]
public = ["shop.orders.api"]
depends-on = ["billing"]

[[tool.inwards.contexts]]
name = "billing"
modules = ["shop.billing"]
`;

describe("parsing", () => {
  test("a full table becomes plain data with every list filled in", () => {
    expect(contexts(TWO)).toEqual([
      {
        name: "orders",
        modules: ["shop.orders"],
        public: ["shop.orders.api"],
        dependsOn: ["billing"],
      },
      { name: "billing", modules: ["shop.billing"], public: [], dependsOn: [] },
    ]);
  });

  test("no table and an empty list mean the same", () => {
    expect(contexts("")).toBeUndefined();
    expect(contexts("contexts = []\n")).toBeUndefined();
  });

  test("depends-on may name a context declared later", () => {
    expect(contexts(TWO)?.[0]?.dependsOn).toEqual(["billing"]);
  });

  test("names are case-sensitive, so Orders and orders are two contexts", () => {
    const parsed = contexts(`
[[tool.inwards.contexts]]
name = "orders"
modules = ["shop.orders"]

[[tool.inwards.contexts]]
name = "Orders"
modules = ["shop.legacy_orders"]
`);
    expect(parsed?.map((c) => c.name)).toEqual(["orders", "Orders"]);
  });
});

describe("errors name the indexed key", () => {
  test("a value that isn't an array of tables", () => {
    expect(error('contexts = "orders"\n')).toContain("tool.inwards.contexts must be an array");
  });

  test("an element that isn't a table, by its index", () => {
    expect(error('contexts = [{ name = "a", modules = ["shop.a"] }, 3]\n')).toContain(
      "tool.inwards.contexts[1] must be a table",
    );
  });

  test("an unknown key", () => {
    expect(
      error('[[tool.inwards.contexts]]\nname = "a"\nmodules = ["shop.a"]\nexports = []\n'),
    ).toContain("tool.inwards.contexts[0].exports");
  });

  test("a blank or missing name", () => {
    expect(error('[[tool.inwards.contexts]]\nname = " "\nmodules = ["shop.a"]\n')).toContain(
      "tool.inwards.contexts[0].name",
    );
    expect(error('[[tool.inwards.contexts]]\nmodules = ["shop.a"]\n')).toContain(
      "tool.inwards.contexts[0].name",
    );
  });

  test("a repeated name", () => {
    const message = error(
      '[[tool.inwards.contexts]]\nname = "a"\nmodules = ["shop.a"]\n[[tool.inwards.contexts]]\nname = "a"\nmodules = ["shop.b"]\n',
    );
    expect(message).toContain("tool.inwards.contexts[1].name");
    expect(message).toContain("tool.inwards.contexts[0]");
  });

  test("missing, empty or malformed modules", () => {
    expect(error('[[tool.inwards.contexts]]\nname = "a"\n')).toContain(
      "tool.inwards.contexts[0].modules",
    );
    expect(error('[[tool.inwards.contexts]]\nname = "a"\nmodules = []\n')).toContain(
      "tool.inwards.contexts[0].modules",
    );
    expect(error('[[tool.inwards.contexts]]\nname = "a"\nmodules = ["shop..a"]\n')).toContain(
      "tool.inwards.contexts[0].modules[0]",
    );
  });

  test("a wildcard, until glob selectors arrive (#191)", () => {
    expect(error('[[tool.inwards.contexts]]\nname = "a"\nmodules = ["shop.*"]\n')).toContain(
      "not wildcards",
    );
  });

  test("the same prefix in two contexts", () => {
    const message = error(
      '[[tool.inwards.contexts]]\nname = "a"\nmodules = ["shop.x"]\n[[tool.inwards.contexts]]\nname = "b"\nmodules = ["shop.y", "shop.x"]\n',
    );
    expect(message).toContain("tool.inwards.contexts[1].modules[1]");
    expect(message).toContain('"a" and "b"');
  });

  test("depends-on naming the context itself, an unknown context, or one twice", () => {
    const base = '[[tool.inwards.contexts]]\nname = "a"\nmodules = ["shop.a"]\n';
    const other = '[[tool.inwards.contexts]]\nname = "b"\nmodules = ["shop.b"]\n';
    expect(error(`${base}depends-on = ["a"]\n`)).toContain(
      "tool.inwards.contexts[0].depends-on[0]",
    );
    expect(error(`${base}depends-on = ["c"]\n${other}`)).toContain(
      "tool.inwards.contexts[0].depends-on[0]",
    );
    expect(error(`${base}depends-on = ["b", "b"]\n${other}`)).toContain(
      "tool.inwards.contexts[0].depends-on[1]",
    );
  });
});

describe("public entries belong to their own context", () => {
  test("an entry outside the context is rejected", () => {
    const message = error(
      '[[tool.inwards.contexts]]\nname = "orders"\nmodules = ["shop.orders"]\npublic = ["shop.billing.api"]\n',
    );
    expect(message).toContain("tool.inwards.contexts[0].public[0]");
    expect(message).toContain("no context owns it");
  });

  test("public entries are absolute, so a bare api is the top-level module", () => {
    expect(
      error(
        '[[tool.inwards.contexts]]\nname = "orders"\nmodules = ["shop.orders"]\npublic = ["api"]\n',
      ),
    ).toContain("tool.inwards.contexts[0].public[0]");
  });

  test("an exact entry with = is kept, and its ownership is checked without the =", () => {
    const parsed = contexts(
      '[[tool.inwards.contexts]]\nname = "orders"\nmodules = ["shop.orders"]\npublic = ["=shop.orders", "shop.orders.api"]\n',
    );
    expect(parsed?.[0]?.public).toEqual(["=shop.orders", "shop.orders.api"]);
    expect(
      error(
        '[[tool.inwards.contexts]]\nname = "orders"\nmodules = ["shop.orders"]\npublic = ["=shop.billing"]\n',
      ),
    ).toContain("tool.inwards.contexts[0].public[0]");
  });

  test("an = with no dotted name after it is rejected", () => {
    for (const bad of ["=", "=shop.*", "==shop.orders"]) {
      expect(
        error(
          `[[tool.inwards.contexts]]\nname = "orders"\nmodules = ["shop.orders"]\npublic = ["${bad}"]\n`,
        ),
      ).toContain("tool.inwards.contexts[0].public[0]");
    }
  });

  test("an entry another context owns more specifically is rejected", () => {
    const message = error(`
[[tool.inwards.contexts]]
name = "orders"
modules = ["shop.orders"]
public = ["shop.orders.api.internal"]

[[tool.inwards.contexts]]
name = "special"
modules = ["shop.orders.api"]
`);
    expect(message).toContain("tool.inwards.contexts[0].public[0]");
    expect(message).toContain('context "special" owns it');
  });

  test("a nested context owns its prefix; the outer one keeps the rest", () => {
    const parsed = contexts(`
[[tool.inwards.contexts]]
name = "orders"
modules = ["shop.orders"]
public = ["shop.orders.api"]

[[tool.inwards.contexts]]
name = "special"
modules = ["shop.orders.api.internal"]
`);
    expect(parsed?.map((c) => c.name)).toEqual(["orders", "special"]);
  });
});

describe("public-by-name opens every module without a _ segment (#331)", () => {
  const BY_NAME = `
[[tool.inwards.contexts]]
name = "catalog"
modules = ["qv.catalog", "qv.catalog_jobs"]
public = ["=qv.catalog._registry"]
public-by-name = true

[[tool.inwards.contexts]]
name = "special"
modules = ["qv.catalog.special"]
`;

  test("true is kept, false and absent leave the key out", () => {
    expect(contexts(BY_NAME)?.[0]?.publicByName).toBe(true);
    const off = contexts(
      '[[tool.inwards.contexts]]\nname = "a"\nmodules = ["shop.a"]\npublic-by-name = false\n',
    );
    expect(off?.[0]).toEqual({ name: "a", modules: ["shop.a"], public: [], dependsOn: [] });
  });

  test("a value that isn't a boolean names the key", () => {
    expect(
      error('[[tool.inwards.contexts]]\nname = "a"\nmodules = ["shop.a"]\npublic-by-name = "yes"\n'),
    ).toContain("tool.inwards.contexts[0].public-by-name must be true or false");
  });

  test("the facade, plain modules and dunders are public; a _ segment below the prefix is not", () => {
    const [catalog] = contexts(BY_NAME) ?? [];
    if (catalog === undefined) {
      throw new Error("expected a context");
    }
    const open = (module: string): boolean => isPublicModule(catalog, module);
    expect(
      ["qv.catalog", "qv.catalog.router", "qv.catalog.sub.models", "qv.catalog.__main__"].map(open),
    ).toEqual([true, true, true, true]);
    expect(["qv.catalog_jobs", "qv.catalog_jobs.run"].map(open)).toEqual([true, true]);
    expect(
      ["qv.catalog._impl", "qv.catalog.sub._impl", "qv.catalog._sub.mod"].map(open),
    ).toEqual([false, false, false]);
    expect(open("qv.catalog._registry")).toBe(true);
    expect(open("qv.catalog._registry.inner")).toBe(false);
    expect(open("qv.other")).toBe(false);
  });

  test("the prefix itself never counts as private", () => {
    const [core] =
      contexts(
        '[[tool.inwards.contexts]]\nname = "core"\nmodules = ["app._core"]\npublic-by-name = true\n',
      ) ?? [];
    if (core === undefined) {
      throw new Error("expected a context");
    }
    expect([isPublicModule(core, "app._core"), isPublicModule(core, "app._core.api")]).toEqual([
      true,
      true,
    ]);
    expect(privateParentOf(core, "app._core.api._x.y")).toBe("app._core.api");
  });

  test("without the key, nothing is public by name", () => {
    const [orders] = contexts(TWO) ?? [];
    if (orders === undefined) {
      throw new Error("expected a context");
    }
    expect([isPublicModule(orders, "shop.orders"), isPublicModule(orders, "shop.orders.models")]).toEqual(
      [false, false],
    );
  });
});
