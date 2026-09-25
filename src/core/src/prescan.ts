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
