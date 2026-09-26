import { describe, expect, test } from "bun:test";
import { lstatSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { inwards, LAYERS, payload, project } from "./run.ts";
import { agentWrites, LEAK, put, session, stop } from "./stop-helpers.ts";

const BASELINE = "inwards-baseline.json";
const LAST_BRACKET = /\]\n$/u;

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

  test("adding an unrelated layer keeps the violation accepted", () => {
    const root = legacy();
    const api = '  { name = "api", modules = ["shop.api"] },\n]';
    put(root, "pyproject.toml", LAYERS.replace(LAST_BRACKET, api));
    put(root, "shop/api/routes.py", "");
    const { code, stdout } = inwards(["check", "--format", "json"], { cwd: root });
    expect(code).toBe(0);
    expect(summary(stdout)).toMatchObject({ violations: 0, baselined: 1, resolved: 0 });
  });

  test("writing the baseline replaces a planted symlink instead of following it", () => {
    const root = project({ "pyproject.toml": LAYERS, "shop/domain/order.py": LEAK });
    writeFileSync(join(root, "victim.txt"), "keep me\n");
    symlinkSync(join(root, "victim.txt"), join(root, BASELINE));
    expect(inwards(["baseline"], { cwd: root }).code).toBe(0);
    expect(readFileSync(join(root, "victim.txt"), "utf8")).toBe("keep me\n");
    expect(lstatSync(join(root, BASELINE)).isSymbolicLink()).toBe(false);
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
    expect(stderr).not.toContain("git checkout");
  });

  test("a broken baseline still blocks, and new violations are reported", () => {
    for (const plant of ["{", "dir"]) {
      const root = baselinedSession();
      agentWrites(root, "shop/domain/pay.py", LEAK);
      rmSync(join(root, BASELINE));
      if (plant === "dir") {
        mkdirSync(join(root, BASELINE));
      } else {
        writeFileSync(join(root, BASELINE), plant);
      }
      const { code, stderr } = stop(root);
      expect(code).toBe(2);
      expect(stderr).toContain("inwards-baseline.json changed");
      expect(stderr).toContain("shop.domain.pay");
    }
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
    expect(run("Bash", { command: "uvx --from inwards inwards baseline" })).toContain("deny");
    expect(run("Bash", { command: "env FOO=1 inwards hook claude-code" })).toContain("deny");
    for (const denied of [
      "python3 -m inwards baseline",
      "uv run --with x inwards baseline",
      "uvx inwards@latest baseline",
      "sudo -u me inwards hook claude-code",
      "bash -c 'inwards baseline'",
      "x; ./bin/inwards baseline",
      "echo $(inwards baseline)",
      "(inwards hook claude-code < fake.json)",
      'git commit -m "docs: `inwards baseline`"',
    ]) {
      expect(run("Bash", { command: denied })).toContain("deny");
    }
    const started = performance.now();
    expect(run("Bash", { command: `${"env -a ".repeat(40)}x; inwards baseline` })).toContain(
      "deny",
    );
    expect(run("Bash", { command: `${"env -a ".repeat(5000)}inwards baseline` })).toContain("deny");
    expect(performance.now() - started).toBeLessThan(2000);
    for (const allowed of [
      'git commit -m "docs: explain inwards baseline"',
      "git commit -m \"$(cat <<'EOF'\nfeat(cli): inwards baseline accepts existing violations\nEOF\n)\"",
      "gh pr create --body \"$(cat <<'EOF'\n- adds inwards baseline for legacy code\nEOF\n)\"",
      "grep -n inwards hook.ts",
      "gh pr create --body \"$(cat <<'EOF'\n- `inwards baseline [--config]` runs a check\nrun inwards baseline first\nEOF\n)\"",
      "git commit -m 'docs: explain `inwards hook claude-code`'",
      "rg inwards baseline.ts",
    ]) {
      expect(run("Bash", { command: allowed })).toBe("");
    }
    expect(run("Bash", { command: `cat ${BASELINE}` })).toBe("");
  });
});
