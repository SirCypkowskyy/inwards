/**
 * Fast path. Architecture rules only need imports, and in real code imports
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
import { extractImports, parsePython } from "./python.ts";
import type { ImportRef, SourceFile } from "./types.ts";

export interface Skeleton {
  text: string;
  /** Columns removed from each line by dedenting, indexed by 0-based row. */
  indent: number[];
}

const STARTS_IMPORT = /^([ \t]*)(?:import[ \t]|from[ \t][^#]*[ \t]import\b)/;
const MENTIONS_IMPORT = /\bimport\b/;

export function importSkeleton(source: string): Skeleton | null {
  const lines = source.split("\n");
  const out: string[] = new Array(lines.length).fill("");
  const indent: number[] = new Array(lines.length).fill(0);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    // `from x \` + newline + `import y` would otherwise look like `import y`.
    const continued = (lines[i - 1] ?? "").trimEnd().endsWith("\\");
    if (continued && MENTIONS_IMPORT.test(line)) return null;
    const m = STARTS_IMPORT.exec(line);
    if (!m) {
      // A comment can't hide an import. Anything else that mentions one might.
      if (MENTIONS_IMPORT.test(line) && !line.trimStart().startsWith("#")) return null;
      continue;
    }
    const pad = m[1]?.length ?? 0;
    // Copy the logical line: parenthesised lists and backslash continuations.
    let depth = 0;
    for (let j = i; j < lines.length; j++) {
      const raw = lines[j] ?? "";
      const text = j === i ? raw.slice(pad) : raw;
      out[j] = text;
      indent[j] = j === i ? pad : 0;
      for (const ch of text) {
        if (ch === "(") depth++;
        else if (ch === ")") depth--;
        else if (ch === "#") break;
      }
      if (depth <= 0 && !text.trimEnd().endsWith("\\")) {
        i = j;
        break;
      }
      if (j === lines.length - 1) return null; // unterminated: let the full parse decide
    }
  }
  return { text: out.join("\n"), indent };
}

/** Imports read from the skeleton, with real columns. Null means: do the full parse. */
export function skeletonImports(parser: Parser, file: SourceFile): ImportRef[] | null {
  const skeleton = importSkeleton(file.text);
  if (!skeleton) return null;
  const tree = parsePython(parser, skeleton.text);
  try {
    // A string holding `from a import (` glues the real code after it onto a bogus
    // import, which hides real imports. That skeleton never parses cleanly.
    if (tree.rootNode.hasError) return null;
    return extractImports(tree, file).map((ref) => ({
      ...ref,
      column: ref.column + (skeleton.indent[ref.line - 1] ?? 0),
      endColumn: ref.endColumn + (skeleton.indent[ref.endLine - 1] ?? 0),
    }));
  } finally {
    tree.delete(); // WASM memory is not garbage collected
  }
}
