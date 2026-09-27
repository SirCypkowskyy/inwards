/**
 * @file Fast path. Architecture rules only need imports, and in real code imports
 * sit on their own logical lines. We blank out every other line (keeping line
 * numbers), dedent the import lines, and let tree-sitter parse that skeleton.
 * It is roughly 20x less work than parsing the whole file.
 *
 * The prescan must never miss an import, so it refuses (returns null) whenever
 * the word `import` shows up anywhere it cannot account for: `x = 1; import os`,
 * `if a: import b`, or an import-looking line inside a string. The caller then
 * parses the full file. False positives are fine because the engine confirms
 * every violation against a full parse.
 */
import type { Parser } from "web-tree-sitter";
import type { ImportRef, SourceFile } from "../contracts/records.ts";
import { extractImports, parsePython } from "./parser.ts";

interface Skeleton {
  text: string;
  /** Columns removed from each line by dedenting, indexed by 0-based row. */
  indent: number[];
}

const STARTS_IMPORT = /^(?<pad>[ \t]*)(?:import[ \t]|from[ \t][^#]*[ \t]import\b)/u;
const MENTIONS_IMPORT = /\bimport\b/u;

/**
 * Reduces a Python file to its import lines, keeping every line number.
 * Lines that start an import are copied (dedented, with their parenthesised
 * or backslash-continued tail); every other line becomes empty.
 *
 * Returns null, which means "parse the whole file instead", when:
 * - a line mentions `import` but does not start an import and is not a
 *   comment (`x = 1; import os`, `if a: import b`, text inside a string);
 * - a line after a backslash continuation mentions `import`
 *   (`from x \` then `import y`);
 * - an import's parentheses or continuation never close before the end of file.
 *
 * @param source - normalised file text (no BOM, no lone \r).
 * @returns the skeleton text and per-row dedent, or null to force a full parse.
 */
function importSkeleton(source: string): Skeleton | null {
  const lines = source.split("\n");
  const out: string[] = new Array<string>(lines.length).fill("");
  const indent: number[] = new Array<number>(lines.length).fill(0);

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    // `from x \` + newline + `import y` would otherwise look like `import y`.
    if (endsWithBackslash(lines[i - 1] ?? "") && MENTIONS_IMPORT.test(line)) {
      return null;
    }
    const pad = STARTS_IMPORT.exec(line)?.groups?.["pad"]?.length;
    if (pad === undefined) {
      // A comment can't hide an import. Anything else that mentions one might.
      if (MENTIONS_IMPORT.test(line) && !line.trimStart().startsWith("#")) {
        return null;
      }
      continue;
    }
    const last = copyLogicalLine(lines, i, pad, { lines: out, indent });
    if (last === null) {
      return null; // unterminated: let the full parse decide
    }
    i = last;
  }
  return { text: out.join("\n"), indent };
}

/**
 * Copies one logical import line into the skeleton.
 * A logical line runs until its parentheses balance and it does not end in a
 * backslash. The first row is dedented by `pad` columns; later rows are
 * copied as is.
 *
 * @param lines - all rows of the file.
 * @param first - index of the row where the import starts.
 * @param pad - leading whitespace width removed from the first row.
 * @param into - the skeleton being built, written in place.
 * @param into.lines - the skeleton's rows.
 * @param into.indent - the columns removed from each row.
 * @returns the index of the last row copied, or null if the file ends first.
 */
function copyLogicalLine(
  lines: readonly string[],
  first: number,
  pad: number,
  into: { lines: string[]; indent: number[] },
): number | null {
  // Copy the logical line: parenthesised lists and backslash continuations.
  let depth = 0;
  for (let j = first; j < lines.length; j += 1) {
    const raw = lines[j] ?? "";
    const text = j === first ? raw.slice(pad) : raw;
    into.lines[j] = text;
    into.indent[j] = j === first ? pad : 0;
    depth += parenBalance(text);
    if (depth <= 0 && !endsWithBackslash(text)) {
      return j;
    }
  }
  return null;
}

/**
 * Counts opening minus closing parentheses on one row.
 * Stops at `#`, so parentheses in a trailing comment do not count. Brackets
 * inside strings are counted; a skeleton that parses badly is caught later.
 *
 * @param text - one row of source.
 * @returns the net change in parenthesis depth.
 */
function parenBalance(text: string): number {
  let balance = 0;
  for (const ch of text) {
    if (ch === "#") {
      break;
    }
    if (ch === "(") {
      balance += 1;
    } else if (ch === ")") {
      balance -= 1;
    }
  }
  return balance;
}

/**
 * Tells whether a row continues onto the next one with a backslash.
 * Trailing whitespace after the backslash is ignored.
 *
 * @param line - one row of source.
 * @returns true when the row ends in `\`.
 */
function endsWithBackslash(line: string): boolean {
  return line.trimEnd().endsWith("\\");
}

const SKELETON_NODES = new Set([
  "import_statement",
  "import_from_statement",
  "future_import_statement",
  "comment",
]);

/**
 * Reads imports from the skeleton, with columns mapped back to the real file.
 * Returns null (do the full parse) when the prescan refuses the file or when
 * the skeleton does not parse into imports and comments only.
 *
 * A skeleton with a parse error, or with any node other than an import or a
 * comment, is not trusted (the comment in the body shows how that happens).
 * `src/core/scripts/prescan-diff.ts` checks that this never misses an import.
 *
 * @param parser - parser with the Python grammar loaded.
 * @param file - the source file, with normalised text.
 * @returns the imports with real spans, or null to force a full parse.
 */
export function skeletonImports(parser: Parser, file: SourceFile): ImportRef[] | null {
  const skeleton = importSkeleton(file.text);
  if (!skeleton) {
    return null;
  }
  const tree = parsePython(parser, skeleton.text);
  try {
    // Import-shaped lines inside strings can glue real code onto a bogus import
    // (`from a import (`) or open a string of their own (`import a; t = '''`).
    // A skeleton we can trust parses cleanly and holds nothing but imports.
    const root = tree.rootNode;
    if (root.hasError || !root.namedChildren.every((n) => n && SKELETON_NODES.has(n.type))) {
      return null;
    }
    return extractImports(tree, file).map((ref) => ({
      ...ref,
      column: ref.column + (skeleton.indent[ref.line - 1] ?? 0),
      endColumn: ref.endColumn + (skeleton.indent[ref.endLine - 1] ?? 0),
    }));
  } finally {
    tree.delete(); // WASM memory is not garbage collected
  }
}
