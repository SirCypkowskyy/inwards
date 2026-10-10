// fallow-ignore-file unused-file
// fallow-ignore-file unused-export
// Imported only by rule-index.mjs, which the docs configs load and fallow
// can't reach, so its imports look unused to fallow.
// The rule browser's interface text (issue #145) in each language the docs
// site has. Rule data (codes, names, categories, summaries) comes from
// rules.json, which is already in the page's language; only labels live here.

/**
 * Picks the Polish plural of "reguła" for a count: 1 reguła, 3 reguły, 16 reguł.
 *
 * @param {number} count - how many rules.
 * @returns {string} the noun in the form the count needs.
 */
function polishRules(count) {
  const form = new Intl.PluralRules("pl").select(count);
  if (form === "one") {
    return "reguła";
  }
  return form === "few" ? "reguły" : "reguł";
}

/**
 * The English count line: "16 rules" when every match is shown, else the range.
 *
 * @param {number} total - how many rules match.
 * @param {number} first - the 1-based position of the first row shown.
 * @param {number} last - the position of the last row shown.
 * @returns {string} the line for the live region above the table.
 */
function englishCount(total, first, last) {
  if (first === 1 && last === total) {
    return `${total} ${total === 1 ? "rule" : "rules"}`;
  }
  return `Rules ${first} to ${last} of ${total}`;
}

/**
 * The Polish count line: "16 reguł" when every match is shown, else the range.
 *
 * @param {number} total - how many rules match.
 * @param {number} first - the 1-based position of the first row shown.
 * @param {number} last - the position of the last row shown.
 * @returns {string} the line for the live region above the table.
 */
function polishCount(total, first, last) {
  if (first === 1 && last === total) {
    return `${total} ${polishRules(total)}`;
  }
  return `Reguły od ${first} do ${last} z ${total}`;
}

/** Labels for English pages. */
const EN = {
  search: "Search",
  searchHint: "Code, name or words",
  category: "Category",
  status: "Status",
  autofix: "Autofix",
  any: "Any",
  yes: "yes",
  no: "no",
  statuses: {
    stable: "stable",
    "in-review": "in review",
    "in-development": "in development",
    backlog: "backlog",
  },
  columns: ["Code", "Name", "Category", "Status", "Autofix"],
  default: "Default",
  perPage: "Rules per page",
  all: "All",
  previous: "Previous",
  next: "Next",
  pages: "Pages",
  page: "Page",
  count: englishCount,
  none: "No rule matches these filters.",
  clear: "Clear filters",
  caption: "Rules, filtered and sorted by the controls above",
};

/** Labels for Polish pages, in the terms of docs/GLOSSARY.pl.md. */
const PL = {
  search: "Szukaj",
  searchHint: "Kod, nazwa albo słowa",
  category: "Kategoria",
  status: "Status",
  autofix: "Poprawka automatyczna",
  any: "Dowolna",
  yes: "tak",
  no: "nie",
  statuses: {
    stable: "stabilna",
    "in-review": "w przeglądzie",
    "in-development": "w rozwoju",
    backlog: "w planach",
  },
  columns: ["Kod", "Nazwa", "Kategoria", "Status", "Poprawka automatyczna"],
  default: "Domyślnie",
  perPage: "Reguł na stronie",
  all: "Wszystkie",
  previous: "Poprzednia",
  next: "Następna",
  pages: "Strony",
  page: "Strona",
  count: polishCount,
  none: "Żadna reguła nie pasuje do tych filtrów.",
  clear: "Wyczyść filtry",
  caption: "Reguły przefiltrowane i posortowane według ustawień powyżej",
};

/**
 * Picks the labels for a page's language.
 *
 * @param {string} lang - the page's `lang` attribute.
 * @returns {typeof EN} the Polish labels for "pl", the English ones otherwise.
 */
export function labels(lang) {
  return lang.startsWith("pl") ? PL : EN;
}
