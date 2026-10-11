/**
 * @file A line diff for `inwards init --dry-run`, which prints each change it
 * would make before making it. Pure: a longest-common-subsequence table over
 * the two texts' lines, no I/O.
 */
/**
 * Shows how one text becomes another, line by line: `-` for removed lines,
 * `+` for added ones. Used by `inwards init --dry-run`; files are small, so a
 * plain longest-common-subsequence table is fast enough.
 *
 * @param before - the current text.
 * @param after - the new text.
 * @returns the changed lines only, prefixed with `-` or `+`.
 */
export function lineDiff(before: string, after: string): string {
  const a = before === "" ? [] : before.split("\n");
  const b = after === "" ? [] : after.split("\n");
  const lcs = lcsTable(a, b);
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      i += 1;
      j += 1;
    } else if (j < b.length && (i >= a.length || at(lcs, i, j + 1) >= at(lcs, i + 1, j))) {
      out.push(`+${b[j] ?? ""}`);
      j += 1;
    } else {
      out.push(`-${a[i] ?? ""}`);
      i += 1;
    }
  }
  return out.join("\n");
}

/**
 * Builds the table of longest common subsequence lengths of two line lists.
 *
 * @param a - lines before.
 * @param b - lines after.
 * @returns `t[i][j]`: the LCS length of `a[i..]` and `b[j..]`.
 */
function lcsTable(a: readonly string[], b: readonly string[]): number[][] {
  const table = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    const row = table[i] ?? [];
    for (let j = b.length - 1; j >= 0; j -= 1) {
      row[j] =
        a[i] === b[j]
          ? at(table, i + 1, j + 1) + 1
          : Math.max(at(table, i + 1, j), row[j + 1] ?? 0);
    }
  }
  return table;
}

/**
 * Reads one cell of the LCS table, treating cells past the edge as 0.
 *
 * @param table - the LCS table.
 * @param i - row.
 * @param j - column.
 * @returns the cell's value.
 */
function at(table: number[][], i: number, j: number): number {
  return table[i]?.[j] ?? 0;
}
