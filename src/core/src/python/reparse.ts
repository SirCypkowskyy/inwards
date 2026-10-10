/**
 * @file Incremental parsing for a file that is parsed twice in a row (#122): the
 * PostToolUse hook checks the edited file as it is now and again as it was at
 * session start, and the daemon checks the same file on every edit. A
 * `TreeReuse` keeps the last full parse, and the next parse of the same path
 * describes the change between the two texts to tree-sitter (`Tree.edit`)
 * and hands it the old tree, so only the changed region is parsed again.
 * It holds at most one tree, keyed by path, and does no I/O; whoever creates
 * it decides how long it lives and frees the tree with `clear`.
 */
import { Edit, type Parser, type Point, type Tree } from "web-tree-sitter";
import { flattenCommentRuns } from "./parser.ts";

/** The last full parse kept for reuse. */
export interface TreeReuse {
  /**
   * Parses Python source, reusing the last tree when it was parsed for the
   * same path. Returns a tree as `parsePython` does: same shape, the caller
   * owns it and must `delete()` it.
   *
   * @param parser - parser with the Python grammar loaded.
   * @param path - the file the text belongs to; a different path parses from scratch.
   * @param text - normalised Python source.
   * @returns the syntax tree.
   * @throws {Error} when tree-sitter returns no tree.
   */
  parse: (parser: Parser, path: string, text: string) => Tree;
  /** Frees the kept tree, if any. */
  clear: () => void;
}

/** One kept parse: the path, the text tree-sitter saw and the tree. */
interface Kept {
  path: string;
  text: string;
  tree: Tree;
}

/**
 * Creates an empty `TreeReuse`.
 *
 * When the new tree has no syntax error, tree-sitter's incremental parse
 * gives the same tree as a fresh parse of the new text. With an error it may
 * not, since error recovery can take another path from an old tree, so such
 * a text is parsed again from scratch (`test/python/reparse.test.ts`
 * compares both ways on seeded chains of breaking edits). The edit is the span between the two texts' common prefix and
 * suffix, in UTF-16 code units, which is what web-tree-sitter's `Edit`
 * takes. The comparison runs on the text after `flattenCommentRuns`, since
 * that is what the kept tree was parsed from.
 *
 * @returns a reuse slot holding nothing.
 */
export function createTreeReuse(): TreeReuse {
  let kept: Kept | undefined;
  return {
    parse(parser: Parser, path: string, text: string): Tree {
      const flat = flattenCommentRuns(text);
      const old = kept?.path === path ? kept : undefined;
      if (old !== undefined) {
        old.tree.edit(editBetween(old.text, flat));
      }
      let tree = parser.parse(flat, old?.tree ?? null);
      kept?.tree.delete();
      kept = undefined;
      if (old !== undefined && tree?.rootNode.hasError === true) {
        // Error recovery can take another path when it starts from an old tree.
        tree.delete();
        tree = parser.parse(flat);
      }
      if (!tree) {
        throw new Error("tree-sitter returned no tree");
      }
      kept = { path, text: flat, tree: tree.copy() };
      return tree;
    },
    clear(): void {
      kept?.tree.delete();
      kept = undefined;
    },
  };
}

/** UTF-16 high surrogates: a cut right after one would split a character. */
const HIGH_SURROGATE = /[\uD800-\uDBFF]$/u;
/** UTF-16 low surrogates: a cut right before one would split a character. */
const LOW_SURROGATE = /^[\uDC00-\uDFFF]/u;

/**
 * Describes the change from one text to another as a single replaced span:
 * everything between their common prefix and their common suffix. The span
 * never splits a surrogate pair.
 *
 * @param before - the text the old tree was parsed from.
 * @param after - the new text.
 * @returns the edit, in UTF-16 code units and rows and columns.
 */
export function editBetween(before: string, after: string): Edit {
  const shorter = Math.min(before.length, after.length);
  let start = 0;
  while (start < shorter && before.charCodeAt(start) === after.charCodeAt(start)) {
    start += 1;
  }
  if (start > 0 && HIGH_SURROGATE.test(before.slice(start - 1, start))) {
    start -= 1;
  }
  let suffix = 0;
  while (
    suffix < shorter - start &&
    before.charCodeAt(before.length - 1 - suffix) === after.charCodeAt(after.length - 1 - suffix)
  ) {
    suffix += 1;
  }
  if (suffix > 0 && LOW_SURROGATE.test(before.slice(before.length - suffix))) {
    suffix -= 1;
  }
  const startPosition = pointAt(before, start);
  return new Edit({
    startIndex: start,
    oldEndIndex: before.length - suffix,
    newEndIndex: after.length - suffix,
    startPosition,
    oldEndPosition: pointAfter(startPosition, before, start, before.length - suffix),
    newEndPosition: pointAfter(startPosition, after, start, after.length - suffix),
  });
}

/**
 * The row and column of an offset, as tree-sitter counts them: a row ends at
 * each `\n`, and columns are UTF-16 code units in web-tree-sitter.
 *
 * @param text - the source the offset points into.
 * @param index - an offset into it.
 * @returns the position of that offset.
 */
function pointAt(text: string, index: number): Point {
  return pointAfter({ row: 0, column: 0 }, text, 0, index);
}

/**
 * Moves a position over a slice of text.
 *
 * @param from - the position at `start`.
 * @param text - the source both offsets point into.
 * @param start - the offset `from` stands for.
 * @param end - the offset to move to, at or after `start`.
 * @returns the position at `end`.
 */
function pointAfter(from: Point, text: string, start: number, end: number): Point {
  let { row } = from;
  let lineStart = start - from.column;
  let newline = text.indexOf("\n", start);
  while (newline !== -1 && newline < end) {
    row += 1;
    lineStart = newline + 1;
    newline = text.indexOf("\n", lineStart);
  }
  return { row, column: end - lineStart };
}
