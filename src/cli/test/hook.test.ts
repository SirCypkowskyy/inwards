import { describe, expect, test } from "bun:test";
import { mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { inwards, LAYERS, payload, project, type RunResult } from "./run.ts";

// Exit codes and output shape for the common paths are pinned by e2e.test.ts.
// These are the edge cases around what gets checked at all.
function hook(root: string, stdin: string): RunResult {
  return inwards(["hook", "claude-code"], { cwd: root, stdin });
}

function at(root: string, filePath: string, extra: Record<string, unknown> = {}): string {
  return payload("post-write-order", root, { tool_input: { file_path: filePath }, ...extra });
}

const PATH_SEPARATOR = /[\\/]/u;
const LEAK = "import shop.infrastructure.db\n";
const SILENT = { code: 0, stdout: "", stderr: "" };

describe("inwards hook claude-code", () => {
  test("a clean file passes silently", () => {
    const root = project({ "pyproject.toml": LAYERS, "shop/domain/order.py": "X = 1\n" });
    expect(hook(root, payload("post-edit-order", root))).toEqual(SILENT);
  });

  test("a relative file_path resolves against the payload cwd", () => {
    const root = project({ "pyproject.toml": LAYERS, "shop/domain/order.py": LEAK });
    expect(hook(root, at(root, "shop/domain/order.py")).code).toBe(2);
  });

  test("without cwd in the payload, the process cwd is used", () => {
    const root = project({ "pyproject.toml": LAYERS, "shop/domain/order.py": LEAK });
    expect(hook(root, at(root, "shop/domain/order.py", { cwd: undefined })).code).toBe(2);
  });

  test("files outside the project are not checked, whether absolute, via .. or via a symlink", () => {
    const root = project({ "pyproject.toml": LAYERS });
    const other = project({ "pyproject.toml": LAYERS, "shop/domain/order.py": LEAK });
    mkdirSync(join(root, "shop/domain"), { recursive: true });
    symlinkSync(join(other, "shop/domain/order.py"), join(root, "shop/domain/linked.py"));
    const dotdot = join(
      root,
      "..",
      other.split(PATH_SEPARATOR).at(-1) ?? "",
      "shop/domain/order.py",
    );
    for (const path of [join(other, "shop/domain/order.py"), dotdot, "shop/domain/linked.py"]) {
      expect(hook(root, at(root, path))).toEqual(SILENT);
    }
  });

  test("CLAUDE_PROJECT_DIR is the boundary when set", () => {
    const root = project({ "pyproject.toml": LAYERS, "shop/domain/order.py": LEAK });
    const elsewhere = project({});
    const input = at(root, join(root, "shop/domain/order.py"));
    function run(dir: string): RunResult {
      return inwards(["hook", "claude-code"], {
        cwd: root,
        stdin: input,
        env: { CLAUDE_PROJECT_DIR: dir },
      });
    }
    expect(run(root).code).toBe(2);
    expect(run(elsewhere)).toEqual(SILENT);
  });

  test("a directory named like a Python file is not walked", () => {
    const root = project({ "pyproject.toml": LAYERS, "shop/domain/order.py/x.py": LEAK });
    expect(hook(root, at(root, join(root, "shop/domain/order.py")))).toEqual(SILENT);
  });

  test("in a monorepo the config nearest to the file wins", () => {
    const root = project({
      "pyproject.toml": "[project]\nname = 'mono'\n",
      "pkg/pyproject.toml": LAYERS,
      "pkg/shop/domain/order.py": LEAK,
    });
    const { code, stderr } = hook(root, at(root, join(root, "pkg/shop/domain/order.py")));
    expect(code).toBe(2);
    expect(JSON.parse(stderr).diagnostics[0].module).toBe("shop.domain.order");
  });

  test("files outside the configured root are not modules of the project", () => {
    const root = project({
      "pyproject.toml": LAYERS.replace("[tool.inwards]", '[tool.inwards]\nroot = "src"'),
      "shop/domain/order.py": LEAK,
    });
    expect(hook(root, at(root, join(root, "shop/domain/order.py")))).toEqual(SILENT);
  });

  test("a project without [tool.inwards] is left alone (the hook may be user-wide)", () => {
    const root = project({ "shop/domain/order.py": LEAK });
    expect(hook(root, payload("post-write-order", root))).toEqual(SILENT);
  });

  test("a null payload is the host's problem: exit 1", () => {
    const root = project({ "pyproject.toml": LAYERS });
    expect(hook(root, "null").code).toBe(1);
  });
});
