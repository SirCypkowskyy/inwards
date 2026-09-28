/**
 * @file What a FAPI002 finding looks like to an agent (#183): the fix names
 * each code's source file and line (a snapshot), the finding renders in JSON
 * and SARIF like any other, an inline suppression on the decorator line hides
 * it, and `severity` re-levels it. The project raises one code in a helper
 * and one through an app handler, so both kinds of origin show.
 */
import { describe, expect, test } from "bun:test";
import { render } from "../../../src/index.ts";
import { checkProject, ERRORS, HEAD, MAIN } from "./fixture.ts";

describe("FAPI002 findings", () => {
  const project = {
    "app/__init__.py": "",
    "app/main.py": MAIN,
    "app/errors.py": `from fastapi import HTTPException\n\n${ERRORS}`,
    "app/orders.py": `${HEAD}from app.errors import OutOfStock


def load_or_404(id):
    raise HTTPException(404)


@router.post("/orders", status_code=201)
async def create_order(id: int) -> OrderOut:
    load_or_404(id)
    raise OutOfStock()
`,
  };
  const rules = '[tool.inwards.rules]\nextend-select = ["FAPI002"]';

  test("name each code's source file and line", async () => {
    const [d] = await checkProject(project, rules);
    expect(d).toMatchSnapshot();
  });

  test("render in JSON and SARIF like any finding", async () => {
    const diagnostics = await checkProject(project, rules);
    const report = { diagnostics, filesChecked: 4, durationMs: 0 };
    const json = JSON.parse(render(report, "json"));
    expect(json.diagnostics.map((d: { code: string; line: number }) => [d.code, d.line])).toEqual([
      ["FAPI002", 13],
    ]);
    const [sarif] = JSON.parse(render(report, "sarif")).runs;
    expect(
      sarif.results.map((r: { ruleId: string; level: string }) => [r.ruleId, r.level]),
    ).toEqual([["FAPI002", "error"]]);
    const rule = sarif.tool.driver.rules.find((r: { id: string }) => r.id === "FAPI002");
    expect(rule.defaultConfiguration).toEqual({ enabled: false, level: "error" });
  });

  test("an inline suppression on the decorator line hides it", async () => {
    const orders = project["app/orders.py"].replace(
      '@router.post("/orders", status_code=201)',
      '@router.post("/orders", status_code=201)  # inwards: ignore[FAPI002] reason="documented by the gateway"',
    );
    expect(await checkProject({ ...project, "app/orders.py": orders }, rules)).toEqual([]);
  });

  test("severity re-levels it", async () => {
    const found = await checkProject(project, `${rules}\nseverity = { FAPI002 = "warning" }`);
    expect(found.map((d) => d.severity)).toEqual(["warning"]);
  });
});
