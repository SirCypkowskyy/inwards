/**
 * @file Joins words the way English lists them, for the messages and fix
 * steps of the rules that name several things at once (the FAPI rules,
 * INW012). Plain string work: it knows nothing about rules or syntax.
 */

/**
 * Joins words as English lists them.
 *
 * @param words - the items, in order.
 * @param conjunction - the word before the last one.
 * @returns "a", "a and b", or "a, b and c".
 */
export function joined(words: readonly string[], conjunction = "and"): string {
  return words.length <= 1
    ? (words[0] ?? "")
    : `${words.slice(0, -1).join(", ")} ${conjunction} ${words.at(-1) ?? ""}`;
}
