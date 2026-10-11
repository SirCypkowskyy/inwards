/**
 * @file The architecture brief's opt-in rules (#336) and the compression that
 * makes room for them: one line per opt-in rule the config turns on, with its
 * key setting and scope; inner layers past the third named by number; a
 * context's public modules sharing its prefix. The fastapi scaffold, the
 * preset with the most rules on, stays under its 550-token bound.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseConfig, RULES } from "@inwards/core";
import { architectureBrief, briefFor } from "../../src/init/brief.ts";
import { STYLES } from "../../src/init/presets.ts";
import { configTable } from "../../src/init/style-text.ts";
import { inwards, LAYERS, project } from "../support/run.ts";

const BEGIN = "<!-- inwards-brief:begin -->";
const END = "<!-- inwards-brief:end -->";
/** A brief line's rule code. */
const CODE = /^- (?<code>[A-Z]+\d+)/u;

/** A probe that finds nothing on disk. */
const NOTHING = {
  probe: { exists: (): boolean => false, kind: (): undefined => undefined },
};

/**
 * Estimates a text's tokens the usual rough way: four characters per token.
 *
 * @param text - what to measure, e.g. the brief.
 * @returns the estimate, rounded up.
 */
function tokens(text: string): number {
  return Math.ceil(text.length / 4);
}

describe("opt-in rules (#336)", () => {
  /** Every opt-in rule's code, in the registry's order. */
  const OptIn = Object.values(RULES).flatMap((rule) => (rule.default === "off" ? [rule.code] : []));

  /**
   * Builds the brief for the example layers plus a rules table.
   *
   * @param rules - TOML for `[tool.inwards.rules]` and its options tables.
   * @returns the brief.
   */
  function withRules(rules: string): string {
    return architectureBrief({
      config: parseConfig(`${LAYERS}${rules}`),
      style: undefined,
      ports: [],
    });
  }

  test("adds no section while every opt-in rule is off", () => {
    expect(withRules("")).not.toContain("Opt-in rules");
    expect(
      withRules('[tool.inwards.rules]\nextend-select = ["INW013"]\nignore = ["INW013"]\n'),
    ).not.toContain("Opt-in rules");
  });

  test("words every opt-in rule in one short line, in the registry's order", () => {
    const brief = withRules(`[tool.inwards.rules]
extend-select = ${JSON.stringify(OptIn)}
[tool.inwards.rules.construct-only-in]
role = ["shop.infrastructure"]
`);
    const lines = brief.slice(brief.indexOf("Opt-in rules:")).split("\n").slice(1);
    expect(lines.map((line) => CODE.exec(line)?.groups?.["code"])).toEqual(OptIn);
    for (const line of lines) {
      expect(line.length).toBeLessThan(150);
    }
  });

  test("gives each rule its key setting", () => {
    const brief = withRules(`[tool.inwards.rules]
extend-select = ["INW012", "INW014", "INW015", "INW016", "FAPI001", "FAPI002", "FAPI003"]
[tool.inwards.rules.thin-endpoint]
delegate-to = ["domain"]
[tool.inwards.rules.ports-abstract]
modules = ["shop.domain.ports"]
[tool.inwards.rules.construct-only-in]
role = ["shop.infrastructure"]
allowed-in = ["shop.api.main"]
[tool.inwards.rules.orm-naming]
table-name = "snake"
date-suffix = false
[tool.inwards.rules.endpoint-metadata]
require-summary = false
require-response-model = false
require-status-code = ["post"]
require-response-fields = []
require-tags = true
[tool.inwards.rules.undocumented-error-response]
codes = "4xx-5xx"
[tool.inwards.rules.router-wiring]
entrypoints = ["shop.api.main:app"]
`);
    expect(brief).toContain(
      "- INW012: endpoints stay thin: call into `domain`; no queries or outgoing calls",
    );
    expect(brief).toContain(
      "- INW014: `shop.domain.ports` hold only ABCs and Protocols whose methods have no body",
    );
    expect(brief).toContain(
      "- INW015: only `shop.api.main` may import or build `shop.infrastructure`; elsewhere take it through a port",
    );
    expect(brief).toContain("- INW016: snake_case table names, datetime columns end in `_at`\n");
    expect(brief).toContain("- FAPI001: path operations need `status_code` on POST and `tags`");
    expect(brief).toContain("- FAPI002: declare every 4xx and 5xx a path operation raises");
    expect(brief).toContain("- FAPI003: include every `APIRouter` in `shop.api.main:app`;");
  });

  test("names the modules a rule is scoped to, a template role's included", () => {
    const config = parseConfig(`[tool.inwards]
layers = [
  { name = "kernel", modules = ["app"] },
  { name = "domain", modules = ["app.*"], template = "slice" },
]
[tool.inwards.templates.slice]
roles = ["models", "service", "router"]
[tool.inwards.templates.slice.rules]
router = { async-blocking = true }
`);
    expect(architectureBrief({ config, style: undefined, ports: [] })).toContain(
      "- INW013 in `app.*.router`: no blocking calls in `async def`",
    );
  });

  test("leaves out INW015 without a role, since it then checks nothing", () => {
    expect(withRules('[tool.inwards.rules]\nextend-select = ["INW015"]\n')).not.toContain("INW015");
  });
});

test("a fastapi project's layers past the third name what they may import by number", () => {
  const style = STYLES["fastapi"];
  const text = configTable(style, {
    pkg: "app",
    root: "src",
    version: "0.1.0",
    ignore: [],
    scaffold: false,
    eol: "\n",
  });
  const brief = briefFor(NOTHING, "/p/pyproject.toml", text);
  expect(brief).toContain(
    "2. domain.constants (`app.*.constants`): may import kernel; not its siblings",
  );
  expect(brief).toContain(
    "5. domain.models (`app.*.models`): may import layers 1-4; not its sibling domain.schemas",
  );
  expect(brief).toContain("10. domain.router (`app.*.router`): may import layers 1-9\n");
  expect(brief).toContain("11. main (`app.main`): may import every other layer");
});

test("with --style fastapi --scaffold, the brief lists the opt-in rules and stays under 550 tokens", () => {
  const root = project({ "pyproject.toml": '[project]\nname = "app"\n' });
  expect(inwards(["init", "--style", "fastapi", "--scaffold", "--brief"], { cwd: root }).code).toBe(
    0,
  );
  const text = readFileSync(join(root, "AGENTS.md"), "utf8");
  expect(text).toContain(
    "- INW012: endpoints stay thin: call into `domain.service`; no queries or outgoing calls",
  );
  expect(text).toContain("- FAPI009: pass `Depends(get_db)`, not `Depends(get_db())`");
  expect(text).toContain(
    "- posts (`app.posts`): public `app.posts.{router,service,schemas,dependencies,constants,exceptions}`",
  );
  const brief = text.slice(text.indexOf(BEGIN) + BEGIN.length, text.indexOf(END));
  expect(tokens(brief)).toBeLessThan(550);
});
