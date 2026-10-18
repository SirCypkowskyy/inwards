/**
 * @file The opt-in content rules skip test modules (#362): INW012 to INW016,
 * INW021 and FAPI001 to FAPI009 don't report in a module whose name says it is a
 * test (`test_*`, `*_test`, `conftest`, or a `tests` or `test` segment) unless
 * the rule's options table sets `check-tests = true`. The other import rules still
 * check those modules, a suppression there isn't reported as unused, and
 * `check-tests` is a config error on a rule that doesn't take it, in the
 * parser and the JSON Schema alike (paired cases, as in `schema-negatives`).
 */
import { describe, expect, test } from "bun:test";
import { ruleLevel } from "../../src/config/_rule-settings.ts";
import { ConfigError, parseConfig } from "../../src/index.ts";
import { checkProject } from "../rules/fastapi/fixture.ts";
import { MINIMAL, parserError, schemaErrors } from "../support/config-schema.ts";

const LAYERS = `[tool.inwards]
layers = [{ name = "app", modules = ["app"] }]
`;

/**
 * Parses the test layer plus some rules TOML.
 *
 * @param rules - `[tool.inwards.rules]` and options tables, TOML.
 * @returns the parsed `[tool.inwards.rules]`.
 */
function rulesOf(rules: string): ReturnType<typeof parseConfig>["rules"] {
  return parseConfig(`${LAYERS}\n${rules}\n`).rules;
}

const ON = '[tool.inwards.rules]\nextend-select = ["FAPI001", "INW016", "INW013"]\n';

describe("a content rule in a test module", () => {
  test.each([
    "app.tests.test_orders",
    "app.tests",
    "tests.api.helpers",
    "app.test.factories",
    "app.orders.test_routes",
    "app.orders.routes_test",
    "app.conftest",
    "conftest",
  ])("is off in %s", (module) => {
    const rules = rulesOf(ON);
    expect(["FAPI001", "INW016", "INW013"].map((c) => ruleLevel(c, rules, module))).toEqual([
      "off",
      "off",
      "off",
    ]);
  });

  test.each([
    "app.orders",
    "app.testing",
    "app.contest",
    "app.latest_orders",
    "app.test_support.factories",
    "app.attestations",
  ])("is on in %s", (module) => {
    expect(ruleLevel("FAPI001", rulesOf(ON), module)).toBeUndefined();
  });

  test("comes back with check-tests = true, for that rule only", () => {
    const rules = rulesOf(`${ON}[tool.inwards.rules.orm-naming]\ncheck-tests = true\n`);
    expect(ruleLevel("INW016", rules, "app.tests.models")).toBeUndefined();
    expect(ruleLevel("FAPI001", rules, "app.tests.models")).toBe("off");
  });

  test("stays off with check-tests = false, and modules still narrows it", () => {
    const rules = rulesOf(
      `${ON}[tool.inwards.rules.orm-naming]\ncheck-tests = false\n[tool.inwards.rules.endpoint-metadata]\ncheck-tests = true\nmodules = ["app.api"]\n`,
    );
    expect(ruleLevel("INW016", rules, "app.tests.models")).toBe("off");
    expect(ruleLevel("FAPI001", rules, "app.api.tests.test_app")).toBeUndefined();
    expect(ruleLevel("FAPI001", rules, "app.tests.test_app")).toBe("off");
  });

  test("leaves the import rules and whole-rule questions alone", () => {
    const rules = rulesOf(ON);
    expect(ruleLevel("INW001", rules, "app.tests.test_orders")).toBeUndefined();
    expect(ruleLevel("INW006", rules, "app.conftest")).toBeUndefined();
    expect(ruleLevel("FAPI001", rules)).toBeUndefined();
  });
});

describe("check-tests", () => {
  test("must be a boolean", () => {
    expect(() => rulesOf("[tool.inwards.rules.async-blocking]\ncheck-tests = 1\n")).toThrow(
      new ConfigError("tool.inwards.rules.async-blocking.check-tests must be true or false."),
    );
  });

  test("is an unknown key for an import rule", () => {
    expect(() => rulesOf("[tool.inwards.rules.layer-dependency]\ncheck-tests = true\n")).toThrow(
      "Unknown key tool.inwards.rules.layer-dependency.check-tests",
    );
  });
});

describe("check-tests in the schema and the parser", () => {
  test.each([
    ["a string", "depends-called", 'check-tests = "yes"'],
    ["a number", "orm-naming", "check-tests = 1"],
    ["a string in INW021's table", "private-module", 'check-tests = "no"'],
    ["an import rule's table", "layer-dependency", "check-tests = true"],
    ["a diagram rule's table", "diagram-unknown-name", "check-tests = true"],
  ])("fails both for %s", (_what, rule, body) => {
    const text = `${MINIMAL}[tool.inwards.rules.${rule}]\n${body}\n`;
    expect(parserError(text)).toBeDefined();
    expect(schemaErrors(text)).not.toEqual([]);
  });

  test.each([
    "thin-endpoint",
    "construct-only-in",
    "router-wiring",
    "duplicate-operation-id",
    "private-module",
  ])("passes both in %s's table", (rule) => {
    const role = rule === "construct-only-in" ? 'role = ["shop.adapters"]\n' : "";
    const text = `${MINIMAL}[tool.inwards.rules.${rule}]\n${role}check-tests = true\n`;
    expect([parserError(text), schemaErrors(text)]).toEqual([undefined, []]);
  });
});

const ROUTER = `from fastapi import APIRouter

router = APIRouter()


@router.post("/orders")
async def create_order(body: dict):
    ...
`;

describe("the engine", () => {
  const files = {
    "app/__init__.py": "",
    "app/orders.py": ROUTER,
    "app/tests/__init__.py": "",
    "app/tests/test_app.py": ROUTER,
  };

  test("reports FAPI001 in the app and not in its tests", async () => {
    const found = await checkProject(files, '[tool.inwards.rules]\nextend-select = ["FAPI001"]');
    expect(found.map((d) => `${d.file}:${d.code}`)).toEqual(["app/orders.py:FAPI001"]);
  });

  test("reports it in the tests too with check-tests = true", async () => {
    const found = await checkProject(
      files,
      '[tool.inwards.rules]\nextend-select = ["FAPI001"]\n[tool.inwards.rules.endpoint-metadata]\ncheck-tests = true',
    );
    expect(found.map((d) => `${d.file}:${d.code}`)).toEqual([
      "app/orders.py:FAPI001",
      "app/tests/test_app.py:FAPI001",
    ]);
  });

  test("doesn't call a suppression in a skipped test module unused", async () => {
    const suppressed = ROUTER.replace(
      '@router.post("/orders")',
      '@router.post("/orders")  # inwards: ignore[FAPI001] reason="test app"',
    );
    const found = await checkProject(
      { ...files, "app/tests/test_app.py": suppressed },
      '[tool.inwards.rules]\nextend-select = ["FAPI001"]',
    );
    expect(found.map((d) => `${d.file}:${d.code}`)).toEqual(["app/orders.py:FAPI001"]);
  });

  test("still reports an import rule in a test module", async () => {
    const found = await checkProject(
      {
        "app/__init__.py": "",
        "app/tests/__init__.py": "",
        "app/tests/test_x.py": "import app.missing\n",
      },
      '[tool.inwards.rules]\nextend-select = ["FAPI001"]',
    );
    expect(found.map((d) => `${d.file}:${d.code}`)).toEqual(["app/tests/test_x.py:INW010"]);
  });
});
