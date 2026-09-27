import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { LAYERS, project } from "../support/run.ts";
import { agentWrites, LEAK, put, session, stop } from "../support/stop-helpers.ts";

describe("Stop gate", () => {
  test("10 pre-existing violations and a clean agent edit: the turn may end", () => {
    const old: Record<string, string> = {};
    for (let i = 0; i < 10; i += 1) {
      old[`shop/domain/legacy${i}.py`] = LEAK;
    }
    const root = session(old);
    agentWrites(root, "shop/domain/order.py", "X = 2\n");
    expect(stop(root).code).toBe(0);
  });

  test("a violating agent edit blocks at most three times a turn, then tells the user", () => {
    const root = session();
    agentWrites(root, "shop/domain/order.py", LEAK);
    const first = stop(root);
    expect(first.code).toBe(2);
    expect(first.stderr).toContain('"code":"INW001"');
    expect(stop(root, { stop_hook_active: true }).code).toBe(2);
    const last = stop(root, { stop_hook_active: true });
    expect(last.code).toBe(2);
    expect(last.stderr).toContain("ask how to proceed");
    const yielded = stop(root, { stop_hook_active: true });
    expect(yielded.code).toBe(0);
    expect(JSON.parse(yielded.stdout).systemMessage).toContain("shop/domain/order.py");
    expect(stop(root).code).toBe(2); // a new turn starts the count again
  });

  test("a clean pass ends the streak, even if another hook keeps the turn going", () => {
    const root = session();
    agentWrites(root, "shop/domain/order.py", LEAK);
    for (const active of [false, true, true]) {
      expect(stop(root, { stop_hook_active: active }).code).toBe(2);
    }
    agentWrites(root, "shop/domain/order.py", "X = 2\n");
    expect(stop(root).code).toBe(0);
    agentWrites(root, "shop/domain/order.py", LEAK);
    expect(stop(root, { stop_hook_active: true }).code).toBe(2);
  });

  test("an old violation that imports the edited module doesn't block", () => {
    const root = session({
      "shop/domain/legacy.py": LEAK,
      "shop/infrastructure/db.py": "Y = 1\n",
    });
    agentWrites(root, "shop/infrastructure/db.py", "Y = 2\n");
    expect(stop(root).code).toBe(0);
  });

  test("a Bash sed on [tool.inwards] fails the gate", () => {
    const root = session();
    put(root, "pyproject.toml", LAYERS.replace('"shop.infrastructure"', '"shop.elsewhere"'));
    const { code, stderr } = stop(root);
    expect(code).toBe(2);
    expect(stderr).toContain("[tool.inwards] changed");
  });

  test("disableAllHooks in settings.local.json fails the gate", () => {
    const root = session();
    const path = join(root, ".claude/settings.local.json");
    const settings: Record<string, unknown> = JSON.parse(readFileSync(path, "utf8"));
    writeFileSync(path, JSON.stringify({ ...settings, disableAllHooks: true }));
    const { code, stderr } = stop(root);
    expect(code).toBe(2);
    expect(stderr).toContain("disableAllHooks");
  });

  test("removing the Inwards hooks fails the gate", () => {
    const root = session();
    writeFileSync(join(root, ".claude/settings.local.json"), "{}");
    expect(stop(root).stderr).toContain("missing from every Claude Code settings file");
  });

  test("without session state the gate fails closed, once", () => {
    const root = project({ "pyproject.toml": LAYERS, "shop/domain/order.py": "X = 1\n" });
    expect(stop(root).code).toBe(2);
    expect(stop(root, { stop_hook_active: true }).code).toBe(0);
  });

  test("a project without Inwards is never blocked", () => {
    const root = project({ "shop/domain/order.py": LEAK });
    expect(stop(root)).toEqual({ code: 0, stdout: "", stderr: "" });
  });
});
