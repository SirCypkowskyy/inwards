import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { inwards, LAYERS, payload, project } from "./run.ts";

const hook = (root: string, stdin: string) =>
  inwards(["hook", "claude-code"], { cwd: root, stdin });

const LEAK = "import shop.infrastructure.db\n";

describe("inwards hook claude-code", () => {
  test("a violation goes to stderr as compact JSON with exit 2", () => {
    const root = project({ "pyproject.toml": LAYERS, "shop/domain/order.py": LEAK });
    const { code, stdout, stderr } = hook(root, payload("post-write-order", root));
    expect(code).toBe(2);
    expect(stdout).toBe("");
    expect(stderr.trim().split("\n")).toHaveLength(1);
    const report = JSON.parse(stderr);
    expect(report.schema).toBe("inwards/diagnostics@1");
    expect(report.diagnostics[0]).toMatchObject({ code: "INW001", file: "shop/domain/order.py" });
  });

  test("a clean file passes silently", () => {
    const root = project({ "pyproject.toml": LAYERS, "shop/domain/order.py": "X = 1\n" });
    expect(hook(root, payload("post-edit-order", root))).toEqual({
      code: 0,
      stdout: "",
      stderr: "",
    });
  });

  test("non-Python files and other events are ignored", () => {
    const root = project({ "pyproject.toml": LAYERS, "shop/domain/order.py": LEAK });
    for (const name of ["post-write-readme", "session-start", "pre-write-order", "stop"]) {
      expect(hook(root, payload(name, root))).toEqual({ code: 0, stdout: "", stderr: "" });
    }
  });

  test("a relative file_path resolves against the payload cwd", () => {
    const root = project({ "pyproject.toml": LAYERS, "shop/domain/order.py": LEAK });
    const input = payload("post-write-order", root, {
      tool_input: { file_path: "shop/domain/order.py" },
    });
    expect(hook(root, input).code).toBe(2);
  });

  test("files outside the project are not checked, even through ..", () => {
    const root = project({ "pyproject.toml": LAYERS });
    const other = project({ "pyproject.toml": LAYERS, "shop/domain/order.py": LEAK });
    for (const file_path of [
      join(other, "shop/domain/order.py"),
      join(root, "..", other.split(/[\\/]/).at(-1) ?? "", "shop/domain/order.py"),
    ]) {
      const input = payload("post-write-order", root, { tool_input: { file_path } });
      expect(hook(root, input)).toEqual({ code: 0, stdout: "", stderr: "" });
    }
  });

  test("a broken config reaches the agent", () => {
    const root = project({
      "pyproject.toml": "[tool.inwards]\nlayers = []\n",
      "shop/domain/order.py": LEAK,
    });
    const { code, stderr } = hook(root, payload("post-write-order", root));
    expect(code).toBe(2);
    expect(stderr).toContain("tool.inwards.layers");
  });

  test("a missing config reaches the agent", () => {
    const root = project({ "shop/domain/order.py": LEAK });
    const { code, stderr } = hook(root, payload("post-write-order", root));
    expect(code).toBe(2);
    expect(stderr).toContain("[tool.inwards]");
  });

  test("garbage on stdin is the host's problem: exit 1, not 2", () => {
    const root = project({ "pyproject.toml": LAYERS });
    expect(hook(root, "not json").code).toBe(1);
  });
});
