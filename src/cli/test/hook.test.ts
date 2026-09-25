import { describe, expect, test } from "bun:test";
import { mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { inwards, LAYERS, payload, project, type RunResult } from "./run.ts";

// Exit codes and output shape for the common paths are pinned by e2e.test.ts.
// These are the edge cases around what gets checked at all.
/**
 * Runs `inwards hook claude-code` in a project with the given payload.
 *
 * @param root - the project directory, used as the working directory.
 * @param stdin - the payload text.
 * @returns the exit code and output.
 */
function hook(root: string, stdin: string): RunResult {
  return inwards(["hook", "claude-code"], { cwd: root, stdin });
}

/**
 * Builds a PostToolUse Write payload for one file path.
 *
 * @param root - the project root that `{{ROOT}}` expands to.
 * @param filePath - the `tool_input.file_path` to report, absolute or relative.
 * @param extra - top-level fields to override, e.g. `{ cwd: undefined }`.
 * @returns the payload as JSON text.
 */
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
    /**
     * Runs the hook with CLAUDE_PROJECT_DIR set.
     *
     * @param dir - the value for CLAUDE_PROJECT_DIR.
     * @returns the exit code and output.
     */
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

  test("the payload's cwd cannot move the boundary to another project", () => {
    const root = project({ "pyproject.toml": LAYERS });
    const other = project({ "pyproject.toml": LAYERS, "shop/domain/order.py": LEAK });
    const input = at(root, "shop/domain/order.py", { cwd: other });
    expect(hook(root, input)).toEqual(SILENT);
  });

  test("a symlinked config root still names modules correctly", () => {
    const root = project({
      "pyproject.toml": LAYERS.replace("[tool.inwards]", '[tool.inwards]\nroot = "src"'),
      "real/shop/domain/order.py": LEAK,
    });
    symlinkSync(join(root, "real"), join(root, "src"));
    const { code } = hook(root, at(root, join(root, "src/shop/domain/order.py")));
    expect(code).toBe(2);
  });

  test("a symlinked file is checked under the name Python imports it by", () => {
    const root = project({ "pyproject.toml": LAYERS, "shared/order.py": LEAK });
    mkdirSync(join(root, "shop/domain"), { recursive: true });
    symlinkSync(join(root, "shared/order.py"), join(root, "shop/domain/order.py"));
    const { code, stderr } = hook(root, at(root, join(root, "shop/domain/order.py")));
    expect(code).toBe(2);
    expect(JSON.parse(stderr).diagnostics[0].module).toBe("shop.domain.order");
  });

  test("a config outside the project is never read", () => {
    const outside = project({ "pyproject.toml": "[tool.inwards\nSECRET = 1\n" });
    const root = project({ "shop/domain/order.py": LEAK });
    symlinkSync(join(outside, "pyproject.toml"), join(root, "pyproject.toml"));
    expect(hook(root, payload("post-write-order", root))).toEqual(SILENT);
  });

  test("any valid TOML spelling of the table turns the hook on", () => {
    const root = project({
      "pyproject.toml": LAYERS.replace("[tool.inwards]", '["tool"."inwards"]'),
      "shop/domain/order.py": LEAK,
    });
    expect(hook(root, payload("post-write-order", root)).code).toBe(2);
  });

  test("a file declaring an unsafe encoding is reported, not passed", () => {
    const root = project({
      "pyproject.toml": LAYERS,
      "shop/domain/order.py": "# coding: unicode_escape\n#\\u000aimport shop.infrastructure.db\n",
    });
    const { code, stderr } = hook(root, payload("post-write-order", root));
    expect(code).toBe(2);
    expect(JSON.parse(stderr).diagnostics[0].code).toBe("INW000");
  });
});
