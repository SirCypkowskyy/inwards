/**
 * @file Package shape (INW007/INW008) in the example configs and the hooks. The
 * guide shows the fixtures' configs verbatim, and a Write that creates a
 * disallowed file blocks while an edit of a file that predates the session
 * doesn't.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, renameSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import type { Diagnostic } from "@inwards/core";
import { inwards, LAYERS, payload, project, type RunResult } from "../support/run.ts";
import { ID, put, session, stop } from "../support/stop-helpers.ts";

const SHAPES = join(import.meta.dir, "../support/fixtures/shapes");

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
      join(import.meta.dir, "../../../../docs/chapters/guides/package-shape.md"),
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

test("a renamed service.old.py is an unexpected member, and service is still missing", () => {
  const files = Object.entries(fixture("fastapi")).map(([rel, text]): [string, string] => [
    rel === "app/orders/service.py" ? "app/orders/service.old.py" : rel,
    text,
  ]);
  const { diagnostics } = check(project(Object.fromEntries(files)));
  expect(diagnostics.map((d) => [d.code, d.file])).toEqual([
    ["INW007", "app/orders/service.old.py"],
    ["INW008", "app/orders/__init__.py"],
  ]);
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

  test("context-only findings don't count toward escalation", () => {
    const root = session(fixture("fastapi"));
    for (const text of ["", "X = 1\n", "X = 2\n"]) {
      put(root, "app/payments/router.py", text);
      expect(posted(root, "write", "app/payments/router.py").code).toBe(0);
    }
    const gate = stop(root);
    expect(gate.code).toBe(2);
    expect(gate.stderr).toContain('"code":"INW008"');
    expect(gate.stderr).not.toContain("survived");
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

/** LAYERS, with `legacy` disallowed in the domain and in its subpackages. */
const SHAPED = `${LAYERS}
[[tool.inwards.shape]]
packages = ["shop.domain", "shop.domain.*"]
allow = ["order", "saved"]
`;

describe.skipIf(process.platform === "win32")(
  "package shape: the pre-existing excuse needs the file's start identity (#169)",
  () => {
    const Original = "shop/domain/original/legacy.py";

    /**
     * Starts a session on SHAPED with a legacy file that breaks the shape.
     *
     * @param rel - the legacy file, relative to the project.
     * @returns the project directory.
     */
    function legacy(rel: string): string {
      return session({
        "pyproject.toml": SHAPED,
        "shop/infrastructure/db.py": "",
        [rel]: "X = 1\n",
      });
    }

    /**
     * Sends PostToolUse with the payload's own cwd and file_path.
     *
     * @param root - the project directory, where the hook runs.
     * @param cwd - the payload's cwd.
     * @param file - the payload's file_path, as written.
     * @returns the hook's exit code and output.
     */
    function postedFrom(root: string, cwd: string, file: string): RunResult {
      const stdin = payload("post-edit-order", root, {
        session_id: ID,
        cwd,
        tool_input: { file_path: file },
      });
      return inwards(["hook", "claude-code"], { cwd: root, stdin });
    }

    test("PostToolUse through a symlinked directory the agent created blocks", () => {
      for (const file of ["../alias/legacy.py", "legacy.py"]) {
        const root = legacy(Original);
        symlinkSync("original", join(root, "shop/domain/alias"));
        const edit = postedFrom(root, join(root, "shop/domain/alias"), file);
        expect(edit.code).toBe(2);
        expect(edit.stderr).toContain('"code":"INW007"');
      }
    });

    test("PostToolUse through a link to the root: `..` out of an alias can't borrow a start file", () => {
      const root = legacy("shop/domain/legacy.py");
      const link = `${root}-link`;
      symlinkSync(root, link);
      put(root, "shop/domain/new/legacy.py", "X = 1\n");
      put(root, "shop/domain/new/sub/__init__.py", "");
      symlinkSync("new/sub", join(root, "shop/domain/hop"));
      // As written this spells the start file shop/domain/legacy.py; the OS opens the new one.
      const edit = postedFrom(root, join(link, "shop/domain/hop"), "../legacy.py");
      expect(edit.code).toBe(2);
      expect(edit.stderr).toContain('"code":"INW007"');
    });

    test("Stop: a start file swapped for a symlink to a renamed copy blocks", () => {
      const root = legacy("shop/domain/legacy.py");
      renameSync(join(root, "shop/domain/legacy.py"), join(root, "shop/domain/saved.py"));
      symlinkSync("saved.py", join(root, "shop/domain/legacy.py")); // through Bash: no PostToolUse
      const gate = stop(root);
      expect(gate.code).toBe(2);
      expect(gate.stderr).toContain('"code":"INW007"');
      expect(gate.stderr).toContain('"file":"shop/domain/legacy.py"');
    });

    test("a genuinely pre-existing file is still excused, at PostToolUse and Stop", () => {
      const root = legacy(Original);
      put(root, Original, "X = 2\n");
      const edit = postedFrom(root, join(root, "shop/domain/original"), "legacy.py");
      expect(edit.code).toBe(0);
      expect(edit.stdout).toContain("INW007");
      expect(postedFrom(root, root, join(root, Original)).code).toBe(0);
      expect(stop(root).code).toBe(0);
    });
  },
);
