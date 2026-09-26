/**
 * Inline suppressions (#50, ADR-028) through the CLI and the Claude Code
 * hooks: the check's summary and SARIF, and `agent-suppressions`, which by
 * default keeps an agent from silencing a violation with a comment.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { denied, pre } from "./guard-helpers.ts";
import { inwards, LAYERS, payload, project, type RunResult } from "./run.ts";
import { ID, put, session, stop } from "./stop-helpers.ts";

const ORDER = "shop/domain/order.py";
const HIDE = '# inwards: ignore[INW001] reason="legacy, tracked in #12"';
const SUPPRESSED = `import shop.infrastructure.db  ${HIDE}\n`;
const ALLOW = `${LAYERS}agent-suppressions = "allow"\n`;

/**
 * Whether this git has `--no-lazy-fetch` (2.44+). Without it the hooks can't
 * read a file's start content, so every suppression counts as new.
 */
const NO_LAZY_FETCH = Bun.spawnSync(["git", "--no-lazy-fetch", "version"]).exitCode === 0;

/**
 * Writes a file the way an agent's Write tool does, then sends PostToolUse.
 *
 * @param root - the project directory.
 * @param text - the new content of the domain module.
 * @param env - extra environment.
 * @returns the hook's exit code and output.
 */
function agentWrites(root: string, text: string, env: Record<string, string> = {}): RunResult {
  put(root, ORDER, text);
  const input = payload("post-write-order", root, {
    session_id: ID,
    tool_input: { file_path: join(root, ORDER) },
  });
  return inwards(["hook", "claude-code"], { cwd: root, stdin: input, env });
}

describe("inwards check", () => {
  test("a valid suppression passes and is counted", () => {
    const root = project({ "pyproject.toml": LAYERS, [ORDER]: SUPPRESSED });
    const text = inwards(["check"], { cwd: root });
    expect(text.code).toBe(0);
    expect(text.stdout).toContain("1 finding suppressed by inline comments.");
    const json = JSON.parse(inwards(["check", "--format", "json"], { cwd: root }).stdout);
    expect(json.summary).toMatchObject({ violations: 0, suppressed: 1 });
    expect(json.diagnostics).toEqual([]);
  });

  test("SARIF keeps the suppressed finding, with the reason as justification", () => {
    const root = project({ "pyproject.toml": LAYERS, [ORDER]: SUPPRESSED });
    const sarif = JSON.parse(inwards(["check", "--format", "sarif"], { cwd: root }).stdout);
    const [result] = sarif.runs[0].results;
    expect(result).toMatchObject({
      ruleId: "INW001",
      suppressions: [{ kind: "inSource", justification: "legacy, tracked in #12" }],
    });
    expect(sarif.runs[0].tool.driver.rules.map((r: { id: string }) => r.id)).toContain("INW009");
  });

  test("a reasonless or unknown-code suppression fails with INW009 next to the violation", () => {
    for (const comment of ["# inwards: ignore[INW001]", '# inwards: ignore[INW042] reason="x"']) {
      const root = project({
        "pyproject.toml": LAYERS,
        [ORDER]: `import shop.infrastructure.db  ${comment}\n`,
      });
      const { code, stdout } = inwards(["check", "--format", "json"], { cwd: root });
      expect(code).toBe(1);
      const codes = JSON.parse(stdout).diagnostics.map((d: { code: string }) => d.code);
      expect(codes).toEqual(["INW001", "INW009"]);
    }
  });
});

describe("agent-suppressions in the Claude Code hooks", () => {
  test("by default, a suppression the agent adds blocks the edit and the Stop gate", () => {
    const root = session();
    const edit = agentWrites(root, SUPPRESSED);
    expect(edit.code).toBe(2);
    expect(edit.stderr).toContain("wasn't in the file when the session started");
    expect(edit.stderr).toContain('"code":"INW001"');
    const gate = stop(root);
    expect(gate.code).toBe(2);
    expect(gate.stderr).toContain("wasn't in the file when the session started");
    expect(gate.stderr).toContain('"code":"INW001"');
  });

  test('with agent-suppressions = "allow", the agent\'s suppression counts', () => {
    const root = session({ "pyproject.toml": ALLOW, "shop/infrastructure/db.py": "" });
    expect(agentWrites(root, SUPPRESSED).code).toBe(0);
    expect(stop(root).code).toBe(0);
  });

  test("a reasonless suppression blocks in either mode", () => {
    const root = session({ "pyproject.toml": ALLOW, "shop/infrastructure/db.py": "" });
    const edit = agentWrites(root, "import shop.infrastructure.db  # inwards: ignore[INW001]\n");
    expect(edit.code).toBe(2);
    expect(edit.stderr).toContain('"code":"INW009"');
    expect(stop(root).code).toBe(2);
  });

  test("the guard denies an edit to agent-suppressions", () => {
    const root = project({ "pyproject.toml": LAYERS });
    const edit = {
      file_path: "pyproject.toml",
      old_string: "[tool.inwards]\n",
      new_string: '[tool.inwards]\nagent-suppressions = "allow"\n',
    };
    expect(denied(pre(root, "Edit", edit))).toBeDefined();
  });

  test("allow written through Bash mid-session changes nothing, and fails the Stop gate", () => {
    const root = session();
    put(root, "pyproject.toml", ALLOW);
    expect(agentWrites(root, SUPPRESSED).code).toBe(2);
    const gate = stop(root);
    expect(gate.code).toBe(2);
    expect(gate.stderr).toContain("[tool.inwards] changed");
  });

  test("the run log records the rejection, and stats counts it once", () => {
    const root = session();
    const env = { INWARDS_RUN_LOG: "1" };
    agentWrites(root, SUPPRESSED, env);
    agentWrites(root, `${SUPPRESSED}X = 1\n`, env);
    const lines = readFileSync(join(root, ".inwards/runs.jsonl"), "utf8").trim().split("\n");
    const last = JSON.parse(lines.at(-1) ?? "{}");
    expect(last).toMatchObject({ event: "PostToolUse", suppressed: 0 });
    expect(last.rejected).toHaveLength(1);
    expect(last.fingerprints).toContain(last.rejected[0]);
    const stats = inwards(["stats", root, "--format", "json"], { cwd: root });
    expect(JSON.parse(stats.stdout).rejectedSuppressions).toBe(1);
    expect(inwards(["stats", root], { cwd: root }).stdout).toContain(
      "Inline suppressions the agent added and the hooks rejected: 1.",
    );
  });
});

describe.skipIf(!NO_LAZY_FETCH)("suppressions already in the file at session start", () => {
  const start = { [ORDER]: SUPPRESSED, "shop/infrastructure/cache.py": "" };

  test("still count after an unrelated edit, and the run log counts them", () => {
    const root = session(start);
    const edit = agentWrites(root, `${SUPPRESSED}\nTOTAL = 1\n`, { INWARDS_RUN_LOG: "1" });
    expect(edit.code).toBe(0);
    const lines = readFileSync(join(root, ".inwards/runs.jsonl"), "utf8").trim().split("\n");
    expect(JSON.parse(lines.at(-1) ?? "{}")).toMatchObject({ suppressed: 1, rejected: [] });
    expect(stop(root).code).toBe(0);
  });

  test("still count when only the reason changes", () => {
    const root = session(start);
    const edit = agentWrites(root, SUPPRESSED.replace("legacy", "old code"));
    expect(edit.code).toBe(0);
    expect(stop(root).code).toBe(0);
  });

  test("a copy on another import is the agent's, and blocks", () => {
    const root = session(start);
    const edit = agentWrites(root, `${SUPPRESSED}import shop.infrastructure.cache  ${HIDE}\n`);
    expect(edit.code).toBe(2);
    expect(edit.stderr).toContain("shop.infrastructure.cache");
    expect(edit.stderr).not.toContain('\\"shop.infrastructure.db\\"');
    expect(stop(root).code).toBe(2);
  });

  test("moved to another import, it no longer hides the first one or the second", () => {
    const root = session(start);
    const moved = `import shop.infrastructure.db\nimport shop.infrastructure.cache  ${HIDE}\n`;
    const edit = agentWrites(root, moved);
    expect(edit.code).toBe(2);
    expect(edit.stderr).toContain("shop.infrastructure.cache");
    expect(edit.stderr).toContain("shop.infrastructure.db");
  });

  test("a code added to an existing comment doesn't count", () => {
    const root = session(start);
    const widened = SUPPRESSED.replace("[INW001]", "[INW001,INW005]").replace(
      "import shop.infrastructure.db",
      "import shop.infrastructure.db; import sqlalchemy",
    );
    const edit = agentWrites(root, widened);
    expect(edit.code).toBe(2);
    expect(edit.stderr).toContain('"code":"INW005"');
    expect(edit.stderr).not.toContain('"code":"INW001"');
  });
});
