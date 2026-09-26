import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Diagnostic } from "@inwards/core";
import { inwards, payload, project, type RunResult } from "./run.ts";
import { ID, put, session, stop } from "./stop-helpers.ts";

const SHAPES = join(import.meta.dir, "fixtures/shapes");

/**
 * Reads an example project from fixtures/shapes.
 *
 * @param name - `fastapi` or `clean-architecture`.
 * @returns its files, by project-relative path.
 */
function fixture(name: string): Record<string, string> {
  const dir = join(SHAPES, name);
  const files: Record<string, string> = {};
  for (const rel of readdirSync(dir, { recursive: true, encoding: "utf8" })) {
    if (rel.endsWith(".py") || rel.endsWith(".toml")) {
      files[rel.replaceAll("\\", "/")] = readFileSync(join(dir, rel), "utf8");
    }
  }
  return files;
}

/**
 * Runs `inwards check --format json` and parses the report.
 *
 * @param root - the project directory.
 * @returns the exit code and the diagnostics.
 */
function check(root: string): { code: number; diagnostics: Diagnostic[] } {
  const { code, stdout } = inwards(["check", "--format", "json"], { cwd: root });
  return { code, diagnostics: JSON.parse(stdout).diagnostics };
}

/**
 * Sends a PostToolUse event for one file in the test session.
 *
 * @param root - the project directory.
 * @param tool - `write` or `edit`, which recorded payload to use.
 * @param rel - the file, relative to the project.
 * @returns the hook's exit code and output.
 */
function posted(root: string, tool: "write" | "edit", rel: string): RunResult {
  const stdin = payload(`post-${tool}-order`, root, {
    session_id: ID,
    tool_input: { file_path: join(root, rel) },
  });
  return inwards(["hook", "claude-code"], { cwd: root, stdin });
}

describe("package shape: the example configs", () => {
  test.each(["fastapi", "clean-architecture"])(
    "%s passes inwards check with 0 findings",
    (name) => {
      expect(check(project(fixture(name)))).toEqual({ code: 0, diagnostics: [] });
    },
  );

  test("the guide shows the example configs as the fixtures hold them", () => {
    const guide = readFileSync(
      join(import.meta.dir, "../../../docs/chapters/guides/package-shape.md"),
      "utf8",
    );
    for (const name of ["fastapi", "clean-architecture"]) {
      const toml = fixture(name)["pyproject.toml"] ?? "";
      expect(guide).toContain(toml.slice(toml.indexOf("[tool.inwards]")).trim());
    }
  });

  test.each([
    ["app/orders/helpers.py", "utils.py"],
    ["app/orders/services/x.py", "service.py"],
    ["app/orders/test_x.py", "tests/"],
  ])("planting %s fails with INW007, and the fix names %s", (rel, target) => {
    const { code, diagnostics } = check(project({ ...fixture("fastapi"), [rel]: "" }));
    expect(code).toBe(1);
    expect(diagnostics.map((d) => [d.code, d.file])).toEqual([["INW007", rel]]);
    expect(diagnostics[0]?.fix.summary).toContain(target);
  });
});

describe("package shape: hooks", () => {
  test("a Write creating a disallowed file blocks; an Edit of a pre-existing one doesn't", () => {
    const root = session({ ...fixture("fastapi"), "app/orders/helpers.py": "" });
    put(root, "app/orders/misc.py", "");
    const created = posted(root, "write", "app/orders/misc.py");
    expect(created.code).toBe(2);
    expect(created.stderr).toContain('"code":"INW007"');
    rmSync(join(root, "app/orders/misc.py"));

    put(root, "app/orders/helpers.py", "X = 1\n");
    const edited = posted(root, "edit", "app/orders/helpers.py");
    expect(edited.code).toBe(0);
    expect(edited.stdout).toContain("INW007");
    expect(stop(root).code).toBe(0);
  });

  test("a new package's missing members are context at PostToolUse and block at Stop", () => {
    const root = session(fixture("fastapi"));
    put(root, "app/payments/router.py", "");
    const written = posted(root, "write", "app/payments/router.py");
    expect(written.code).toBe(0);
    expect(written.stdout).toContain("INW008");
    const gate = stop(root);
    expect(gate.code).toBe(2);
    expect(gate.stderr).toContain('Package \\"app.payments\\" has no \\"service\\" member');
  });

  test("Stop: deleting a required service.py blocks, a package that already lacked it doesn't", () => {
    const files = Object.entries(fixture("fastapi")).filter(
      ([rel]) => rel !== "app/auth/service.py",
    );
    const root = session(Object.fromEntries(files));
    expect(stop(root).code).toBe(0);
    rmSync(join(root, "app/orders/service.py")); // through Bash: no PostToolUse
    const gate = stop(root);
    expect(gate.code).toBe(2);
    expect(gate.stderr).toContain('"code":"INW008"');
    expect(gate.stderr).toContain("app/orders/__init__.py");
    expect(gate.stderr).not.toContain("app.auth");
  });

  test("the config guard denies an edit to [[tool.inwards.shape]]", () => {
    const root = project(fixture("fastapi"));
    const stdin = payload("pre-edit-order", root, {
      tool_name: "Edit",
      tool_input: {
        file_path: join(root, "pyproject.toml"),
        old_string: '"config", "constants", "exceptions", "utils",',
        new_string: '"config", "constants", "exceptions", "utils", "helpers",',
      },
    });
    const { stdout } = inwards(["hook", "claude-code"], { cwd: root, stdin });
    expect(JSON.parse(stdout).hookSpecificOutput.permissionDecision).toBe("deny");
  });
});
