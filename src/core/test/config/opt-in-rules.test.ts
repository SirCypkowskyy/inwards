/**
 * @file Opt-in rules and per-rule options (#181): a rule registered with
 * `default: "off"` reports only when `extend-select` or `select` turns it on,
 * an options table `[tool.inwards.rules.<rule-name>]` is validated key by key,
 * a table for a rule that is off is a warning in pyproject.toml, and SARIF
 * lists the opt-in rule as disabled. The tests register an opt-in rule of
 * their own in `RULES`, so they don't depend on what a shipped one reports,
 * and remove it afterwards.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { applyRules, checkRuleOptions, ruleLevel } from "../../src/config/rule-settings.ts";
import type { Diagnostic } from "../../src/contracts/records.ts";
import { ConfigError, Engine, parseConfig, RULES, render } from "../../src/index.ts";
import { diagnostic, type RuleMeta } from "../../src/meta/registry.ts";
import { file, grammars, PROJECT } from "../support/helpers.ts";

const LAYERS = `[tool.inwards]
layers = [
  { name = "domain", modules = ["shop.domain"] },
  { name = "infrastructure", modules = ["shop.infrastructure"] },
]
`;

/** The test's opt-in rule; only this file registers it. */
const PROBE: RuleMeta = {
  code: "TST001",
  name: "opt-in-probe",
  severity: "error",
  default: "off",
  summary: "A rule only these tests register.",
  docs: "https://example.invalid/rules/TST001/",
};

const ORDER = file("shop/domain/order.py", "import shop.infrastructure.db\n");

/**
 * Builds one finding of a rule in the domain module.
 *
 * @param rule - the rule that reports it.
 * @returns a diagnostic of that rule on line 1 of `shop/domain/order.py`.
 */
function findingOf(rule: RuleMeta): Diagnostic {
  const span = { line: 1, column: 1, endLine: 1, endColumn: 2 };
  return diagnostic(rule, ORDER, { span, message: "m", fix: { summary: "s", steps: [] } });
}

/**
 * Builds the test layers plus a `[tool.inwards.rules]` body.
 *
 * @param rules - the table's body, TOML; empty for no table at all.
 * @returns the config text.
 */
function pyproject(rules: string): string {
  return rules === "" ? LAYERS : `${LAYERS}\n[tool.inwards.rules]\n${rules}\n`;
}

/**
 * Applies a config's rule settings to one INW001 and one opt-in finding.
 *
 * @param rules - the `[tool.inwards.rules]` body, TOML; empty for no table.
 * @returns the codes still reported.
 */
function reported(rules: string): string[] {
  const settings = parseConfig(pyproject(rules)).rules;
  return applyRules([findingOf(RULES.INW001), findingOf(PROBE)], settings).map((d) => d.code);
}

/**
 * Checks the domain module with INW001 scoped to some modules.
 *
 * @param selectors - the `modules` list's items, TOML.
 * @returns `module:code` for each diagnostic reported.
 */
async function scoped(selectors: string): Promise<string[]> {
  const text = `${LAYERS}\n[tool.inwards.rules.layer-dependency]\nmodules = [${selectors}]\n`;
  const engine = await Engine.create(grammars(), parseConfig(text));
  return engine.checkFiles([ORDER], PROJECT).map((d) => `${d.module}:${d.code}`);
}

beforeAll(() => {
  Reflect.set(RULES, PROBE.code, PROBE);
});

afterAll(() => {
  Reflect.deleteProperty(RULES, PROBE.code);
});

describe("an opt-in rule", () => {
  test.each([
    ["no table", "", ["INW001"]],
    ["a table that doesn't name it", 'ignore = ["INW005"]', ["INW001"]],
    ["extend-select", 'extend-select = ["TST001"]', ["INW001", "TST001"]],
    ["select, where it is the only rule", 'select = ["TST001"]', ["TST001"]],
    ["select plus extend-select", 'select = ["INW005"]\nextend-select = ["TST001"]', ["TST001"]],
    ["extend-select plus ignore", 'extend-select = ["TST001"]\nignore = ["TST001"]', ["INW001"]],
  ])("with %s", (_, rules, expected) => {
    expect(reported(rules)).toEqual(expected);
  });

  test("is off for every caller of ruleLevel when nothing turns it on", () => {
    expect(ruleLevel("TST001", undefined)).toBe("off");
    expect(ruleLevel("INW001", undefined)).toBeUndefined();
  });

  test("an unknown code in extend-select is a config error", () => {
    const text = pyproject('extend-select = ["TST999"]');
    expect(() => parseConfig(text)).toThrow(ConfigError);
    expect(() => parseConfig(text)).toThrow(
      'Unknown rule code "TST999" in tool.inwards.rules.extend-select',
    );
  });

  test("SARIF lists it with enabled = false, and every shipped rule by its own default", () => {
    const report = { diagnostics: [], filesChecked: 1, durationMs: 0 };
    const { rules } = JSON.parse(render(report, "sarif")).runs[0].tool.driver;
    expect(rules.find((r: { id: string }) => r.id === "TST001")).toMatchInlineSnapshot(`
      {
        "defaultConfiguration": {
          "enabled": false,
          "level": "error",
        },
        "helpUri": "https://example.invalid/rules/TST001/",
        "id": "TST001",
        "name": "opt-in-probe",
        "shortDescription": {
          "text": "A rule only these tests register.",
        },
      }
    `);
    const shipped = rules.filter((r: { id: string }) => r.id !== PROBE.code);
    expect(shipped.map((r: { defaultConfiguration: object }) => r.defaultConfiguration)).toEqual(
      Object.values<RuleMeta>(RULES)
        .filter((r) => r.code !== PROBE.code)
        .map((r) =>
          r.default === "off" ? { enabled: false, level: r.severity } : { level: r.severity },
        ),
    );
  });
});

describe("options tables, [tool.inwards.rules.<rule-name>]", () => {
  test("are parsed by rule name, sorted, and turn nothing on", () => {
    const text = `${pyproject('ignore = ["INW005"]')}\n[tool.inwards.rules.opt-in-probe]\nmodules = ["shop.*"]\n[tool.inwards.rules.layer-dependency]\n`;
    const { rules } = parseConfig(text);
    expect(JSON.stringify(rules?.options)).toBe(
      '{"layer-dependency":{},"opt-in-probe":{"modules":["shop.*"]}}',
    );
    expect(ruleLevel("TST001", rules)).toBe("off");
  });

  test.each([
    ["threshold = 3", "Unknown key tool.inwards.rules.opt-in-probe.threshold"],
    ["modules = []", "tool.inwards.rules.opt-in-probe.modules must be a non-empty list"],
    ['modules = ["shop..x"]', '"shop..x" is not a module prefix or selector'],
    ['modules = ["*.api"]', "it must start with a package name"],
  ])("%s is a config error naming the key", (body, message) => {
    const text = `${LAYERS}\n[tool.inwards.rules.opt-in-probe]\n${body}\n`;
    expect(() => parseConfig(text)).toThrow(ConfigError);
    expect(() => parseConfig(text)).toThrow(message);
  });

  test.each([
    ["INW001 = {}", "Unknown key tool.inwards.rules.INW001"],
    ["no-such-rule = {}", "Unknown key tool.inwards.rules.no-such-rule"],
    ["opt-in-probe = 3", "tool.inwards.rules.opt-in-probe must be a table"],
    ["unsupported-encoding = {}", "tool.inwards.rules.unsupported-encoding can't be set"],
  ])("%s is a config error", (body, message) => {
    expect(() => parseConfig(pyproject(body))).toThrow(message);
  });

  test("a table for a rule that is off is a warning located in pyproject.toml", () => {
    const text = `${LAYERS}\n[tool.inwards.rules.opt-in-probe]\nmodules = ["shop.*"]\n`;
    const found = checkRuleOptions(parseConfig(text).rules, { path: "pyproject.toml", text });
    expect(found.map((d) => [d.code, d.severity, d.file, d.line, d.column, d.message])).toEqual([
      [
        "TST001",
        "warning",
        "pyproject.toml",
        7,
        15,
        "[tool.inwards.rules.opt-in-probe] sets options for opt-in-probe (TST001), which is off, so they do nothing.",
      ],
    ]);
  });

  test("a table for a rule that is on is fine; one for an ignored rule warns under its code", () => {
    const on = `${pyproject('extend-select = ["TST001"]')}\n[tool.inwards.rules.opt-in-probe]\n`;
    expect(checkRuleOptions(parseConfig(on).rules, { path: "pyproject.toml", text: on })).toEqual(
      [],
    );
    const ignored = pyproject('ignore = ["INW001"]\nlayer-dependency = { modules = ["shop.*"] }');
    const found = checkRuleOptions(parseConfig(ignored).rules, {
      path: "pyproject.toml",
      text: ignored,
    });
    expect(found.map((d) => [d.code, d.line])).toEqual([["INW001", 9]]);
  });

  test("modules scopes a rule to the modules its selectors match", async () => {
    expect(await scoped('"shop.api"')).toEqual([]);
    expect(await scoped('"shop.api", "shop.*.order"')).toEqual(["shop.domain.order:INW001"]);
  });
});
