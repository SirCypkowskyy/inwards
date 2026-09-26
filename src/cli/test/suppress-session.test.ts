/**
 * `agent-suppressions` against the session start (#50, ADR-028): files the
 * agent didn't change, `stop-gate = "project"`, new, renamed and paired
 * files, and a rejected suppression treated as if the comment weren't there.
 */
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { appendFileSync, readFileSync, renameSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { startText, unchangedFiles } from "../src/legacy.ts";
import { inwards, payload, project, type RunResult } from "./run.ts";
import { git, ID, put, session, stop } from "./stop-helpers.ts";
import {
  agentWritesOrder,
  LEGACY,
  NO_LAZY_FETCH,
  ORDER,
  PROJECT_GATE,
  posted,
  SUPPRESSED,
} from "./suppress-helpers.ts";

/**
 * Starts a session after the user changed files that are already committed,
 * or added new ones: they are in the start manifest, but git has no start
 * content for them.
 *
 * @param files - project files, committed.
 * @param dirty - files written after the commit, before the session starts.
 * @returns the project directory.
 */
function startedDirty(files: Record<string, string>, dirty: Record<string, string>): string {
  const root = project({ "shop/infrastructure/db.py": "", [ORDER]: "X = 1\n", ...files });
  git(root, "init", "-q");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "start");
  for (const [rel, text] of Object.entries(dirty)) {
    put(root, rel, text);
  }
  inwards(["init", "--agent", "claude"], { cwd: root });
  const start = payload("session-start", root, { session_id: ID, source: "startup" });
  inwards(["hook", "claude-code"], { cwd: root, stdin: start });
  return root;
}

describe('stop-gate = "project"', () => {
  test("a suppression in a file the user changed but didn't commit before the session doesn't block", () => {
    const root = startedDirty(
      { "pyproject.toml": PROJECT_GATE, [LEGACY]: SUPPRESSED },
      { [LEGACY]: `${SUPPRESSED}TOTAL = 1\n` },
    );
    expect(agentWritesOrder(root, "X = 2\n").code).toBe(0);
    expect(stop(root).code).toBe(0);
  });

  test("nor does one in a file that was untracked when the session started", () => {
    const root = startedDirty({ "pyproject.toml": PROJECT_GATE }, { [LEGACY]: SUPPRESSED });
    expect(agentWritesOrder(root, "X = 2\n").code).toBe(0);
    expect(stop(root).code).toBe(0);
  });

  test("a suppression the agent adds still blocks, in any file", () => {
    const root = startedDirty({ "pyproject.toml": PROJECT_GATE }, {});
    put(root, LEGACY, SUPPRESSED); // through Bash: no PostToolUse
    const gate = stop(root);
    expect(gate.code).toBe(2);
    expect(gate.stderr).toContain("or the file wasn't committed at session start");
    expect(gate.stderr).toContain("shop/domain/legacy.py");
  });
});

describe("new and renamed files", () => {
  test("a suppression in a file the agent creates blocks", () => {
    const root = session();
    put(root, "shop/domain/fresh.py", SUPPRESSED);
    const input = payload("post-write-order", root, {
      session_id: ID,
      tool_input: { file_path: join(root, "shop/domain/fresh.py") },
    });
    expect(inwards(["hook", "claude-code"], { cwd: root, stdin: input }).code).toBe(2);
    expect(stop(root).code).toBe(2);
  });

  test("a file with a suppression renamed by the agent counts as new, and blocks", () => {
    const root = session({ [LEGACY]: SUPPRESSED });
    renameSync(join(root, LEGACY), join(root, "shop/domain/renamed.py"));
    const gate = stop(root);
    expect(gate.code).toBe(2);
    expect(gate.stderr).toContain("shop/domain/renamed.py");
  });
});

describe("a rejected suppression is treated as if the comment weren't there", () => {
  test("a violation the baseline accepts stays accepted", () => {
    const root = session({ [ORDER]: "import shop.infrastructure.db\n" }, (dir) => {
      inwards(["baseline"], { cwd: dir });
    });
    const edit = agentWritesOrder(root, SUPPRESSED);
    expect(edit.code).toBe(0);
    expect(edit.stderr).toBe("");
    expect(stop(root).code).toBe(0);
  });

  test("a second, new copy still blocks", () => {
    const root = session({ [ORDER]: "import shop.infrastructure.db\n" }, (dir) => {
      inwards(["baseline"], { cwd: dir });
    });
    appendFileSync(join(root, ORDER), SUPPRESSED);
    const edit = agentWritesOrder(root, readFileSync(join(root, ORDER), "utf8"));
    expect(edit.code).toBe(2);
    expect(stop(root).code).toBe(2);
  });
});

describe.skipIf(!NO_LAZY_FETCH)("a rejected suppression on an old violation", () => {
  test("leaves it context, as the violation the file had at session start", () => {
    const root = session({ [ORDER]: "import shop.infrastructure.db\n" });
    const edit = agentWritesOrder(root, SUPPRESSED);
    expect(edit.code).toBe(0);
    expect(edit.stdout).toContain("already in the file when the session started");
    expect(stop(root).code).toBe(0);
  });
});

describe.skipIf(!NO_LAZY_FETCH)("a .py and .pyi pair shares a module, not its suppressions", () => {
  const Cart = "shop/domain/cart.py";
  const Stub = "shop/domain/cart.pyi";

  test("a suppression moved from the stub into a new .py blocks", () => {
    const root = session({ [Stub]: `${SUPPRESSED}${SUPPRESSED}` });
    put(root, Stub, SUPPRESSED); // through Bash: one copy moves out of the stub...
    put(root, Cart, SUPPRESSED); // ...into a new file of the same module
    const edit = posted(root, Cart);
    expect(edit.code).toBe(2);
    expect(edit.stderr).toContain("shop/domain/cart.py:1");
    const gate = stop(root);
    expect(gate.code).toBe(2);
    expect(gate.stderr).toContain("shop/domain/cart.py");
  });

  test("each file keeps its own suppressions through an edit, and a new copy still blocks", () => {
    const root = session({ [Cart]: SUPPRESSED, [Stub]: SUPPRESSED });
    put(root, Cart, `${SUPPRESSED}TOTAL = 1\n`);
    expect(posted(root, Cart).code).toBe(0);
    expect(stop(root).code).toBe(0);
    put(root, Cart, `${SUPPRESSED}${SUPPRESSED}`);
    expect(posted(root, Cart).code).toBe(2);
    expect(stop(root).code).toBe(2);
  });
});

describe("the unchanged-file check", () => {
  test("reads and hashes each file once, however many findings it has", () => {
    const root = project({ "a.py": "x\n", "b.py": "y\n" });
    const hash = createHash("sha256").update("x\n").digest("hex");
    const reads: string[] = [];
    /**
     * Reads a file and records that it did.
     *
     * @param file - the file.
     * @returns its bytes.
     */
    function read(file: string): Uint8Array {
      reads.push(file);
      return readFileSync(file);
    }
    const a = join(root, "a.py");
    const b = join(root, "b.py");
    const manifest = { "a.py": hash, "b.py": hash };
    const files: [string, string][] = [
      ["a.py", a],
      ["a.py", a],
      ["b.py", b],
      ["a.py", a],
      ["b.py", b],
    ];
    const same = unchangedFiles({ manifest }, files, read);
    expect(reads).toEqual([a, b]);
    expect([...same]).toEqual(["a.py"]);
    writeFileSync(a, "changed\n");
    expect(unchangedFiles({ manifest }, [["a.py", a]], read).size).toBe(0);
  });

  test("asks git for each start content once, a failed lookup included", () => {
    const text = "import os\n";
    const manifest = {
      "clean.py": createHash("sha256").update(text).digest("hex"),
      "dirty.py": createHash("sha256").update("edited before the session\n").digest("hex"),
    };
    const start = { head: "0123456789abcdef", manifest };
    const specs: string[] = [];
    /**
     * Stands in for `git cat-file blob` and records each call.
     *
     * @param _project - the project root (unused).
     * @param spec - the blob asked for.
     * @returns the committed content, which the dirty file no longer has.
     */
    function blob(_project: string, spec: string): string {
      specs.push(spec);
      return text;
    }
    for (let i = 0; i < 3; i += 1) {
      expect(startText("/p", start, "clean.py", blob)).toBe(text);
      expect(startText("/p", start, "dirty.py", blob)).toBeUndefined();
    }
    expect(specs).toEqual(["0123456789abcdef:./clean.py", "0123456789abcdef:./dirty.py"]);
    expect(startText("/p", start, "new.py", blob)).toBeUndefined();
    expect(specs).toHaveLength(2);
  });
});

describe.skipIf(!NO_LAZY_FETCH || process.platform === "win32")(
  "a symlink the agent creates is a new file, whatever it points at",
  () => {
    test("a .py linked to a stub with a suppression gets no allowance", () => {
      const root = session({ "shop/domain/cart.pyi": SUPPRESSED });
      symlinkSync("cart.pyi", join(root, "shop/domain/cart.py"));
      const edit = posted(root, "shop/domain/cart.py");
      expect(edit.code).toBe(2);
      expect(edit.stderr).toContain("shop/domain/cart.py:1");
      const gate = stop(root);
      expect(gate.code).toBe(2);
      expect(gate.stderr).toContain("shop/domain/cart.py");
    });

    test("a .py linked to another .py with a suppression gets no allowance", () => {
      const root = session({ [LEGACY]: SUPPRESSED });
      symlinkSync("legacy.py", join(root, "shop/domain/alias.py"));
      const edit = posted(root, "shop/domain/alias.py");
      expect(edit.code).toBe(2);
      expect(edit.stderr).toContain("shop/domain/alias.py:1");
      expect(stop(root).code).toBe(2);
    });

    test("an alias of a file with an old violation doesn't inherit its excuse (#134)", () => {
      const root = session({ [LEGACY]: "import shop.infrastructure.db\n" });
      symlinkSync("legacy.py", join(root, "shop/domain/alias.py"));
      const edit = posted(root, "shop/domain/alias.py");
      expect(edit.code).toBe(2);
      // The real file's own violation is old; the alias's is not.
      expect(edit.stderr).toContain("- shop/domain/legacy.py:1 INW001");
      expect(edit.stderr).not.toContain("- shop/domain/alias.py:1");
      expect(edit.stderr).toContain('"file":"shop/domain/alias.py"');
    });

    test("the linked file itself keeps its suppression", () => {
      const root = session({ [LEGACY]: SUPPRESSED });
      put(root, LEGACY, `${SUPPRESSED}TOTAL = 1\n`);
      expect(posted(root, LEGACY).code).toBe(0);
      expect(stop(root).code).toBe(0);
    });
  },
);

/**
 * Sends PostToolUse the way a payload with its own cwd names a file.
 *
 * @param root - the project directory, where the hook runs.
 * @param cwd - the payload's cwd.
 * @param file - the payload's file_path, as written.
 * @returns the hook's exit code and output.
 */
function postedFrom(root: string, cwd: string, file: string): RunResult {
  const input = payload("post-write-order", root, {
    session_id: ID,
    cwd,
    tool_input: { file_path: file },
  });
  return inwards(["hook", "claude-code"], { cwd: root, stdin: input });
}

describe.skipIf(!NO_LAZY_FETCH || process.platform === "win32")(
  "the start identity is the path as written, below the real project root",
  () => {
    const Original = "shop/domain/original/legacy.py";

    test("a cwd in a symlinked directory the agent created gets no allowance", () => {
      const root = session({ [Original]: SUPPRESSED });
      symlinkSync("original", join(root, "shop/domain/alias"));
      const edit = postedFrom(root, join(root, "shop/domain/alias"), "legacy.py");
      expect(edit.code).toBe(2);
      expect(edit.stderr).toContain("wasn't in the file when the session started");
    });

    test("nor does it inherit an old violation's excuse (#134)", () => {
      const root = session({ [Original]: "import shop.infrastructure.db\n" });
      symlinkSync("original", join(root, "shop/domain/alias"));
      const edit = postedFrom(root, join(root, "shop/domain/alias"), "legacy.py");
      expect(edit.code).toBe(2);
      // The alias's finding blocks; only the real file's own old violation is excused.
      expect(edit.stderr).toContain('"file":"legacy.py","module":"shop.domain.alias.legacy"');
      expect(edit.stderr).not.toContain("- legacy.py:1");
    });

    test("`..` through a symlinked file the agent created gets no allowance", () => {
      const root = session({ "shop/domain/cart.pyi": SUPPRESSED });
      symlinkSync("cart.pyi", join(root, "shop/domain/cart.py"));
      const edit = postedFrom(root, root, "shop/domain/../domain/cart.py");
      expect(edit.code).toBe(2);
      expect(edit.stderr).toContain("shop/domain/cart.py:1");
    });

    test("a plain cwd inside the project still matches", () => {
      const root = session({ [LEGACY]: SUPPRESSED });
      put(root, LEGACY, `${SUPPRESSED}TOTAL = 1\n`);
      expect(postedFrom(root, join(root, "shop/domain"), "legacy.py").code).toBe(0);
      expect(postedFrom(root, root, "shop/domain/../domain/legacy.py").code).toBe(0);
    });

    test("a project reached through a link to its root still matches (macOS /var)", () => {
      const root = session({ [LEGACY]: SUPPRESSED });
      const link = `${root}-link`;
      symlinkSync(root, link);
      put(root, LEGACY, `${SUPPRESSED}TOTAL = 1\n`);
      expect(postedFrom(root, link, join(link, LEGACY)).code).toBe(0);
      expect(stop(root).code).toBe(0);
    });
  },
);
