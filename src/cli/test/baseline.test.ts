import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { inwards, LAYERS, payload, project } from "./run.ts";
import { agentWrites, LEAK, put, session, stop } from "./stop-helpers.ts";

const BASELINE = "inwards-baseline.json";

/**
 * Creates a project with one legacy violation and takes its baseline.
 *
 * @returns the project directory.
 */
function legacy(): string {
  const root = project({ "pyproject.toml": LAYERS, "shop/domain/order.py": LEAK });
  const { code, stdout } = inwards(["baseline"], { cwd: root });
  if (code !== 0 || !stdout.includes("1 violation")) {
    throw new Error(`inwards baseline exited ${code}: ${stdout}`);
  }
  return root;
}

/**
 * Reads a JSON report's summary.
 *
 * @param stdout - `inwards check --format json` output.
 * @returns the summary object.
 */
function summary(stdout: string): Record<string, number> {
  return JSON.parse(stdout).summary;
}

describe("inwards baseline", () => {
  test("writes the violations, and check then passes", () => {
    const root = legacy();
    const file = JSON.parse(readFileSync(join(root, BASELINE), "utf8"));
    expect(file.schema).toBe("inwards/baseline@1");
    expect(file.violations).toEqual([
      expect.objectContaining({ code: "INW001", module: "shop.domain.order", count: 1 }),
    ]);
    const { code, stdout } = inwards(["check", "--format", "json"], { cwd: root });
    expect(code).toBe(0);
    expect(summary(stdout)).toMatchObject({ violations: 0, baselined: 1, resolved: 0 });
  });

  test("a baselined import moved to another line still passes", () => {
    const root = legacy();
    put(root, "shop/domain/order.py", `"""Orders."""\n\nX = 1\n${LEAK}`);
    expect(inwards(["check"], { cwd: root }).code).toBe(0);
  });

  test("a new violation fails, and so does a second copy of a baselined one", () => {
    const root = legacy();
    put(root, "shop/domain/pay.py", LEAK);
    const { code, stdout } = inwards(["check", "--format", "json"], { cwd: root });
    expect(code).toBe(1);
    expect(JSON.parse(stdout).diagnostics.map((d: { module: string }) => d.module)).toEqual([
      "shop.domain.pay",
    ]);
    const twice = legacy();
    put(twice, "shop/domain/order.py", `${LEAK}from shop.infrastructure import db\n`);
    expect(inwards(["check"], { cwd: twice }).code).toBe(1);
  });

  test("a fixed violation is reported as resolved", () => {
    const root = legacy();
    put(root, "shop/domain/order.py", "X = 1\n");
    const { code, stdout } = inwards(["check"], { cwd: root });
    expect(code).toBe(0);
    expect(stdout).toContain("1 baselined violation fixed since");
  });

  test("checking one file applies the baseline too", () => {
    const root = legacy();
    expect(inwards(["check", "shop/domain/order.py"], { cwd: root }).code).toBe(0);
  });

  test("no baseline file changes nothing, and a broken one is a config error", () => {
    const root = project({ "pyproject.toml": LAYERS, "shop/domain/order.py": LEAK });
    expect(inwards(["check"], { cwd: root }).code).toBe(1);
    writeFileSync(join(root, BASELINE), "{}");
    const { code, stderr } = inwards(["check"], { cwd: root });
    expect(code).toBe(2);
    expect(stderr).toContain("inwards baseline");
  });
});

describe("baseline with the Claude Code hooks", () => {
  /**
   * A started session whose project already had a baselined violation.
   *
   * @returns the project directory.
   */
  function baselinedSession(): string {
    const text = readFileSync(join(legacy(), BASELINE), "utf8");
    return session({ "shop/domain/order.py": LEAK, [BASELINE]: text });
  }

  test("editing a file with a baselined violation doesn't block", () => {
    const root = baselinedSession();
    agentWrites(root, "shop/domain/order.py", `X = 2\n${LEAK}`);
    expect(stop(root).code).toBe(0);
  });

  test("a new violation next to it still blocks", () => {
    const root = baselinedSession();
    agentWrites(root, "shop/domain/pay.py", LEAK);
    expect(stop(root).code).toBe(2);
  });

  test("a baseline changed during the session blocks the Stop", () => {
    const root = baselinedSession();
    put(root, BASELINE, '{"schema": "inwards/baseline@1", "violations": []}\n');
    const { code, stderr } = stop(root);
    expect(code).toBe(2);
    expect(stderr).toContain("inwards-baseline.json changed");
  });

  test("the guard denies editing the baseline", () => {
    const root = baselinedSession();
    /**
     * Sends a PreToolUse event.
     *
     * @param tool - the tool name.
     * @param input - the tool input.
     * @returns the hook's stdout: the deny JSON, or empty.
     */
    function run(tool: string, input: Record<string, unknown>): string {
      const stdin = payload("pre-edit-order", root, { tool_name: tool, tool_input: input });
      return inwards(["hook", "claude-code"], { cwd: root, stdin }).stdout;
    }
    expect(run("Write", { file_path: join(root, BASELINE), content: "{}" })).toContain("deny");
    expect(run("Bash", { command: `echo '{}' > ${BASELINE}` })).toContain("deny");
    expect(run("Bash", { command: "inwards baseline" })).toContain("deny");
    expect(run("Bash", { command: `cat ${BASELINE}` })).toBe("");
  });
});
