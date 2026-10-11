/**
 * @file `inwards rules` and `inwards rule` end to end (#341): the rule list
 * with each rule's state, severity and the config key behind them, in text
 * and as `inwards/rules@1`, and one rule's page, which must be the text MCP's
 * `explain_rule` returns. Exit codes and output are pinned in a snapshot;
 * the pages themselves aren't, so a docs edit doesn't churn it.
 */
import { expect, test } from "bun:test";
import { RULES } from "@inwards/core";
import { RULE_PAGES } from "../../src/adapters/rule-pages.ts";
import { explainRule } from "../../src/mcp/explain-rule.ts";
import { inwards, project } from "../support/run.ts";

const CONFIG = `[tool.inwards]
layers = [
  { name = "core", modules = ["src.database"] },
  { name = "domain", modules = ["src.*"], template = "domain" },
]

[tool.inwards.rules]
ignore = ["INW005"]
extend-select = ["FAPI006"]
severity = { INW001 = "warning" }

[tool.inwards.templates.domain]
roles = ["models", "service", "router"]

[tool.inwards.templates.domain.rules]
router = { async-blocking = true }
models = { orm-naming = "warning" }
`;

const empty = project({ "README.md": "hi" });
const configured = project({ "pyproject.toml": CONFIG, "src/database/db.py": "" });

test("rules without a config lists every rule at its default", () => {
  const result = inwards(["rules"], { cwd: empty });
  expect(result).toMatchSnapshot();
  expect(result.stdout.trimEnd().split("\n")).toHaveLength(Object.keys(RULES).length + 3);
});

test("rules names the key behind each rule's state and severity", () => {
  expect(inwards(["rules"], { cwd: configured })).toMatchSnapshot();
});

test("rules --json prints inwards/rules@1", () => {
  const result = inwards(["rules", "--json"], { cwd: configured });
  expect(result.code).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchSnapshot();
});

test("rules with a --config that isn't a file is a usage error", () => {
  expect(inwards(["rules", "--config", "nope.toml"], { cwd: empty })).toMatchSnapshot();
});

test.each(["INW001", "layer-dependency", "fapi003"])(
  "rule %s prints the text explain_rule returns",
  (rule) => {
    const result = inwards(["rule", rule], { cwd: empty });
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(`${explainRule(RULE_PAGES, { rule }).text}\n`);
  },
);

test("rule --full --json prints explain_rule's data with every section", () => {
  const result = inwards(["rule", "INW013", "--full", "--json"], { cwd: empty });
  expect(result.code).toBe(0);
  const data: unknown = JSON.parse(result.stdout);
  expect(data).toEqual(explainRule(RULE_PAGES, { rule: "INW013", full: true }).data);
  expect(result.stdout).toContain('"id": "configuration"');
});

test.each(["INW099", "layer-dependecy", "nothing-like-it", "", "INW001 INW002"])(
  "rule %p is a usage error, exit 2",
  (line) => {
    const args = line === "" ? ["rule"] : ["rule", ...line.split(" ")];
    const result = inwards(args, { cwd: empty });
    expect(result.code).toBe(2);
    expect(result.stdout).toBe("");
    expect(result).toMatchSnapshot();
  },
);
