import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { inwards, LAYERS, payload, project } from "./run.ts";
import { ID, LEAK, put, session, stop } from "./stop-helpers.ts";

/**
 * The test layers with a `[tool.inwards.rules]` table.
 *
 * @param rules - the table's body, TOML.
 * @returns the pyproject.toml text.
 */
function configWith(rules: string): string {
  return `${LAYERS}\n[tool.inwards.rules]\n${rules}\n`;
}

/**
 * Creates a project with one INW001 violation and some rule settings.
 *
 * @param rules - the `[tool.inwards.rules]` body, TOML.
 * @returns the project directory.
 */
function leaking(rules: string): string {
  return project({
    "pyproject.toml": configWith(rules),
    "shop/infrastructure/db.py": "",
    "shop/domain/order.py": LEAK,
  });
}

/**
 * Runs `inwards check --format json` and reads the report.
 *
 * @param root - the project directory.
 * @returns the exit code, summary and `code:severity` of each diagnostic.
 */
function checkJson(root: string): { code: number; summary: object; found: string[] } {
  const { code, stdout } = inwards(["check", "--format", "json"], { cwd: root });
  const report: { summary: object; diagnostics: { code: string; severity: string }[] } =
    JSON.parse(stdout);
  return {
    code,
    summary: report.summary,
    found: report.diagnostics.map((d) => `${d.code}:${d.severity}`),
  };
}

describe("[tool.inwards.rules] in inwards check", () => {
  test("a rule downgraded to a warning is reported but doesn't fail the check", () => {
    const { code, summary, found } = checkJson(leaking('severity = { INW001 = "warning" }'));
    expect(code).toBe(0);
    expect(found).toEqual(["INW001:warning"]);
    expect(summary).toMatchObject({ violations: 0, warnings: 1 });
  });

  test("an ignored rule reports nothing", () => {
    const { code, found } = checkJson(leaking('ignore = ["INW001"]'));
    expect(code).toBe(0);
    expect(found).toEqual([]);
  });

  test("a rule left out of select reports nothing; a selected one still fails", () => {
    expect(checkJson(leaking('select = ["INW005"]'))).toMatchObject({ code: 0, found: [] });
    expect(checkJson(leaking('select = ["INW001"]'))).toMatchObject({
      code: 1,
      found: ["INW001:error"],
    });
  });

  test("SARIF keeps the registry's default in rules[] and the configured level on the result", () => {
    const root = leaking('severity = { INW001 = "warning" }');
    const { stdout } = inwards(["check", "--format", "sarif"], { cwd: root });
    const [run] = JSON.parse(stdout).runs;
    const rule = run.tool.driver.rules.find((r: { id: string }) => r.id === "INW001");
    expect(rule.defaultConfiguration.level).toBe("error");
    expect(run.results.map((r: { level: string }) => r.level)).toEqual(["warning"]);
  });

  test("an unknown code is a config error, exit 2", () => {
    const { code, stderr } = inwards(["check"], { cwd: leaking('ignore = ["INW999"]') });
    expect(code).toBe(2);
    expect(stderr).toContain('Unknown rule code "INW999" in tool.inwards.rules.ignore');
  });
});

describe("[tool.inwards.rules] and the baseline", () => {
  test("entries of an ignored rule stay dormant instead of counting as fixed", () => {
    const root = leaking('select = ["INW001"]');
    expect(inwards(["baseline"], { cwd: root }).code).toBe(0);
    put(root, "pyproject.toml", configWith('ignore = ["INW001"]'));
    expect(checkJson(root)).toMatchObject({ code: 0, summary: { baselined: 0, resolved: 0 } });
    put(root, "pyproject.toml", configWith('select = ["INW001"]'));
    expect(checkJson(root)).toMatchObject({ code: 0, summary: { baselined: 1, resolved: 0 } });
  });

  test("an entry taken while a rule was raised to error isn't fixed when the rule is back at warning", () => {
    const root = project({
      "pyproject.toml": configWith('severity = { INW006 = "error" }'),
      "shop/domain/order.py": "",
      "shop/infrastructure/db.py": "",
      "tools/run.py": "",
    });
    expect(inwards(["baseline"], { cwd: root }).code).toBe(0);
    put(root, "pyproject.toml", LAYERS);
    expect(checkJson(root)).toMatchObject({
      code: 0,
      summary: { baselined: 0, resolved: 0 },
      found: ["INW006:warning"],
    });
  });
});

describe("[tool.inwards.rules] in the Claude Code hooks", () => {
  const downgraded = configWith('severity = { INW001 = "warning" }');

  test("a warning doesn't block the edit or the Stop gate", () => {
    const root = session({ "pyproject.toml": downgraded, "shop/infrastructure/db.py": "" });
    put(root, "shop/domain/order.py", LEAK);
    const post = payload("post-write-order", root, {
      session_id: ID,
      tool_input: { file_path: join(root, "shop/domain/order.py") },
    });
    const edit = inwards(["hook", "claude-code"], { cwd: root, stdin: post });
    expect(edit.code).toBe(0);
    expect(edit.stdout).toContain("INW001");
    expect(stop(root).code).toBe(0);
  });

  test("an agent that turns a rule off through Bash fails the Stop gate", () => {
    const root = session();
    put(root, "shop/domain/order.py", LEAK);
    put(root, "pyproject.toml", configWith('ignore = ["INW001"]'));
    const { code, stderr } = stop(root);
    expect(code).toBe(2);
    expect(stderr).toContain("[tool.inwards] changed");
  });
});
