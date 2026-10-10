// The rule browser's view logic (issue #145), with no DOM: reading and writing
// a view in the query string, and filtering, sorting and paging the rules for
// it. rule-index.mjs draws the result; docs/test/rule-index.test.ts tests it.

/** Statuses of the rule page contract (#49), in the order "sort by status" uses. */
export const STATUSES = ["stable", "in-review", "in-development", "backlog"];

/** The page size with no `per` in the query string. */
const DEFAULT_PAGE_SIZE = 25;

/** The largest page size short of every rule on one page. */
const LARGE_PAGE_SIZE = 50;

/** The page sizes a reader can pick; 0 means every rule on one page. */
export const PAGE_SIZES = [10, DEFAULT_PAGE_SIZE, LARGE_PAGE_SIZE, 0];

/** The sort keys, each also allowed with a leading "-" for descending. */
const SORT_KEYS = ["code", "name", "status"];

/** A leading minus, which makes a sort descending. */
const DESCENDING = /^-/u;

/** The number at the end of a rule code. */
const CODE_NUMBER = /[0-9]+$/u;

/** Whitespace between search words. */
const SPACES = /\s+/u;

/**
 * @typedef {object} ViewState
 * @property {string} q - the search text.
 * @property {string} category - a category path ("imports/layers"), or "" for any.
 * @property {string} status - one of STATUSES, or "" for any.
 * @property {string} autofix - "yes", "no", or "" for any.
 * @property {string} sort - a sort key, "-" first for descending.
 * @property {number} page - the 1-based page.
 * @property {number} per - rules per page, 0 for all.
 */

/**
 * @typedef {object} RuleRecord
 * @property {string} code - the rule code, INW001.
 * @property {string} name - the kebab-case rule name.
 * @property {string} summary - what it flags, from the index table, with `code` spans.
 * @property {string} description - the page's front matter description.
 * @property {string[]} category - the category path, parent first.
 * @property {string} status - one of STATUSES.
 * @property {boolean} autofix - whether a fix applies unattended.
 * @property {string} default - the index table's Default cell.
 * @property {string} url - the rule page, relative to the index.
 */

/** @type {Readonly<ViewState>} The view with no query string: every rule, by code. */
export const DEFAULTS = Object.freeze({
  q: "",
  category: "",
  status: "",
  autofix: "",
  sort: "code",
  page: 1,
  per: DEFAULT_PAGE_SIZE,
});

/** The query parameters the browser owns; any other parameter is kept as it is. */
const PARAMS = ["q", "category", "status", "autofix", "sort", "page", "per"];

/**
 * Reads a view from a query string, falling back to the default for any
 * value that isn't valid, so a hand-edited or stale link still opens a view.
 *
 * @param {string} search - the query string, with or without its "?".
 * @param {RuleRecord[]} rules - the rules, to check that a category exists.
 * @returns {ViewState} the view.
 */
export function parseState(search, rules) {
  const params = new URLSearchParams(search);
  /**
   * Reads one parameter.
   *
   * @param {string} key - the parameter name.
   * @returns {string} its value, "" when it is absent.
   */
  function get(key) {
    return params.get(key) ?? "";
  }
  const sort = get("sort");
  const per = get("per") === "all" ? 0 : Number(get("per"));
  const page = Number(get("page"));
  return {
    q: get("q").trim(),
    category: categoryPaths(rules).includes(get("category")) ? get("category") : "",
    status: STATUSES.includes(get("status")) ? get("status") : "",
    autofix: ["yes", "no"].includes(get("autofix")) ? get("autofix") : "",
    sort: SORT_KEYS.includes(sort.replace(DESCENDING, "")) ? sort : DEFAULTS.sort,
    page: Number.isInteger(page) && page > 0 ? page : 1,
    per: params.has("per") && PAGE_SIZES.includes(per) ? per : DEFAULTS.per,
  };
}

/**
 * Writes a view into a query string, leaving out every value that is the
 * default and keeping parameters the browser doesn't own (the theme's
 * search highlight, `h`, for one). A category path keeps its slashes.
 *
 * @param {ViewState} state - the view.
 * @param {string} search - the current query string, whose other parameters are kept.
 * @returns {string} the new query string with its "?", or "" when nothing is left.
 */
export function toSearch(state, search) {
  const kept = new URLSearchParams(search);
  for (const key of PARAMS) {
    kept.delete(key);
  }
  const parts = [];
  for (const key of PARAMS) {
    const value = key === "per" && state.per === 0 ? "all" : String(state[key]);
    if (value !== String(DEFAULTS[key])) {
      parts.push(`${key}=${encodeURIComponent(value).replaceAll("%2F", "/")}`);
    }
  }
  const rest = kept.toString();
  if (rest) {
    parts.push(rest);
  }
  return parts.length > 0 ? `?${parts.join("&")}` : "";
}

/**
 * Lists every category path the rules use, each parent before its children:
 * a rule tagged `[imports, contexts]` adds "imports" and "imports/contexts".
 *
 * @param {RuleRecord[]} rules - the rules.
 * @returns {string[]} the paths, sorted.
 */
export function categoryPaths(rules) {
  const paths = new Set();
  for (const rule of rules) {
    rule.category.forEach((_tag, depth) => {
      paths.add(rule.category.slice(0, depth + 1).join("/"));
    });
  }
  return [...paths].sort();
}

/**
 * Tells whether a rule is filed under a category path, at any depth.
 *
 * @param {RuleRecord} rule - the rule.
 * @param {string} path - the category path, "" for any.
 * @returns {boolean} true when the rule's path is the path or below it.
 */
export function inCategory(rule, path) {
  return !path || `${rule.category.join("/")}/`.startsWith(`${path}/`);
}

/**
 * Tells whether a rule passes the view's filters. The search looks at the
 * code, the name, both summaries and the category, ignoring case, and every
 * word must appear.
 *
 * @param {RuleRecord} rule - the rule.
 * @param {ViewState} state - the view.
 * @returns {boolean} true when the rule is shown.
 */
export function matches(rule, state) {
  if (!inCategory(rule, state.category)) {
    return false;
  }
  if (state.status && rule.status !== state.status) {
    return false;
  }
  if (state.autofix && rule.autofix !== (state.autofix === "yes")) {
    return false;
  }
  const words = state.q.toLowerCase().split(SPACES).filter(Boolean);
  const text = [rule.code, rule.name, rule.summary, rule.description, ...rule.category]
    .join(" ")
    .toLowerCase();
  return words.every((word) => text.includes(word));
}

/**
 * Builds the comparison for a sort key. Sorting by code keeps the families in
 * the order the rules come in (INW, then FAPI) and numbers ascending inside
 * each; ties under the other keys fall back to that order.
 *
 * @param {RuleRecord[]} rules - the rules, in rules.json order.
 * @param {string} sort - the sort key, "-" first for descending.
 * @returns {(a: RuleRecord, b: RuleRecord) => number} the comparison.
 */
function comparison(rules, sort) {
  const families = [...new Set(rules.map((rule) => family(rule.code)))];
  const direction = sort.startsWith("-") ? -1 : 1;
  const key = sort.replace(DESCENDING, "");
  /**
   * Orders two rules by family, then code.
   *
   * @param {RuleRecord} a - one rule.
   * @param {RuleRecord} b - the other.
   * @returns {number} negative when a comes first.
   */
  function byCode(a, b) {
    const rank = families.indexOf(family(a.code)) - families.indexOf(family(b.code));
    return rank || a.code.localeCompare(b.code);
  }
  if (key === "name") {
    return (a, b) => direction * a.name.localeCompare(b.name) || byCode(a, b);
  }
  if (key === "status") {
    return (a, b) =>
      direction * (STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status)) || byCode(a, b);
  }
  return (a, b) => direction * byCode(a, b);
}

/**
 * Filters, sorts and pages the rules for a view. A page past the end shows
 * the last page.
 *
 * @param {RuleRecord[]} rules - the rules, in rules.json order.
 * @param {ViewState} state - the view.
 * @returns {{rows: RuleRecord[], total: number, page: number, pages: number, first: number}}
 *   the rules on this page, how many matched, the page shown, the page count,
 *   and the 1-based position of the first row (0 when nothing matched).
 */
export function view(rules, state) {
  const found = rules.filter((rule) => matches(rule, state)).sort(comparison(rules, state.sort));
  const size = state.per || found.length || 1;
  const pages = Math.max(1, Math.ceil(found.length / size));
  const page = Math.min(state.page, pages);
  const rows = found.slice((page - 1) * size, page * size);
  const first = rows.length > 0 ? (page - 1) * size + 1 : 0;
  return { rows, total: found.length, page, pages, first };
}

/**
 * Takes the family prefix of a rule code: "FAPI" from "FAPI001".
 *
 * @param {string} code - the rule code.
 * @returns {string} the letters before the number.
 */
function family(code) {
  return code.replace(CODE_NUMBER, "");
}
