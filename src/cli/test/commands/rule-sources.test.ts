/**
 * @file Which config key `inwards rules` names for each rule (#341): the
 * default, `select`, `extend-select`, `ignore`, `severity` and a template
 * role's `rules` table, in the order `ruleLevel` decides. The rows come from
 * a parsed config and its raw table, as the command passes them.
 */
import { expect, test } from "bun:test";
import { inwardsTable, parseConfig } from "@inwards/core";
import { type RuleRow, ruleRows } from "../../src/commands/rule-sources.ts";

const LAYERS = `[tool.inwards]
layers = [
  { name = "core", modules = ["src.database"] },
  { name = "domain", modules = ["src.*"], template = "domain" },
]
`;

/** One layer, no template. */
const PLAIN = `[tool.inwards]
layers = [{ name = "core", modules = ["src.database"] }]
`;

const TEMPLATE = `
[tool.inwards.templates.domain]
roles = ["models", "service", "router"]

[tool.inwards.templates.domain.rules]
router = { async-blocking = true, thin-endpoint = "error" }
models = { orm-naming = "warning" }
`;

/**
 * Lists the rows for a config.
 *
 * @param text - a whole pyproject.toml.
 * @returns the rows, by code.
 */
function rows(text: string): Map<string, RuleRow> {
  const list = ruleRows({ parsed: parseConfig(text), raw: inwardsTable(text) });
  return new Map(list.map((r) => [r.code, r]));
}

/**
 * Picks one row.
 *
 * @param all - the rows, by code.
 * @param code - the rule's code.
 * @returns that rule's row.
 * @throws {Error} when the code isn't listed.
 */
function row(all: Map<string, RuleRow>, code: string): RuleRow {
  const found = all.get(code);
  if (found === undefined) {
    throw new Error(`no row for ${code}`);
  }
  return found;
}

test("without a config every rule sits at its default, INW000 always on", () => {
  const all = new Map(ruleRows(undefined).map((r) => [r.code, r]));
  expect(row(all, "INW000").source).toEqual({ kind: "fixed", keys: [] });
  expect(row(all, "INW001")).toMatchObject({ enabled: true, source: { kind: "default" } });
  expect(row(all, "INW013")).toMatchObject({ enabled: false, source: { kind: "opt-in" } });
  expect(row(all, "INW012").severity).toBe("warning");
});

test("select, ignore and extend-select name their key, ignore winning", () => {
  const all = rows(
    `${PLAIN}[tool.inwards.rules]\nselect = ["INW001", "INW002"]\nignore = ["INW002"]\nextend-select = ["FAPI006"]\n`,
  );
  expect(row(all, "INW001").source).toEqual({ kind: "select", keys: ["rules.select"] });
  expect(row(all, "INW002")).toMatchObject({ enabled: false, source: { kind: "ignore" } });
  expect(row(all, "INW003")).toMatchObject({ enabled: false, source: { kind: "not-selected" } });
  expect(row(all, "FAPI006")).toMatchObject({
    enabled: true,
    source: { kind: "extend-select", keys: ["rules.extend-select"] },
  });
  expect(row(all, "INW000").enabled).toBe(true);
});

test("a template role names its key, scope and severity", () => {
  const all = rows(`${LAYERS}${TEMPLATE}`);
  expect(row(all, "INW013")).toMatchObject({
    enabled: true,
    source: { kind: "template", keys: ["templates.domain.rules.router"] },
    severitySource: { kind: "default" },
    modules: ["src.*.router"],
  });
  expect(row(all, "INW016")).toMatchObject({
    severity: "warning",
    severitySource: { kind: "template", keys: ["templates.domain.rules.models"] },
  });
  expect(row(all, "INW012")).toMatchObject({ severity: "error", enabled: true });
});

test("the top-level table wins over a template for the key it names", () => {
  const all = rows(
    `${LAYERS}[tool.inwards.rules]\nextend-select = ["INW013"]\nseverity = { INW016 = "error" }\n${TEMPLATE}`,
  );
  expect(row(all, "INW013").source).toEqual({
    kind: "extend-select",
    keys: ["rules.extend-select"],
  });
  expect(row(all, "INW016")).toMatchObject({
    severity: "error",
    severitySource: { kind: "severity", keys: ["rules.severity"] },
  });
});

test("a dotted role is quoted in its key", () => {
  const all = rows(`${LAYERS}
[tool.inwards.templates.domain]
roles = ["api.v1"]

[tool.inwards.templates.domain.rules]
"api.v1" = { async-blocking = true }
`);
  expect(row(all, "INW013").source.keys).toEqual(['templates.domain.rules."api.v1"']);
});
