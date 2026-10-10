/**
 * @file `[tool.inwards.templates.<name>.rules]` (#298, from #98): a template
 * role turns opt-in rules on for the role's modules. Each expansion must parse
 * to the config a user could write by hand with `[tool.inwards.rules]`, merge
 * with that table as documented, and every mistake must be a config error that
 * names the key.
 */
import { describe, expect, test } from "bun:test";
import { ConfigError, parseConfig } from "../../src/index.ts";

const LAYERS = `[tool.inwards]
layers = [
  { name = "core", modules = ["src.core"] },
  { name = "d", modules = ["src.*", "lib"], template = "domain" },
]
`;

/**
 * Builds a config whose template has the given rules table.
 *
 * @param rules - the body of `[tool.inwards.templates.domain.rules]`.
 * @param rest - more TOML after it.
 * @returns the pyproject text.
 */
function config(rules: string, rest = ""): string {
  return `${LAYERS}
[tool.inwards.templates.domain]
roles = ["models", "service", "api.v1 | router"]

[tool.inwards.templates.domain.rules]
${rules}
${rest}`;
}

/**
 * Builds the hand-written equivalent: the same layers spelled out, and a rules table.
 *
 * @param rules - the `[tool.inwards.rules]` section, TOML.
 * @returns the pyproject text.
 */
function hand(rules: string): string {
  return `[tool.inwards]
layers = [
  { name = "core", modules = ["src.core"] },
  { name = "d.models", modules = ["src.*.models", "lib.models"] },
  { name = "d.service", modules = ["src.*.service", "lib.service"] },
  [
    { name = "d.api.v1", modules = ["src.*.api.v1", "lib.api.v1"] },
    { name = "d.router", modules = ["src.*.router", "lib.router"] },
  ],
]
${rules}`;
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

describe("a template's rules expand into [tool.inwards.rules]", () => {
  test("true turns the rule on for the role's modules in every entry that uses the template", () => {
    expect(parseConfig(config("router = { async-blocking = true }")).rules).toEqual({
      extendSelect: ["INW013"],
      options: { "async-blocking": { modules: ["src.*.router", "lib.router"] } },
    });
  });

  test("equals the hand-written selector form, options, severities and several roles included", () => {
    const templated =
      config(`router = { async-blocking = true, thin-endpoint = { max-statements = 8 } }
"api.v1" = { async-blocking = "warning" }
models = { orm-naming = { table-name = "snake" } }
service = { construct-only-in = { allowed-in = ["src.main"] } }`);
    const written = hand(`
[tool.inwards.rules]
extend-select = ["INW012", "INW013", "INW015", "INW016"]
severity = { INW013 = "warning" }

[tool.inwards.rules.async-blocking]
modules = ["src.*.router", "lib.router", "src.*.api.v1", "lib.api.v1"]

[tool.inwards.rules.thin-endpoint]
modules = ["src.*.router", "lib.router"]
max-statements = 8

[tool.inwards.rules.orm-naming]
modules = ["src.*.models", "lib.models"]
table-name = "snake"

[tool.inwards.rules.construct-only-in]
role = ["src.*.service", "lib.service"]
allowed-in = ["src.main"]
`);
    expect(parseConfig(templated)).toEqual(parseConfig(written));
  });

  test("INW015 gets the role's modules in role and keeps modules for the top-level table", () => {
    const parsed = parseConfig(
      config(
        "service = { construct-only-in = true }",
        '[tool.inwards.rules.construct-only-in]\nmodules = ["src"]\nrole = ["src.legacy"]\n',
      ),
    );
    expect(parsed.rules?.options?.["construct-only-in"]).toEqual({
      modules: ["src"],
      role: ["src.legacy", "src.*.service", "lib.service"],
    });
  });

  test("every entry that uses the template adds its modules, in layer order", () => {
    const text = `[tool.inwards]
layers = [
  { name = "a", modules = ["shop.a"], template = "t" },
  { name = "b", modules = ["shop.b", "shop.a"], template = "t" },
]

[tool.inwards.templates.t]
roles = ["router"]
rules = { router = { async-blocking = true } }
`;
    // Two entries can't own the same prefix, so this is a config error before
    // the rules expand; with distinct prefixes both entries contribute.
    expect(errorOf(text)).toContain('"shop.a.router" is in two layers');
    const fine = text.replace('"shop.b", "shop.a"', '"shop.b"');
    expect(parseConfig(fine).rules?.options?.["async-blocking"]?.["modules"]).toEqual([
      "shop.a.router",
      "shop.b.router",
    ]);
  });

  test("a template without rules leaves [tool.inwards.rules] exactly as written", () => {
    expect(parseConfig(config("")).rules).toBeUndefined();
  });
});

describe("merging with the top-level [tool.inwards.rules]", () => {
  test("modules: the top-level entries first, then the role's, without repeats", () => {
    const parsed = parseConfig(
      config(
        "router = { async-blocking = true }",
        '[tool.inwards.rules.async-blocking]\nmodules = ["src.workers", "lib.router"]\n',
      ),
    );
    expect(parsed.rules?.options?.["async-blocking"]?.["modules"]).toEqual([
      "src.workers",
      "lib.router",
      "src.*.router",
    ]);
  });

  test("a top-level option and severity win over the template's", () => {
    const parsed = parseConfig(
      config(
        'router = { thin-endpoint = { max-statements = 8, max-branches = 2 }, async-blocking = "warning" }',
        '[tool.inwards.rules]\nseverity = { INW013 = "error" }\n\n[tool.inwards.rules.thin-endpoint]\nmax-statements = 20\n',
      ),
    );
    expect(parsed.rules?.severity).toEqual({ INW013: "error" });
    expect(parsed.rules?.options?.["thin-endpoint"]).toEqual({
      "max-branches": 2,
      "max-statements": 20,
      modules: ["src.*.router", "lib.router"],
    });
  });

  test("select and extend-select keep their codes, and the template's are added once", () => {
    const parsed = parseConfig(
      config(
        "router = { async-blocking = true, thin-endpoint = true }",
        '[tool.inwards.rules]\nselect = ["INW001"]\nextend-select = ["INW013", "FAPI001"]\n',
      ),
    );
    expect(parsed.rules?.select).toEqual(["INW001"]);
    expect(parsed.rules?.extendSelect).toEqual(["INW013", "FAPI001", "INW012"]);
  });

  test("ignore still wins: the rule stays off", () => {
    const parsed = parseConfig(
      config("router = { async-blocking = true }", '[tool.inwards.rules]\nignore = ["INW013"]\n'),
    );
    expect(parsed.rules?.ignore).toEqual(["INW013"]);
    expect(parsed.rules?.extendSelect).toEqual(["INW013"]);
  });

  test("a top-level value settles two roles that disagree", () => {
    const parsed = parseConfig(
      config(
        'router = { async-blocking = "error", thin-endpoint = { max-statements = 8 } }\n"api.v1" = { async-blocking = "warning", thin-endpoint = { max-statements = 3 } }',
        '[tool.inwards.rules]\nseverity = { INW013 = "warning" }\n\n[tool.inwards.rules.thin-endpoint]\nmax-statements = 5\n',
      ),
    );
    expect(parsed.rules?.severity).toEqual({ INW013: "warning" });
    expect(parsed.rules?.options?.["thin-endpoint"]?.["max-statements"]).toBe(5);
  });

  test("two roles that agree on an option are fine", () => {
    const parsed = parseConfig(
      config(
        'router = { thin-endpoint = { max-statements = 8, deny-calls = ["httpx.*"] } }\n"api.v1" = { thin-endpoint = { deny-calls = ["httpx.*"], max-statements = 8 } }',
      ),
    );
    expect(parsed.rules?.options?.["thin-endpoint"]?.["max-statements"]).toBe(8);
  });
});

describe("mistakes are config errors that name the key", () => {
  test.each([
    [
      "a role the template doesn't list",
      config("routers = { async-blocking = true }"),
      'tool.inwards.templates.domain.rules.routers: the template has no role "routers". Roles: models, service, api.v1, router.',
    ],
    [
      "an unknown rule",
      config("router = { async-blocking-io = true }"),
      "tool.inwards.templates.domain.rules.router.async-blocking-io: no rule is named async-blocking-io.",
    ],
    [
      "a rule code instead of its name",
      config("router = { INW013 = true }"),
      "tool.inwards.templates.domain.rules.router.INW013: write the rule's name, async-blocking, not its code.",
    ],
    [
      "a rule that is on by default",
      config("router = { layer-dependency = true }"),
      "tool.inwards.templates.domain.rules.router.layer-dependency: INW001 layer-dependency is on by default for every module, so a template can't turn it on for a role.",
    ],
    [
      "false",
      config("router = { async-blocking = false }"),
      'tool.inwards.templates.domain.rules.router.async-blocking must be true, "error", "warning" or a table of the rule\'s options; to leave the rule off, remove it.',
    ],
    [
      "an unknown severity",
      config('router = { async-blocking = "fatal" }'),
      'tool.inwards.templates.domain.rules.router.async-blocking must be true, "error", "warning"',
    ],
    [
      "modules in a template table",
      config('router = { async-blocking = { modules = ["src.x"] } }'),
      "tool.inwards.templates.domain.rules.router.async-blocking.modules can't be set: the template fills it with the role's modules. Add other modules in [tool.inwards.rules.async-blocking].",
    ],
    [
      "role in INW015's template table",
      config('service = { construct-only-in = { role = ["src.x"] } }'),
      "tool.inwards.templates.domain.rules.service.construct-only-in.role can't be set: the template fills it with the role's modules.",
    ],
    [
      "an option another rule owns",
      config("router = { async-blocking = { max-statements = 3 } }"),
      "Unknown key tool.inwards.templates.domain.rules.router.async-blocking.max-statements.",
    ],
    [
      "a bad option value",
      config("router = { thin-endpoint = { max-statements = -1 } }"),
      "tool.inwards.templates.domain.rules.router.thin-endpoint.max-statements must be an integer from 0 to 1000",
    ],
    [
      "a role that isn't a table",
      config('router = "async-blocking"'),
      "tool.inwards.templates.domain.rules.router must be a table of rule names, such as { async-blocking = true }.",
    ],
    [
      "rules that aren't a table",
      `${LAYERS}\n[tool.inwards.templates.domain]\nroles = ["router"]\nrules = ["async-blocking"]\n`,
      "tool.inwards.templates.domain.rules must be a table of roles, such as { router = { async-blocking = true } }.",
    ],
    [
      "rules without roles",
      `${LAYERS}\n[tool.inwards.templates.domain]\nroles = ["router"]\n[tool.inwards.templates.other]\nrules = { router = { async-blocking = true } }\n`,
      "tool.inwards.templates.other.rules: the template has no roles to put rules on.",
    ],
    [
      "rules in a template no layer entry uses",
      `${LAYERS}\n[tool.inwards.templates.domain]\nroles = ["router"]\n[tool.inwards.templates.other]\nroles = ["router"]\nrules = { router = { async-blocking = true } }\n`,
      'tool.inwards.templates.other.rules: no layers entry uses template "other", so its roles match no modules. Add template = "other" to a layers entry, or remove the rules.',
    ],
    [
      "two roles that disagree on an option",
      config(
        'router = { thin-endpoint = { max-statements = 8 } }\n"api.v1" = { thin-endpoint = { max-statements = 3 } }',
      ),
      "tool.inwards.templates.domain.rules.api.v1.thin-endpoint.max-statements disagrees with tool.inwards.templates.domain.rules.router.thin-endpoint.max-statements: a rule has one value per option. Set it once in [tool.inwards.rules.thin-endpoint], which wins over both.",
    ],
    [
      "two roles that disagree on a severity",
      config('router = { async-blocking = "error" }\n"api.v1" = { async-blocking = "warning" }'),
      'tool.inwards.templates.domain.rules.api.v1.async-blocking disagrees with tool.inwards.templates.domain.rules.router.async-blocking: a rule has one severity. Set it once in [tool.inwards.rules] severity = { INW013 = "..." }, which wins over both.',
    ],
  ])("%s", (_what, text, message) => {
    expect(errorOf(text)).toContain(message);
  });

  test("a malformed top-level options table is still named by the rules parser", () => {
    expect(
      errorOf(
        config("router = { async-blocking = true }", "[tool.inwards.rules]\nasync-blocking = 1\n"),
      ),
    ).toContain("tool.inwards.rules.async-blocking must be a table");
  });
});
