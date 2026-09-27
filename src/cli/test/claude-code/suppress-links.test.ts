/**
 * @file `agent-suppressions` and the #134 excuse against symlinks (#50, ADR-028): a
 * file has a start identity only when its path as written is its physical
 * path, so an alias the agent creates, a cwd inside one, `..` through one,
 * or a start file swapped for a link never borrows another file's start record.
 * Each test pins one bypass that an earlier review found.
 */
import { describe, expect, test } from "bun:test";
import { renameSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { inwards, LAYERS, payload, type RunResult } from "../support/run.ts";
import { ID, put, session, stop } from "../support/stop-helpers.ts";
import { LEGACY, NO_LAZY_FETCH, posted, SUPPRESSED } from "../support/suppress-helpers.ts";

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

/** A suppression the agent may not borrow, and an old violation's excuse: what each leaves blocking. */
const AGENT_FINDINGS = [
  [SUPPRESSED, "wasn't in the file when the session started"],
  ["import shop.infrastructure.db\n", '"code":"INW001"'],
] as const;

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

    test("a cwd alias with `..` back through it gets no allowance, nor a #134 excuse", () => {
      for (const text of [SUPPRESSED, "import shop.infrastructure.db\n"]) {
        const root = session({ [Original]: text });
        symlinkSync("original", join(root, "shop/domain/alias"));
        const edit = postedFrom(root, join(root, "shop/domain/alias"), "../alias/legacy.py");
        expect(edit.code).toBe(2);
        expect(edit.stderr).not.toContain("already in the file when the session started");
      }
    });

    test("a start file swapped for a symlink to the same bytes is re-checked at Stop", () => {
      for (const text of [SUPPRESSED, "import shop.infrastructure.db\n"]) {
        const root = session({ [LEGACY]: text });
        renameSync(join(root, LEGACY), join(root, "shop/domain/saved.txt"));
        symlinkSync("saved.txt", join(root, LEGACY)); // through Bash: no PostToolUse
        const gate = stop(root);
        expect(gate.code).toBe(2);
        expect(gate.stderr).toContain('"file":"shop/domain/legacy.py"');
      }
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

    test("a config below a directory alias, with the cwd above it, gives the alias nothing", () => {
      for (const [text, blocked] of AGENT_FINDINGS) {
        const root = session({
          "real/pyproject.toml": LAYERS,
          "real/shop/infrastructure/db.py": "",
          "real/shop/domain/legacy.py": text,
        });
        symlinkSync("real", join(root, "alias"));
        const edit = postedFrom(root, root, join(root, "alias/shop/domain/legacy.py"));
        expect(edit.code).toBe(2);
        expect(edit.stderr).toContain('"file":"alias/shop/domain/legacy.py"');
        expect(edit.stderr).not.toContain("already in the file when the session started");
        expect(edit.stderr).toContain(blocked);
      }
    });

    test("through a link to the root, `..` out of an alias can't borrow the start file it spells", () => {
      for (const [text, blocked] of AGENT_FINDINGS) {
        const root = session({ [LEGACY]: text });
        const link = `${root}-link`;
        symlinkSync(root, link);
        // A new file with the start file's bytes, and a link one level deeper than its name.
        put(root, "shop/domain/new/legacy.py", text);
        put(root, "shop/domain/new/sub/__init__.py", "");
        symlinkSync("new/sub", join(root, "shop/domain/hop"));
        // As written this spells shop/domain/legacy.py; the OS opens shop/domain/new/legacy.py.
        const edit = postedFrom(root, join(link, "shop/domain/hop"), "../legacy.py");
        expect(edit.code).toBe(2);
        // Shortened, the path would read ../new/legacy.py: from hop, that is new/new/legacy.py.
        expect(edit.stderr).not.toContain('"file":"../new/legacy.py"');
        expect(edit.stderr).not.toContain("already in the file when the session started");
        expect(edit.stderr).toContain(blocked);
      }
    });

    test("through a link to the root and a cwd alias, a shortened note path still opens the file", () => {
      const root = session({ [Original]: "import shop.infrastructure.db\n" });
      const link = `${root}-link`;
      symlinkSync(root, link);
      symlinkSync("original", join(root, "shop/domain/alias"));
      const cwd = join(link, "shop/domain/alias");
      const edit = postedFrom(root, cwd, "legacy.py");
      expect(edit.code).toBe(2);
      expect(edit.stderr).toContain("\n- ../original/legacy.py:1 INW001");
      // The shell resolves `..` from where the link points, as the agent's tools do.
      expect(Bun.spawnSync(["test", "-f", "../original/legacy.py"], { cwd }).exitCode).toBe(0);
    });

    test("through a link to the root, the notes name files from the project, not ../../private/var", () => {
      const root = session({ [LEGACY]: "import shop.infrastructure.db\n" });
      const link = `${root}-link`;
      symlinkSync(root, link);
      symlinkSync("legacy.py", join(root, "shop/domain/alias.py"));
      // The payload's cwd is the path as written; the hook's own cwd is the real one.
      const edit = postedFrom(link, link, join(link, "shop/domain/alias.py"));
      expect(edit.code).toBe(2);
      expect(edit.stderr).toContain("\n- shop/domain/legacy.py:1 INW001");
      expect(edit.stderr).toContain('"file":"shop/domain/alias.py"');
      expect(edit.stderr).not.toContain("../");
    });
  },
);
