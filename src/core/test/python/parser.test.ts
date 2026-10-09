/**
 * @file Parsing with tree-sitter-python when a file holds long runs of comment
 * lines (#168). They are blanked before the parse, so thousands of them parse in
 * linear time. Every import, row and column stays where it was, and the
 * suppression comments are still in the tree.
 */
import { describe, expect, test } from "bun:test";
import { extractImports, flattenCommentRuns, parsePython } from "../../src/python/parser.ts";
import { commentsIn } from "../../src/rules/suppression-comment.ts";
import { file, parser } from "../support/helpers.ts";

/**
 * Builds a run of comment lines.
 *
 * @param count - how many lines.
 * @param width - characters after the `# `.
 * @returns the lines, each ending in a newline.
 */
function comments(count: number, width: number): string {
  return `# ${"x".repeat(width)}\n`.repeat(count);
}

describe("flattenCommentRuns", () => {
  test("blanks a long run to spaces of the same length", () => {
    const text = `import os\n${comments(40, 10)}import sys\n`;
    const out = flattenCommentRuns(text);
    expect(out.length).toBe(text.length);
    expect(out.split("\n").length).toBe(text.split("\n").length);
    expect(out).toBe(`import os\n${`${" ".repeat(12)}\n`.repeat(40)}import sys\n`);
  });

  test("leaves a short run and a trailing comment alone", () => {
    const text = `import os\n${comments(15, 10)}x = 1  # note\n${comments(15, 3)}`;
    expect(flattenCommentRuns(text)).toBe(text);
  });

  test("keeps CRLF endings and indented comments' columns", () => {
    const text = `def f():\r\n${"    # a\r\n".repeat(20)}    return 1\r\n`;
    const out = flattenCommentRuns(text);
    expect(out).toBe(`def f():\r\n${"       \r\n".repeat(20)}    return 1\r\n`);
  });

  test("keeps a line that mentions inwards, which splits the run", () => {
    const marker = '# inwards: ignore[INW001] reason="legacy"\n';
    const text = `${comments(20, 5)}${marker}${comments(20, 5)}`;
    const out = flattenCommentRuns(text);
    expect(out.split("\n")[20]).toBe(marker.trimEnd());
    expect(out.split("\n")[0]).toBe(" ".repeat(7));
    expect(out.split("\n")[21]).toBe(" ".repeat(7));
  });

  test("keeps the width of a non-BMP character", () => {
    const text = `${"# 😀\n".repeat(20)}x = 1\n`;
    expect(flattenCommentRuns(text).length).toBe(text.length);
  });
});

describe("parsePython on long comment runs", () => {
  test("reads the imports after a run at the same rows and columns", () => {
    const text = `import os\n${comments(600, 200)}if True:\n    import a.b\n`;
    const tree = parsePython(parser, text);
    try {
      expect(
        extractImports(tree, file("pkg/mod.py", text)).map((r) => [r.target, r.line, r.column]),
      ).toEqual([
        ["os", 1, 8],
        ["a.b", 603, 12],
      ]);
    } finally {
      tree.delete();
    }
  });

  test("still finds a suppression comment inside a long run", () => {
    const marker = '# inwards: ignore[INW001] reason="legacy"';
    const text = `import os\n${comments(30, 20)}${marker}\n${comments(30, 20)}`;
    const tree = parsePython(parser, text);
    try {
      expect(commentsIn(tree).map((c) => [c.span.line, c.codes])).toEqual([[32, ["INW001"]]]);
    } finally {
      tree.delete();
    }
  });

  test("parses thousands of comment lines in linear time", () => {
    // 6,000 lines of 40 characters took about 9 s before the fix (quadratic).
    const text = `import os\n${comments(6000, 40)}import sys\n`;
    const started = performance.now();
    const tree = parsePython(parser, text);
    const took = performance.now() - started;
    tree.delete();
    expect(took).toBeLessThan(1500);
  });
});
