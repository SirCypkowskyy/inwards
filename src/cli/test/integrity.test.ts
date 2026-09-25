import { describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { inwards, LAYERS, payload, project, type RunResult } from "./run.ts";
import { agentWrites, git, put, session, stop } from "./stop-helpers.ts";

const INTO_PERSISTENCE = "from shop.persistence import repo\n";

/**
 * Lists the codes and severities in a JSON report.
 *
 * @param json - `inwards/diagnostics@1` output.
 * @returns `code/severity` per diagnostic.
 */
function findings(json: string): string[] {
  const report: { diagnostics: { code: string; severity: string }[] } = JSON.parse(json);
  return report.diagnostics.map((d) => `${d.code}/${d.severity}`);
}

/**
 * Sends the PostToolUse event for a file the agent wrote.
 *
 * @param root - the project directory.
 * @param rel - the file, relative to the project.
 * @returns the hook's exit code and output.
 */
function hookWrite(root: string, rel: string): RunResult {
  return inwards(["hook", "claude-code"], {
    cwd: root,
    stdin: payload("post-write-order", root, { tool_input: { file_path: join(root, rel) } }),
  });
}

describe("INW006 in the CLI", () => {
  test("an import from the domain into an unlisted package fails the check", () => {
    const root = project({
      "pyproject.toml": LAYERS,
      "shop/domain/order.py": INTO_PERSISTENCE,
      "shop/persistence/repo.py": "",
    });
    const { code, stdout } = inwards(["check", "--format", "json"], { cwd: root });
    expect(code).toBe(1);
    expect(findings(stdout)).toEqual(["INW006/error", "INW006/warning"]);
  });

  test("a legacy project with unassigned tests and scripts only warns, and is quiet after init", () => {
    const root = project({
      "pyproject.toml": LAYERS,
      "shop/domain/order.py": "",
      "tests/test_order.py": "import shop.domain.order\n",
      "scripts/seed.py": "import shop.infrastructure.db\n",
      "conftest.py": "",
    });
    const before = inwards(["check", "--format", "json"], { cwd: root });
    expect(before.code).toBe(0);
    expect(findings(before.stdout)).toEqual(["INW006/warning", "INW006/warning", "INW006/warning"]);
    inwards(["init", "--agent", "agents-md"], { cwd: root });
    const after = inwards(["check", "--format", "json"], { cwd: root });
    expect(after).toMatchObject({ code: 0 });
    expect(findings(after.stdout)).toEqual([]);
  });

  test("a dead prefix warns and an empty layer fails, both pointing into pyproject.toml", () => {
    const root = project({
      "pyproject.toml": LAYERS.replace('["shop.domain"]', '["shop.domain", "shop.typo"]'),
      "shop/domain/order.py": "",
      "shop/infrastructure/db.py": "",
    });
    const { code, stdout } = inwards(["check", "--format", "json"], { cwd: root });
    expect(code).toBe(0);
    expect(findings(stdout)).toEqual(["INW006/warning"]);
    const empty = project({ "pyproject.toml": LAYERS, "shop/infrastructure/db.py": "" });
    expect(inwards(["check"], { cwd: empty }).code).toBe(1);
  });

  test("an unknown [tool.inwards] key is a config error", () => {
    const root = project({ "pyproject.toml": LAYERS.replace("layers =", "layer = 1\nlayers =") });
    const { code, stderr } = inwards(["check"], { cwd: root });
    expect(code).toBe(2);
    expect(stderr).toContain("Unknown key tool.inwards.layer");
  });

  test("the hook blocks an import into an unlisted package and passes a warning on as context", () => {
    const root = project({ "pyproject.toml": LAYERS, "shop/domain/order.py": INTO_PERSISTENCE });
    put(root, "shop/persistence/repo.py", "");
    const blocked = hookWrite(root, "shop/domain/order.py");
    expect(blocked.code).toBe(2);
    expect(findings(blocked.stderr)).toEqual(["INW006/error"]);
    const warned = hookWrite(root, "shop/persistence/repo.py");
    expect(warned.code).toBe(0);
    const context: { hookSpecificOutput: { additionalContext: string } } = JSON.parse(
      warned.stdout,
    );
    expect(findings(context.hookSpecificOutput.additionalContext)).toEqual(["INW006/warning"]);
  });
});

describe("INW006 in the Stop gate", () => {
  test("git mv of a layer's package during a session fails the gate", () => {
    const root = session();
    git(root, "mv", "shop/domain", "shop/core");
    const { code, stderr } = stop(root);
    expect(code).toBe(2);
    expect(stderr).toContain("matched modules when the session started");
  });

  test("a layer that was already empty at session start doesn't block", () => {
    const root = session({
      "pyproject.toml": LAYERS.replace('["shop.domain"]', '["shop.domain", "shop.model"]'),
    });
    agentWrites(root, "shop/domain/order.py", "X = 2\n");
    expect(stop(root).code).toBe(0);
  });

  test("a new unassigned package warns but doesn't block", () => {
    const root = session();
    agentWrites(root, "shop/persistence/repo.py", "X = 1\n");
    expect(stop(root).code).toBe(0);
  });
});

describe("INW006: moves the prefix check alone would miss", () => {
  test("an empty file left behind doesn't keep a moved layer alive", () => {
    const root = session();
    git(root, "mv", "shop/domain", "shop/core");
    agentWrites(root, "shop/domain/__init__.py", "");
    const { code, stderr } = stop(root);
    expect(code).toBe(2);
    expect(stderr).toContain("moved out of layer");
  });

  test("deleting a layer module and adding an ignored script is fine", () => {
    const root = session({
      "pyproject.toml": LAYERS.replace("[tool.inwards]", '[tool.inwards]\nignore = ["scripts"]'),
      "shop/domain/old.py": "",
      "shop/infrastructure/db.py": "",
    });
    rmSync(join(root, "shop/domain/old.py"));
    agentWrites(root, "scripts/seed.py", "");
    expect(stop(root).code).toBe(0);
  });

  test.each([
    ["a disguised directory", "shop/core", ["shop/core/pyvenv.cfg"]],
    ["a node_modules name", "shop/node_modules", []],
    ["an ignored directory", "shop/tests", []],
  ])("a layer moved into %s still fails the gate", (_, to, markers) => {
    const root = session({
      "pyproject.toml": LAYERS.replace("[tool.inwards]", '[tool.inwards]\nignore = ["tests"]'),
      "shop/infrastructure/db.py": "",
    });
    git(root, "mv", "shop/domain", to);
    for (const marker of markers) {
      put(root, marker, "");
    }
    agentWrites(root, "shop/domain/__init__.py", "");
    expect(stop(root).code).toBe(2);
  });

  test("an unrelated cleanup plus a new tooling file doesn't look like a move", () => {
    const root = session({ "shop/domain/old.py": "OLD = 1\n" });
    rmSync(join(root, "shop/domain/old.py"));
    agentWrites(root, "setup.py", "from setuptools import setup\n");
    expect(stop(root).code).toBe(0);
  });
});
