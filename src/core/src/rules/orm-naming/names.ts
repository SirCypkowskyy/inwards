/**
 * @file The naming scheme INW016 holds table and column names to, as plain
 * string work: whether a name is lower_case_snake, whether its last word
 * reads as an English plural, and the name to suggest instead (`UserAccount`
 * becomes `user_account`, `categories` becomes `category`, `created`
 * becomes `created_at`). The plural test is a heuristic on the last word,
 * with the usual singular endings (`-ss`, `-us`, `-is`) and a few irregular
 * and invariant words; `allow-tables` covers the rest. It knows nothing
 * about syntax or ORMs.
 */

/** lower_case_snake: lower-case words of letters and digits joined by single underscores. */
const SNAKE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/u;

/** Plurals that don't end in `s`, or end in `-oes`, and their singulars. */
const IRREGULAR: ReadonlyMap<string, string> = new Map([
  ["people", "person"],
  ["children", "child"],
  ["men", "man"],
  ["women", "woman"],
  ["mice", "mouse"],
  ["geese", "goose"],
  ["feet", "foot"],
  ["teeth", "tooth"],
  ["heroes", "hero"],
  ["potatoes", "potato"],
  ["tomatoes", "tomato"],
  ["echoes", "echo"],
]);

/** Words that end in `s` and are singular, or the same in both numbers. */
const INVARIANT: ReadonlySet<string> = new Set([
  "news",
  "series",
  "species",
  "alias",
  "canvas",
  "gas",
  "lens",
  "atlas",
  "bias",
]);

/** Words this short that end in `s` (`gas`, `bus`, `gps`) read as singular. */
const SHORTEST_PLURAL = 3;

/** Endings of singular words that end in `s`: address, status, analysis, analytics. */
const SINGULAR_S = /(?:ss|us|is|ics)$/u;

/** Plurals in `-ies` whose singular ends in `-ie`, not `-y`. */
const IE_PLURALS: ReadonlySet<string> = new Set([
  "movies",
  "cookies",
  "calories",
  "pies",
  "ties",
  "lies",
  "zombies",
]);

/** Plurals that add `-es` to a sibilant: addresses, boxes, batches, wishes, buzzes, statuses (not houses). */
const ES_PLURAL = /(?:ss|x|ch|sh|zz|[^aeiou]us)es$/u;

/** The suffixes a datetime or date column often carries instead of the configured one. */
const TIME_SUFFIXES: readonly string[] = [
  "_timestamp",
  "_datetime",
  "_date",
  "_time",
  "_at",
  "_on",
  "_ts",
  "_dt",
];

/**
 * Tells whether a name is lower_case_snake.
 *
 * @param name - a table name as written.
 * @returns true for names such as `post` or `post_like_2`.
 */
export function isSnake(name: string): boolean {
  return SNAKE.test(name);
}

/**
 * Turns a name into lower_case_snake: `UserAccount` and `user-account` give
 * `user_account`, `HTTPLog` gives `http_log`.
 *
 * @param name - a table name as written.
 * @returns the snake-case spelling; empty when the name has no letters or digits.
 */
export function toSnake(name: string): string {
  return name
    .replace(/(?<before>[a-z0-9])(?<after>[A-Z])/gu, "$<before>_$<after>")
    .replace(/(?<before>[A-Z]+)(?<after>[A-Z][a-z])/gu, "$<before>_$<after>")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "");
}

/**
 * Reads a word's singular, when the word reads as an English plural.
 *
 * @param word - one lower-case word.
 * @returns the singular, or undefined when the word reads as singular.
 */
function singularWord(word: string): string | undefined {
  const irregular = IRREGULAR.get(word);
  if (irregular !== undefined) {
    return irregular;
  }
  if (
    word.length <= SHORTEST_PLURAL ||
    !word.endsWith("s") ||
    INVARIANT.has(word) ||
    SINGULAR_S.test(word)
  ) {
    return undefined;
  }
  if (word.endsWith("ies") && !IE_PLURALS.has(word)) {
    return `${word.slice(0, -"ies".length)}y`;
  }
  return word.slice(0, -(ES_PLURAL.test(word) ? "es" : "s").length);
}

/**
 * Reads a snake-case table name's singular, when its last word reads as a
 * plural: `post_likes` gives `post_like`, `people` gives `person`.
 *
 * @param name - a lower_case_snake table name.
 * @returns the singular name, or undefined when the name reads as singular.
 */
export function singularOf(name: string): string | undefined {
  const cut = name.lastIndexOf("_") + 1;
  const singular = singularWord(name.slice(cut));
  return singular === undefined ? undefined : `${name.slice(0, cut)}${singular}`;
}

/**
 * Suggests a column name with the configured suffix: another time suffix
 * the name ends with is swapped for it (`due_date` becomes `due_at`),
 * otherwise the suffix is added (`created` becomes `created_at`).
 *
 * @param name - the column name as written.
 * @param suffix - the suffix the scheme requires.
 * @returns the suggested name.
 */
export function withSuffix(name: string, suffix: string): string {
  const other = TIME_SUFFIXES.find((s) => name.endsWith(s) && name.length > s.length);
  return `${other === undefined ? name : name.slice(0, -other.length)}${suffix}`;
}
