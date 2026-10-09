/**
 * @file The FastAPI rule family's registration (#186, ADR-036): FAPI001 to
 * FAPI005 (FAPI004 is reserved) are registered opt-in, SARIF lists them as disabled,
 * `extend-select` turns one on, an inline suppression names them like any
 * INW code, and an unknown FAPI code is a config error and an INW009 error.
 * A suppression is checked against a finding built here; the rules' own
 * suppression tests live next to their checks (#183).
 */
import { describe, expect, test } from "bun:test";
import { ruleLevel } from "../../../src/config/rule-settings.ts";
import { ConfigError, Engine, parseConfig, RULES, render } from "../../../src/index.ts";
import { diagnostic } from "../../../src/meta/registry.ts";
import { suppress } from "../../../src/rules/suppression-comment.ts";
import { file, grammars, PROJECT, parser } from "../../support/helpers.ts";

const LAYERS = `[tool.inwards]
layers = [
  { name = "domain", modules = ["shop.domain"] },
  { name = "api", modules = ["shop.api"] },
]
`;
const FAPI = ["FAPI001", "FAPI002", "FAPI003", "FAPI005"];
const REASON = 'reason="documented in the gateway"';

/**
 * Parses the test layers plus a `[tool.inwards.rules]` body.
 *
 * @param rules - the table's body, TOML.
 * @returns the parsed config.
 */
function config(rules: string): ReturnType<typeof parseConfig> {
  return parseConfig(`${LAYERS}\n[tool.inwards.rules]\n${rules}\n`);
}

/**
 * Checks one API module and lists what it reports.
 *
 * @param text - the module's source.
 * @param rules - the `[tool.inwards.rules]` body, TOML.
 * @returns `line:code:severity` of each diagnostic.
 */
async function found(text: string, rules = ""): Promise<string[]> {
  const engine = await Engine.create(grammars(), config(rules));
  return engine
    .checkFiles([file("shop/api/http.py", text)], PROJECT)
    .map((d) => `${d.line}:${d.code}:${d.severity}`);
}

describe("the FAPI codes", () => {
  test("are registered, opt-in, under their names", () => {
    expect(FAPI.map((code) => Object.entries(RULES).find(([key]) => key === code)?.[1])).toEqual(
      FAPI.map((code) => expect.objectContaining({ code, default: "off" })),
    );
    expect(FAPI.map((code) => Object.values(RULES).find((r) => r.code === code)?.name)).toEqual([
      "endpoint-metadata",
      "undocumented-error-response",
      "router-wiring",
      "route-shadowing",
    ]);
  });

  test("appear in SARIF rules[] with enabled = false", () => {
    const report = { diagnostics: [], filesChecked: 0, durationMs: 0 };
    const { rules } = JSON.parse(render(report, "sarif")).runs[0].tool.driver;
    const fapi = rules.filter((r: { id: string }) => r.id.startsWith("FAPI"));
    expect(
      fapi.map((r: { id: string; defaultConfiguration: object }) => [r.id, r.defaultConfiguration]),
    ).toEqual(FAPI.map((code) => [code, { enabled: false, level: "error" }]));
  });

  test("are off unless extend-select turns one on", () => {
    expect(FAPI.map((code) => ruleLevel(code, undefined))).toEqual(["off", "off", "off", "off"]);
    const on = config('extend-select = ["FAPI001"]').rules;
    expect(FAPI.map((code) => ruleLevel(code, on))).toEqual([undefined, "off", "off", "off"]);
  });

  test("take an options table by rule name", () => {
    const parsed = config(
      'extend-select = ["FAPI003"]\nrouter-wiring = { modules = ["shop.api"] }',
    );
    expect(JSON.stringify(parsed.rules?.options)).toBe(
      '{"router-wiring":{"modules":["shop.api"]}}',
    );
  });

  test("an unknown FAPI999 is a config error", () => {
    expect(() => config('extend-select = ["FAPI999"]')).toThrow(ConfigError);
    expect(() => config('extend-select = ["FAPI999"]')).toThrow(
      'Unknown rule code "FAPI999" in tool.inwards.rules.extend-select',
    );
  });
});

describe("an inline suppression of a FAPI code", () => {
  test("hides the finding on its line", () => {
    const text = `@router.get("/orders")  # inwards: ignore[FAPI002] ${REASON}\nasync def orders(): ...\n`;
    const src = file("shop/api/http.py", text);
    const span = { line: 1, column: 1, endLine: 1, endColumn: 23 };
    const finding = diagnostic(RULES.FAPI002, src, {
      span,
      message: "m",
      fix: { summary: "s", steps: [] },
    });
    const on = config('extend-select = ["FAPI002"]').rules;
    const { kept, suppressed } = suppress(parser, src, { found: [finding] }, on);
    expect([kept, suppressed.map((s) => `${s.diagnostic.code}:${s.reason}`)]).toEqual([
      [],
      ["FAPI002:documented in the gateway"],
    ]);
  });

  test("is valid while the rule is off, and unused (a warning) once it is on", async () => {
    const text = `x = 1  # inwards: ignore[FAPI002] ${REASON}\n`;
    expect(await found(text)).toEqual([]);
    expect(await found(text, 'extend-select = ["FAPI002"]')).toEqual(["1:INW009:warning"]);
  });

  test("of FAPI999 is an INW009 error that lists the FAPI codes", async () => {
    const engine = await Engine.create(grammars(), config(""));
    const [d] = engine.checkFiles(
      [file("shop/api/http.py", `x = 1  # inwards: ignore[FAPI999] ${REASON}\n`)],
      PROJECT,
    );
    expect([d?.code, d?.severity]).toEqual(["INW009", "error"]);
    expect(d?.message).toContain("FAPI999 is not a rule this Inwards knows");
    expect(d?.message).toContain("INW011, FAPI001, FAPI002, FAPI003, FAPI005.");
  });
});
