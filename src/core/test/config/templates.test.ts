/**
 * @file `[tool.inwards.templates]` and the `template` key (#97, ADR-036): a
 * layer entry expands into one layer per role, siblings share a rank, a shape
 * entry takes the template's member keys and a context its public modules.
 * Every expansion must equal the hand-written config, and every mistake must
 * be a config error that names the key.
 */
import { describe, expect, test } from "bun:test";
import { ConfigError, parseConfig } from "../../src/index.ts";

const TEMPLATE = `
[tool.inwards.templates.domain]
roles = ["constants", "models | schemas", "service", "router"]
public = ["service", "schemas"]
allow = ["utils"]
require = ["__init__", "service"]
forbid = ["helpers"]
extra = "warning"
hints = ["Shared code goes in src/common.py."]
`;

/**
 * Builds a config with the given layers and the test template.
 *
 * @param layers - the inline value of `layers`.
 * @param rest - more TOML after the template.
 * @returns the pyproject text.
 */
function config(layers: string, rest = ""): string {
  return `[tool.inwards]\nlayers = ${layers}\n${TEMPLATE}${rest}`;
}

/**
 * Parses a config and returns the error message it throws.
 *
 * @param text - the pyproject text.
 * @returns the ConfigError's message, or "no error".
 */
function errorOf(text: string): string {
  try {
    parseConfig(text);
  } catch (err) {
    return err instanceof ConfigError ? err.message : `not a ConfigError: ${String(err)}`;
  }
  return "no error";
}

describe("a layer entry with a template", () => {
  test("becomes one layer per role inside its modules, siblings sharing a rank", () => {
    const parsed = parseConfig(
      config(
        '[{ name = "core", modules = ["src.core"] }, { name = "d", modules = ["src.*", "lib"], template = "domain", deny-libraries = ["os"] }, { name = "app", modules = ["src.main"] }]',
      ),
    );
    const libs = { denyLibraries: ["os"] };
    expect(parsed.layers).toEqual([
      { name: "core", modules: ["src.core"], rank: 0 },
      { name: "d.constants", modules: ["src.*.constants", "lib.constants"], ...libs, rank: 1 },
      { name: "d.models", modules: ["src.*.models", "lib.models"], ...libs, rank: 2 },
      { name: "d.schemas", modules: ["src.*.schemas", "lib.schemas"], ...libs, rank: 2 },
      { name: "d.service", modules: ["src.*.service", "lib.service"], ...libs, rank: 3 },
      { name: "d.router", modules: ["src.*.router", "lib.router"], ...libs, rank: 4 },
      { name: "app", modules: ["src.main"], rank: 5 },
    ]);
  });

  test("equals the hand-written layers, with nested arrays for siblings", () => {
    const hand = `[tool.inwards]
layers = [
  { name = "d.constants", modules = ["src.*.constants"] },
  [
    { name = "d.models", modules = ["src.*.models"] },
    { name = "d.schemas", modules = ["src.*.schemas"] },
  ],
  { name = "d.service", modules = ["src.*.service"] },
  { name = "d.router", modules = ["src.*.router"] },
]
`;
    const templated = parseConfig(
      config('[{ name = "d", modules = ["src.*"], template = "domain" }]'),
    );
    expect(templated).toEqual(parseConfig(hand));
  });

  test("leaves ranks out when no role has siblings", () => {
    const parsed = parseConfig(
      '[tool.inwards]\nlayers = [{ name = "d", modules = ["shop"], template = "t" }]\n[tool.inwards.templates.t]\nroles = ["domain", "api"]\n',
    );
    expect(parsed.layers).toEqual([
      { name: "d.domain", modules: ["shop.domain"] },
      { name: "d.api", modules: ["shop.api"] },
    ]);
  });

  test("a template nobody uses is fine", () => {
    expect(parseConfig(config('[{ name = "d", modules = ["shop"] }]')).layers).toEqual([
      { name: "d", modules: ["shop"] },
    ]);
  });
});

describe("a shape entry with a template", () => {
  test("takes the template's keys, with the roles added to allow", () => {
    const parsed = parseConfig(
      config(
        '[{ name = "d", modules = ["src"] }]',
        '[[tool.inwards.shape]]\npackages = ["src.*"]\ntemplate = "domain"\n',
      ),
    );
    expect(parsed.shape).toEqual([
      {
        packages: ["src.*"],
        allow: ["utils", "constants", "models", "schemas", "service", "router"],
        require: ["__init__", "service"],
        forbid: ["helpers"],
        extra: "warning",
        hints: ["Shared code goes in src/common.py."],
      },
    ]);
  });

  test("keeps the keys it sets itself", () => {
    const parsed = parseConfig(
      config(
        '[{ name = "d", modules = ["src"] }]',
        '[[tool.inwards.shape]]\npackages = ["src.*"]\ntemplate = "domain"\nallow = []\nextra = "error"\n',
      ),
    );
    expect(parsed.shape?.[0]).toMatchObject({ allow: [], extra: "error", forbid: ["helpers"] });
  });

  test("adds only a role's first segment to allow", () => {
    const parsed = parseConfig(
      '[tool.inwards]\nlayers = [{ name = "d", modules = ["src"] }]\n[tool.inwards.templates.t]\nroles = ["api.v1", "api.v2 | web"]\nallow = []\n[[tool.inwards.shape]]\npackages = ["src.*"]\ntemplate = "t"\n',
    );
    expect(parsed.shape?.[0]?.allow).toEqual(["api", "web"]);
  });
});

describe("a context with a template", () => {
  test("gets the template's public modules under each of its prefixes", () => {
    const parsed = parseConfig(
      config(
        '[{ name = "d", modules = ["src"] }]',
        '[[tool.inwards.contexts]]\nname = "orders"\nmodules = ["src.orders", "src.legacy_orders"]\npublic = ["src.orders.api", "src.orders.service"]\ntemplate = "domain"\n',
      ),
    );
    expect(parsed.contexts).toEqual([
      {
        name: "orders",
        modules: ["src.orders", "src.legacy_orders"],
        public: [
          "src.orders.api",
          "src.orders.service",
          "src.orders.schemas",
          "src.legacy_orders.service",
          "src.legacy_orders.schemas",
        ],
        dependsOn: [],
      },
    ]);
  });
});

describe("mistakes are config errors that name the key", () => {
  const layer = '[{ name = "d", modules = ["src.*"], template = "domain" }]';
  test.each([
    [
      "an unknown template",
      '[tool.inwards]\nlayers = [{ name = "d", modules = ["src"], template = "nope" }]\n',
      'tool.inwards.layers[0].template: no template is named "nope", and none is declared.',
    ],
    [
      "an unknown template among others",
      config('[{ name = "d", modules = ["src"], template = "nope" }]'),
      'no template is named "nope". Templates: "domain".',
    ],
    [
      "a template name that isn't a string",
      config('[{ name = "d", modules = ["src"], template = 1 }]'),
      "tool.inwards.layers[0].template must be the name of a template.",
    ],
    [
      "templates that aren't a table",
      '[tool.inwards]\nlayers = [{ name = "d", modules = ["src"] }]\ntemplates = ["a"]\n',
      "tool.inwards.templates must be a table of templates",
    ],
    [
      "a template that isn't a table",
      '[tool.inwards]\nlayers = [{ name = "d", modules = ["src"] }]\ntemplates = { a = 1 }\n',
      "tool.inwards.templates.a must be a table.",
    ],
    [
      "a blank template name",
      '[tool.inwards]\nlayers = [{ name = "d", modules = ["src"] }]\n[tool.inwards.templates." "]\nroles = ["a"]\n',
      "tool.inwards.templates has a template with a blank name.",
    ],
    [
      "an unknown template key",
      '[tool.inwards]\nlayers = [{ name = "d", modules = ["src"] }]\n[tool.inwards.templates.t]\nrole = ["a"]\n',
      "Unknown key tool.inwards.templates.t.role.",
    ],
    [
      "empty roles",
      '[tool.inwards]\nlayers = [{ name = "d", modules = ["src"] }]\n[tool.inwards.templates.t]\nroles = []\n',
      "tool.inwards.templates.t.roles must be a non-empty list of roles",
    ],
    [
      "a role that isn't a module name",
      '[tool.inwards]\nlayers = [{ name = "d", modules = ["src"] }]\n[tool.inwards.templates.t]\nroles = ["a", "b |"]\n',
      "tool.inwards.templates.t.roles[1] must be a module name relative to the layer",
    ],
    [
      "a wildcard role",
      '[tool.inwards]\nlayers = [{ name = "d", modules = ["src"] }]\n[tool.inwards.templates.t]\nroles = ["*"]\n',
      "tool.inwards.templates.t.roles[0] must be a module name relative to the layer",
    ],
    [
      "a repeated role",
      '[tool.inwards]\nlayers = [{ name = "d", modules = ["src"] }]\n[tool.inwards.templates.t]\nroles = ["a | b", "b"]\n',
      'tool.inwards.templates.t.roles[1]: role "b" is already listed.',
    ],
    [
      "a public entry that isn't a module name",
      '[tool.inwards]\nlayers = [{ name = "d", modules = ["src"] }]\n[tool.inwards.templates.t]\npublic = ["a.*"]\n',
      "tool.inwards.templates.t.public[0] must be a module name relative to the context",
    ],
    [
      "a bad member pattern",
      '[tool.inwards]\nlayers = [{ name = "d", modules = ["src"] }]\n[tool.inwards.templates.t]\nallow = ["a/b"]\n',
      'tool.inwards.templates.t.allow: "a/b" is not a member pattern.',
    ],
    [
      "an unknown extra",
      '[tool.inwards]\nlayers = [{ name = "d", modules = ["src"] }]\n[tool.inwards.templates.t]\nextra = "fatal"\n',
      'tool.inwards.templates.t.extra must be "error" or "warning".',
    ],
    [
      "an empty hint",
      '[tool.inwards]\nlayers = [{ name = "d", modules = ["src"] }]\n[tool.inwards.templates.t]\nhints = [""]\n',
      "tool.inwards.templates.t.hints must be a list of non-empty strings.",
    ],
    [
      "a layer template without roles",
      '[tool.inwards]\nlayers = [{ name = "d", modules = ["src"], template = "t" }]\n[tool.inwards.templates.t]\npublic = ["api"]\n',
      "tool.inwards.layers[0].template: the template has no roles",
    ],
    [
      "a layer template with no modules to put the roles in",
      config('[{ name = "d", modules = [], template = "domain" }]'),
      "tool.inwards.layers[0].modules must name at least one package",
    ],
    [
      "a role layer named like another layer",
      config(`[{ name = "d.service", modules = ["x"] }, ${layer.slice(1, -1)}]`),
      'Layer "d.service" is declared twice.',
    ],
    [
      "a role layer entry that another layer lists",
      config(`[{ name = "x", modules = ["src.*.router"] }, ${layer.slice(1, -1)}]`),
      '"src.*.router" is in two layers, "x" and "d.router".',
    ],
    [
      "a sibling group of one",
      '[tool.inwards]\nlayers = [[{ name = "a", modules = ["a"] }]]\n',
      "tool.inwards.layers[0] must be a single layer, or two or more independent sibling layers",
    ],
    [
      "a sibling with a template",
      config(
        '[[{ name = "a", modules = ["a"] }, { name = "d", modules = ["src"], template = "domain" }]]',
      ),
      "tool.inwards.layers[0][1].template: a layer with a template can't be a sibling",
    ],
    [
      "a bad sibling",
      '[tool.inwards]\nlayers = [[{ name = "a", modules = ["a"] }, { name = "", modules = ["b"] }]]\n',
      "tool.inwards.layers[0][1].name must be a non-empty string.",
    ],
    [
      "a shape template that doesn't exist",
      config(
        '[{ name = "d", modules = ["src"] }]',
        '[[tool.inwards.shape]]\npackages = ["src.*"]\ntemplate = "nope"\n',
      ),
      'tool.inwards.shape[0].template: no template is named "nope".',
    ],
    [
      "a context template without public",
      '[tool.inwards]\nlayers = [{ name = "d", modules = ["src"] }]\n[tool.inwards.templates.t]\nroles = ["a"]\n[[tool.inwards.contexts]]\nname = "c"\nmodules = ["src.c"]\ntemplate = "t"\n',
      "tool.inwards.contexts[0].template: the template has no public list",
    ],
    [
      "a context's own public list that isn't a list",
      config(
        '[{ name = "d", modules = ["src"] }]',
        '[[tool.inwards.contexts]]\nname = "c"\nmodules = ["src.c"]\npublic = "src.c.api"\ntemplate = "domain"\n',
      ),
      "tool.inwards.contexts[0].public must be a list of module names.",
    ],
  ])("%s", (_what, text, message) => {
    expect(errorOf(text)).toContain(message);
  });
});
