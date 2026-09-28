/**
 * @file Unit tests for `start-copies.ts` (#157) and how `start-content.ts` uses the
 * copies: which files SessionStart copies (not the ones git has, not
 * invalid UTF-8, not past a cap, not a symlink alias), and that a copy is
 * trusted only when it hashes to the start manifest. Git and the probe are
 * stand-ins, so the git 2.44+ path runs on any runner.
 */
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { createStartContent } from "../../src/session/start-content.ts";
import {
  MAX_COPIES_BYTES,
  MAX_COPY_BYTES,
  type StartCopier,
  startCopier,
} from "../../src/session/start-copies.ts";

const HEAD = "a".repeat(40);

/**
 * Computes git's SHA-1 blob id of a text.
 *
 * @param text - the blob's content.
 * @returns the object id.
 */
function oid(text: string): string {
  const bytes = new TextEncoder().encode(text);
  return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}

/**
 * Makes a copier for `/p` over a start commit holding some files, where every
 * path is its own start identity except the ones named as links.
 *
 * @param tree - the start commit's files, by path.
 * @param links - paths that are symlinks.
 * @returns a collector whose git lists `tree` as the start commit.
 */
function copier(tree: Record<string, string>, links: string[] = []): StartCopier {
  const out = Object.entries(tree)
    .map(([rel, text]) => `100644 blob ${oid(text)}\t${rel}\0`)
    .join("");
  return startCopier(
    {
      git: {
        run: (_dir: string, args: string[]): string | undefined =>
          args.includes("ls-tree") ? out : undefined,
      },
      probe: {
        realpath: (path: string): string => path,
        isLink: (path: string): boolean => links.some((l) => path.endsWith(l)),
        exists: (): boolean => true,
      },
    },
    "/p",
    HEAD,
  );
}

/**
 * Adds a text file to a copier.
 *
 * @param into - the copier.
 * @param rel - the file's project path.
 * @param text - its content.
 */
function add(into: StartCopier, rel: string, text: string): void {
  into.add(rel, `/p/${rel}`, new TextEncoder().encode(text));
}

describe("what SessionStart copies", () => {
  test("a file git has, even checked out with CRLF, gets no copy; a changed or new one does", () => {
    const into = copier({
      "clean.py": "X = 1\n",
      "crlf.py": "A = 1\nB = 2\n",
      "dirty.py": "X = 1\n",
    });
    add(into, "clean.py", "X = 1\n");
    add(into, "crlf.py", "A = 1\r\nB = 2\r\n");
    add(into, "dirty.py", "X = 2\n");
    add(into, "new.py", "Y = 1\n");
    expect(into.copies).toEqual({ "dirty.py": "X = 2\n", "new.py": "Y = 1\n" });
  });

  test("mixed line endings over an LF blob get a copy: git can't give them back", () => {
    const into = copier({ "mixed.py": "x = 1\ny = 2\n", "crlf.py": "x = 1\ny = 2\n" });
    add(into, "mixed.py", "x = 1\r\ny = 2\n");
    add(into, "crlf.py", "x = 1\r\ny = 2\r\n");
    expect(into.copies).toEqual({ "mixed.py": "x = 1\r\ny = 2\n" });
  });

  test("a symlink and invalid UTF-8 get no copy", () => {
    const into = copier({}, ["alias.py"]);
    add(into, "alias.py", "X = 1\n");
    into.add("latin1.py", "/p/latin1.py", new Uint8Array([0x23, 0xe9, 0x0a]));
    expect(into.copies).toEqual({});
  });

  test("a file past the per-file cap gets no copy, and the total stops at its cap", () => {
    const into = copier({});
    add(into, "big.py", "#".repeat(MAX_COPY_BYTES + 1));
    const size = MAX_COPY_BYTES - 1; // leaves a few bytes under the total cap
    const fit = Math.floor(MAX_COPIES_BYTES / size);
    for (let i = 0; i <= fit; i += 1) {
      add(into, `f${i}.py`, "#".repeat(size));
    }
    add(into, "small.py", "X = 1\n"); // still fits once a large one didn't
    expect(Object.keys(into.copies)).toHaveLength(fit + 1);
    expect(into.copies).not.toHaveProperty(["big.py"]);
    expect(into.copies).not.toHaveProperty([`f${fit}.py`]);
    expect(into.copies).toHaveProperty(["small.py"]);
  });

  test("git before 2.44 (ls-tree fails) makes every file a candidate", () => {
    const into = startCopier(
      {
        git: { run: (): undefined => undefined },
        probe: {
          realpath: (p: string): string => p,
          isLink: (): boolean => false,
          exists: (): boolean => true,
        },
      },
      "/p",
      HEAD,
    );
    add(into, "a.py", "X = 1\n");
    expect(into.copies).toEqual({ "a.py": "X = 1\n" });
  });
});

describe("how start content uses a copy", () => {
  const text = "import os\n";
  const manifest = { "a.py": createHash("sha256").update(text).digest("hex") };
  const unread = { bytes: (): Uint8Array => new Uint8Array() };

  test("a copy that hashes to the manifest is the start content, without asking git", () => {
    const asked: string[][] = [];
    const content = createStartContent({
      git: {
        run: (_d: string, args: string[]): undefined => {
          asked.push(args);
        },
      },
      read: unread,
      copies: () => new Map([["a.py", text]]),
    });
    expect(content.startText("/p", { head: HEAD, manifest }, "a.py")).toBe(text);
    expect(content.startText("/p", { head: null, manifest }, "a.py")).toBe(text);
    expect(asked).toEqual([]);
  });

  test("a copy that doesn't hash to the manifest is ignored", () => {
    const content = createStartContent({
      git: { run: (): undefined => undefined },
      read: unread,
      copies: () => new Map([["a.py", `${text}import sys\n`]]),
    });
    expect(content.startText("/p", { head: HEAD, manifest }, "a.py")).toBeUndefined();
  });
});
