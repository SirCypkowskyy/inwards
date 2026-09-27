/**
 * @file Levenshtein edit distance between two names. INW007 and INW008 use it
 * to suggest the member a misplaced one most likely meant, and INW010 to
 * suggest the module a hallucinated import most likely meant.
 */

/**
 * Levenshtein distance between two names.
 *
 * @param a - one name.
 * @param b - the other.
 * @returns the fewest single-character edits between them.
 */
export function distance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const next = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const swap = (row[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1);
      next.push(Math.min((row[j] ?? 0) + 1, (next[j - 1] ?? 0) + 1, swap));
    }
    row = next;
  }
  return row[b.length] ?? 0;
}
