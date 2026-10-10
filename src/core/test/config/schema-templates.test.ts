/**
 * @file Paired negative cases for templates, their rules (#298) and sibling layers (#97) in the
 * `[tool.inwards]` JSON Schema, kept beside `schema-negatives.test.ts`. Each
 * structural mistake fails both the schema and the parser. Each relation only
 * the expansion can see fails the parser alone.
 */
import { describe, expect, test } from "bun:test";
import { optionKeys } from "../../src/config/rule-options.ts";
import { RULES } from "../../src/meta/registry.ts";
import {
  MINIMAL,
  parserError,
  type Schema,
  schema,
  schemaErrors,
} from "../support/config-schema.ts";

/**
 * Follows a `$ref` (also one wrapped in `allOf`) to its definition.
 *
 * @param node - a schema node.
 * @returns the definition it points to, or the node itself.
 */
function deref(node: Schema): Schema {
  const ref = node.$ref ?? node.allOf?.find((part) => part.$ref !== undefined)?.$ref;
  const name = ref?.split("/").at(-1);
  return name === undefined ? node : (schema.definitions?.[name] ?? node);
}

/**
 * Builds a config from the minimal one plus extra TOML.
 *
 * @param extra - keys or tables to add.
 * @returns the config text.
 */
function withExtra(extra: string): string {
  return `${MINIMAL}${extra}`;
}

/**
 * Builds a config whose only layer entry is the given TOML value.
 *
 * @param layer - the entry, an inline table or a nested array.
 * @returns the config text.
 */
function withLayer(layer: string): string {
  return `[tool.inwards]\nlayers = [${layer}]\n`;
}

describe("template mistakes fail both the schema and the parser", () => {
  test.each([
    ["templates that aren't a table", withExtra('templates = ["t"]\n')],
    ["a template that isn't a table", withExtra("templates = { t = 1 }\n")],
    ["a blank template name", withExtra('[tool.inwards.templates." "]\nroles = ["a"]\n')],
    ["an unknown template key", withExtra('[tool.inwards.templates.t]\nrole = ["a"]\n')],
    ["empty roles", withExtra("[tool.inwards.templates.t]\nroles = []\n")],
    ["a role that isn't a list", withExtra('[tool.inwards.templates.t]\nroles = "a"\n')],
    ["a malformed role", withExtra('[tool.inwards.templates.t]\nroles = ["b |"]\n')],
    ["a wildcard role", withExtra('[tool.inwards.templates.t]\nroles = ["*"]\n')],
    [
      "a wildcard template public entry",
      withExtra('[tool.inwards.templates.t]\npublic = ["a.*"]\n'),
    ],
    ["a bad template member pattern", withExtra('[tool.inwards.templates.t]\nallow = ["a/b"]\n')],
    ["an unknown template extra", withExtra('[tool.inwards.templates.t]\nextra = "fatal"\n')],
    ["an empty template hint", withExtra('[tool.inwards.templates.t]\nhints = [""]\n')],
    [
      "shape hints that aren't a list",
      withExtra('[[tool.inwards.shape]]\npackages = ["shop"]\nhints = "x"\n'),
    ],
    [
      "a template name that isn't a string",
      withLayer('{ name = "d", modules = ["shop"], template = 1 }'),
    ],
    ["a sibling group of one", withLayer('[{ name = "a", modules = ["a"] }]')],
    [
      "a sibling with a template",
      `${withLayer('[{ name = "a", modules = ["a"] }, { name = "b", modules = ["b"], template = "t" }]')}[tool.inwards.templates.t]\nroles = ["x"]\n`,
    ],
    ["a sibling without modules", withLayer('[{ name = "a", modules = ["a"] }, { name = "b" }]')],
  ])("%s", (_what, text) => {
    expect(parserError(text)).toBeDefined();
    expect(schemaErrors(text)).not.toEqual([]);
  });

  test("templates, their uses and sibling layers pass both", () => {
    const text = `[tool.inwards]
layers = [
  [{ name = "a", modules = ["shop.a"] }, { name = "b", modules = ["shop.b"] }],
  { name = "d", modules = ["shop.*"], template = "t" },
]

[tool.inwards.templates.t]
roles = ["constants", "models | schemas", "api.v1 | api.v2", "service"]
public = ["service", "api.v1"]
allow = ["utils"]
require = ["__init__", "service"]
forbid = ["helpers"]
extra = "warning"
hints = ["Shared code goes in shop/common.py."]

[[tool.inwards.shape]]
packages = ["shop.*"]
template = "t"
hints = ["One more hint."]

[[tool.inwards.contexts]]
name = "orders"
modules = ["shop.orders"]
template = "t"
`;
    expect([parserError(text), schemaErrors(text)]).toEqual([undefined, []]);
  });
});

describe("relations only the expansion shows fail the parser only", () => {
  test.each([
    [
      "a template no table declares",
      withLayer('{ name = "d", modules = ["shop"], template = "t" }'),
    ],
    ["a role listed twice", withExtra('[tool.inwards.templates.t]\nroles = ["a | b", "b"]\n')],
    [
      "a layer template without roles",
      `${withLayer('{ name = "d", modules = ["shop"], template = "t" }')}[tool.inwards.templates.t]\npublic = ["api"]\n`,
    ],
    [
      "a context template without public",
      withExtra(
        '[tool.inwards.templates.t]\nroles = ["a"]\n[[tool.inwards.contexts]]\nname = "c"\nmodules = ["shop.c"]\ntemplate = "t"\n',
      ),
    ],
    [
      "a role layer named like another layer",
      `${withLayer('{ name = "d.a", modules = ["x"] }, { name = "d", modules = ["shop"], template = "t" }')}[tool.inwards.templates.t]\nroles = ["a"]\n`,
    ],
  ])("%s", (_what, text) => {
    expect(parserError(text)).toBeDefined();
    expect(schemaErrors(text)).toEqual([]);
  });
});

/**
 * Builds a config whose one layer entry uses template `t`, with roles
 * `models` and `router`, and the given `rules` table body.
 *
 * @param rules - the body of `[tool.inwards.templates.t.rules]`.
 * @returns the config text.
 */
function withRules(rules: string): string {
  return `${withLayer('{ name = "d", modules = ["shop.*"], template = "t" }')}[tool.inwards.templates.t]\nroles = ["models", "router"]\n\n[tool.inwards.templates.t.rules]\n${rules}\n`;
}

/**
 * Names the options a template fills for a rule, which its table may not set.
 *
 * @param name - the rule's name.
 * @returns `modules`, and `role` for INW015.
 */
function filled(name: string): string[] {
  return name === "construct-only-in" ? ["modules", "role"] : ["modules"];
}

describe("template rules (#298)", () => {
  test("agree with the parser on the rules a template can name and their keys", () => {
    const template = schema.properties?.["templates"]?.additionalProperties;
    const rules = deref(typeof template === "object" ? template : {});
    const roles = deref(rules.properties?.["rules"] ?? {}).additionalProperties;
    const byRule = (typeof roles === "object" ? roles : {}).properties ?? {};
    const optIn = Object.values(RULES)
      .filter((rule) => rule.default === "off")
      .map((rule) => rule.name);
    expect(Object.keys(byRule).sort()).toEqual([...optIn].sort());
    // A rule's own options table, with modules refused by a propertyNames clause.
    const noModules = '{"type":"object","propertyNames":{"not":{"const":"modules"}}}';
    const keys = optIn.map((name) => {
      const table = (byRule[name]?.anyOf ?? []).at(-1) ?? {};
      const refused = JSON.stringify(table.allOf ?? []).includes(noModules) ? ["modules"] : [];
      const allowed = Object.keys(deref(table).properties ?? {});
      return [name, allowed.filter((key) => !refused.includes(key)).sort()];
    });
    expect(keys).toEqual(
      optIn.map((name) => [
        name,
        [...optionKeys(name)].filter((key) => !filled(name).includes(key)).sort(),
      ]),
    );
  });

  test.each([
    [
      "rules that aren't a table",
      withRules("").replace("[tool.inwards.templates.t.rules]\n", 'rules = ["x"]\n'),
    ],
    ["a role that isn't a table", withRules('router = "async-blocking"')],
    ["a role key that isn't a module name", withRules('"a b" = { async-blocking = true }')],
    ["an unknown rule", withRules("router = { async-blocking-io = true }")],
    ["a rule code", withRules("router = { INW013 = true }")],
    ["a rule that is on by default", withRules("router = { layer-dependency = true }")],
    ["false", withRules("router = { async-blocking = false }")],
    ["an unknown severity", withRules('router = { async-blocking = "fatal" }')],
    ["modules in a template table", withRules('router = { async-blocking = { modules = ["x"] } }')],
    [
      "INW015's role in a template table",
      withRules('router = { construct-only-in = { role = ["x"] } }'),
    ],
    [
      "an option another rule owns",
      withRules("router = { async-blocking = { max-statements = 3 } }"),
    ],
    ["a bad option value", withRules("router = { thin-endpoint = { max-statements = -1 } }")],
  ])("%s fails both", (_what, text) => {
    expect(parserError(text)).toBeDefined();
    expect(schemaErrors(text)).not.toEqual([]);
  });

  test.each([
    ["a role the template doesn't list", withRules("service = { async-blocking = true }")],
    [
      "rules in a template without roles",
      `${MINIMAL}[tool.inwards.templates.t]\nrules = { router = { async-blocking = true } }\n`,
    ],
    [
      "rules in a template no layer entry uses",
      `${MINIMAL}[tool.inwards.templates.t]\nroles = ["router"]\nrules = { router = { async-blocking = true } }\n`,
    ],
    [
      "two roles that disagree on an option",
      withRules(
        "router = { thin-endpoint = { max-statements = 3 } }\nmodels = { thin-endpoint = { max-statements = 4 } }",
      ),
    ],
  ])("%s fails the parser only", (_what, text) => {
    expect(parserError(text)).toBeDefined();
    expect(schemaErrors(text)).toEqual([]);
  });

  test("true, a severity and options tables pass both", () => {
    const text =
      withRules(`router = { async-blocking = true, thin-endpoint = { max-statements = 8 }, construct-only-in = { allowed-in = ["shop.main"] } }
models = { orm-naming = "warning", ports-abstract = {} }`);
    expect([parserError(text), schemaErrors(text)]).toEqual([undefined, []]);
  });
});
