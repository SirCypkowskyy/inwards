import { describe, expect, test } from "bun:test";
import {
  ConfigError,
  checkMoves,
  checkPrefixes,
  checkRequired,
  checkShape,
  Engine,
  membersFrom,
  packagesOf,
  parseConfig,
} from "../src/index.ts";
import { file, grammars, PROJECT } from "./helpers.ts";

const LAYERS = `[tool.inwards]
layers = [
  { name = "domain", modules = ["shop.domain"] },
  { name = "infrastructure", modules = ["shop.infrastructure"] },
]
`;
/** An INW001 and an INW005 finding in one domain module. */
const LEAKS = file("shop/domain/order.py", "import shop.infrastructure.db\nimport sqlalchemy\n");
const HIDDEN = file("shop/domain/hidden.py", "# coding: utf-7\nx = 1\n");

/**
 * Parses the test layers plus a `[tool.inwards.rules]` table.
 *
 * @param rules - the table's body, TOML.
 * @returns the config.
 */
function withRules(rules: string): ReturnType<typeof parseConfig> {
  return parseConfig(`${LAYERS}\n[tool.inwards.rules]\n${rules}\n`);
}

/**
 * Checks the test files with an engine built for some rule settings.
 *
 * @param rules - the `[tool.inwards.rules]` body, TOML.
 * @returns `code:severity` for each diagnostic, in order.
 */
async function levels(rules: string): Promise<string[]> {
  const engine = await Engine.create(grammars(), withRules(rules));
  return engine
    .checkFiles([LEAKS, HIDDEN], PROJECT)
    .map((d) => `${d.module}:${d.code}:${d.severity}`);
}

describe("[tool.inwards.rules] parsing", () => {
  test("each key is read as written", () => {
    const config = withRules(
      'select = ["INW001", "INW005"]\nignore = ["INW005"]\nseverity = { INW001 = "warning" }',
    );
    expect(config.rules).toEqual({
      select: ["INW001", "INW005"],
      ignore: ["INW005"],
      severity: { INW001: "warning" },
    });
  });

  test("the severity table can be its own section", () => {
    const text = `${LAYERS}\n[tool.inwards.rules.severity]\nINW006 = "warning"\nINW007 = "error"\n`;
    expect(parseConfig(text).rules).toEqual({ severity: { INW006: "warning", INW007: "error" } });
  });

  test("severity codes come out sorted, so reordering the table changes nothing", () => {
    const one = withRules('severity = { INW005 = "warning", INW001 = "warning" }');
    const two = withRules('severity = { INW001 = "warning", INW005 = "warning" }');
    expect(JSON.stringify(one)).toBe(JSON.stringify(two));
  });

  test("no table, no settings", () => {
    expect(parseConfig(LAYERS).rules).toBeUndefined();
  });

  test.each([
    ['select = ["INW099"]', 'Unknown rule code "INW099" in tool.inwards.rules.select'],
    ['ignore = ["INW01"]', 'Unknown rule code "INW01" in tool.inwards.rules.ignore'],
    ['ignore = ["inw001"]', 'Unknown rule code "inw001"'],
    [
      'severity = { INW042 = "warning" }',
      'Unknown rule code "INW042" in tool.inwards.rules.severity',
    ],
  ])("an unknown code is a config error: %s", (rules, message) => {
    expect(() => withRules(rules)).toThrow(ConfigError);
    expect(() => withRules(rules)).toThrow(message);
  });

  test.each([
    ['ignore = ["INW000"]', "can't list INW000"],
    ['severity = { INW000 = "warning" }', "can't list INW000"],
    ['select = "INW001"', "must be a list of rule codes"],
    ["ignore = [1]", "must be a list of rule codes"],
    ["select = []", "at least one rule code"],
    ['severity = { INW001 = "info" }', 'severity.INW001 must be "error" or "warning"'],
    ['severity = ["INW001"]', "must be a table"],
    ['extend-select = ["INW001"]', "Unknown key tool.inwards.rules.extend-select"],
  ])("%s is a config error", (rules, message) => {
    expect(() => withRules(rules)).toThrow(message);
  });

  test("rules itself must be a table", () => {
    expect(() => parseConfig(LAYERS.replace("layers", 'rules = ["INW001"]\nlayers'))).toThrow(
      "tool.inwards.rules must be a table.",
    );
  });

  test("INW000 may be selected, though it always reports anyway", () => {
    expect(withRules('select = ["INW000", "INW001"]').rules?.select).toContain("INW000");
  });
});

describe("[tool.inwards.rules] in the engine", () => {
  test("without settings every rule reports as an error", async () => {
    expect(await levels("")).toEqual([
      "shop.domain.order:INW001:error",
      "shop.domain.order:INW005:error",
      "shop.domain.hidden:INW000:error",
    ]);
  });

  test("ignore drops a rule's diagnostics", async () => {
    expect(await levels('ignore = ["INW001"]')).toEqual([
      "shop.domain.order:INW005:error",
      "shop.domain.hidden:INW000:error",
    ]);
  });

  test("select keeps only the listed rules, and INW000", async () => {
    expect(await levels('select = ["INW005"]')).toEqual([
      "shop.domain.order:INW005:error",
      "shop.domain.hidden:INW000:error",
    ]);
  });

  test("ignore wins over select", async () => {
    expect(await levels('select = ["INW001", "INW005"]\nignore = ["INW005"]')).toEqual([
      "shop.domain.order:INW001:error",
      "shop.domain.hidden:INW000:error",
    ]);
  });

  test("severity re-levels every finding of a rule", async () => {
    expect(await levels('severity = { INW001 = "warning" }')).toEqual([
      "shop.domain.order:INW001:warning",
      "shop.domain.order:INW005:error",
      "shop.domain.hidden:INW000:error",
    ]);
  });

  test("checkFile applies the settings too, as the language server sees them", async () => {
    const engine = await Engine.create(grammars(), withRules('ignore = ["INW005"]'));
    expect(engine.checkFile(LEAKS, PROJECT).map((d) => d.code)).toEqual(["INW001"]);
  });

  test("INW006's per-package warning can become an error, still once per package", async () => {
    const engine = await Engine.create(grammars(), withRules('severity = { INW006 = "error" }'));
    const tools = [file("tools/a.py", "x = 1\n"), file("tools/b.py", "x = 1\n")];
    expect(engine.checkFiles(tools, PROJECT).map((d) => `${d.code}:${d.severity}`)).toEqual([
      "INW006:error",
    ]);
  });
});

describe("[tool.inwards.rules] in the checks adapters call directly", () => {
  const shaped = `${LAYERS}
[[tool.inwards.shape]]
packages = ["shop.domain"]
allow = ["order.py"]
require = ["order.py"]
`;
  const paths = ["shop/domain/__init__.py", "shop/domain/helpers.py"];
  const pyproject = { path: "pyproject.toml", text: shaped };

  test("INW007 and INW008 follow ignore and severity", () => {
    const config = parseConfig(
      `${shaped}\n[tool.inwards.rules]\nignore = ["INW008"]\nseverity = { INW007 = "warning" }\n`,
    );
    const helpers = file("shop/domain/helpers.py", "");
    expect(checkShape(helpers, config).map((d) => d.severity)).toEqual(["warning"]);
    expect(checkRequired(config, packagesOf(paths), membersFrom(paths))).toEqual([]);
    expect(checkRequired(parseConfig(shaped), packagesOf(paths), membersFrom(paths))).toHaveLength(
      1,
    );
  });

  test("INW006 prefix findings follow ignore", () => {
    const config = parseConfig(`${shaped}\n[tool.inwards.rules]\nignore = ["INW006"]\n`);
    expect(checkPrefixes(parseConfig(shaped), new Set(["shop.domain"]), pyproject)).toHaveLength(1);
    expect(checkPrefixes(config, new Set(["shop.domain"]), pyproject)).toEqual([]);
  });

  test("the session layout checks ignore the table, like INW000", () => {
    const config = parseConfig(`${LAYERS}\n[tool.inwards.rules]\nignore = ["INW006"]\n`);
    const toml = { path: "pyproject.toml", text: LAYERS };
    const start = new Set(["shop.domain.order", "shop.infrastructure.db"]);
    const emptied = checkPrefixes(config, new Set(["shop.infrastructure.db"]), toml, start);
    expect(emptied.map((d) => `${d.code}:${d.severity}`)).toEqual(["INW006:error"]);
    const was = new Map([["shop.domain.order", "a"]]);
    const moved = checkMoves(config, was, new Map([["shop.core.order", "a"]]), toml);
    expect(moved.map((d) => d.code)).toEqual(["INW006"]);
  });
});
