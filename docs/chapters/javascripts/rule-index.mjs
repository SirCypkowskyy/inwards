// fallow-ignore-file unused-file
// Loaded via extra_javascript in docs/zensical.toml and docs/zensical.pl.toml,
// a TOML config fallow's JS import graph can't trace. Draws the rule browser
// on rules/index.md (issue #145) from rules.json, which
// scripts/check-rule-pages.py writes from the rule pages. The view logic is in
// rule-index-state.mjs, the labels in rule-index-text.mjs; every view is kept
// in the query string, so a link reproduces it.

import { element, inlineCode, select } from "./rule-index-dom.mjs";
import {
  categoryPaths,
  DEFAULTS,
  inCategory,
  PAGE_SIZES,
  parseState,
  STATUSES,
  toSearch,
  view,
} from "./rule-index-state.mjs";
import { labels } from "./rule-index-text.mjs";

/** The key each column's header sorts by, in column order; "" for a column that doesn't sort. */
const SORT_BY_COLUMN = ["code", "name", "", "status", ""];

/** The browser in one `[data-inwards-rules]` container. */
class RuleBrowser {
  /**
   * Keeps the data and reads the view the query string names; start() draws it.
   *
   * @param {HTMLElement} root - the container.
   * @param {import("./rule-index-state.mjs").RuleRecord[]} rules - the rules from rules.json.
   * @param {URL} data - where rules.json was loaded from; rule links resolve against it.
   */
  constructor(root, rules, data) {
    this.root = root;
    this.rules = rules;
    this.data = data;
    this.text = labels(document.documentElement.lang);
    this.state = parseState(location.search, rules);
  }

  /** Builds the controls and the table, wires them, and draws the first view. */
  start() {
    this.build();
    this.bind();
    this.draw(false);
  }

  /**
   * Counts the rules that pass a test, for the numbers in the filter options.
   *
   * @param {(rule: import("./rule-index-state.mjs").RuleRecord) => boolean} test - the test.
   * @returns {number} how many rules pass it.
   */
  count(test) {
    return this.rules.filter(test).length;
  }

  /** Creates the filters, the count line, the table, the empty state and the pager. */
  build() {
    const { text } = this;
    this.search = element("input", {
      type: "search",
      name: "q",
      placeholder: text.searchHint,
      autocomplete: "off",
      spellcheck: "false",
    });
    this.filters = element("form", { class: "inw-rules__filters", role: "search" }, [
      element("label", { class: "inw-rules__field inw-rules__field--search" }, [
        element("span", {}, [text.search]),
        element("span", { class: "inw-rules__box" }, [this.search]),
      ]),
      ...this.selects(),
    ]);
    this.status = element("p", { class: "inw-rules__count", "aria-live": "polite" });
    this.head = element("tr");
    this.body = element("tbody");
    this.table = element("table", { class: "inw-rules__table" }, [
      element("caption", { class: "inw-rules__caption" }, [text.caption]),
      element("thead", {}, [this.head]),
      this.body,
    ]);
    this.pager = element("nav", { class: "inw-rules__pages", "aria-label": text.pages });
    const sizes = PAGE_SIZES.map((n) => (n ? [String(n), String(n)] : ["all", text.all]));
    this.per = select("per", text.perPage, sizes);
    this.per.classList.add("inw-rules__per");
    this.empty = element("div", { class: "inw-rules__empty", hidden: "" }, [
      element("p", {}, [text.none]),
      element("button", { type: "button", class: "md-button" }, [text.clear]),
    ]);
    text.columns.forEach((label, index) => {
      const key = SORT_BY_COLUMN[index];
      const content = key
        ? element("button", { type: "button", "data-sort": key }, [label])
        : label;
      this.head.append(element("th", { scope: "col" }, [content]));
    });
    this.root.replaceChildren(
      this.filters,
      this.status,
      element("div", { class: "inw-rules__scroll" }, [this.table]),
      this.empty,
      element("div", { class: "inw-rules__footer" }, [this.pager, this.per]),
    );
  }

  /**
   * Builds the category, status and autofix filters, each option with the
   * number of rules it would show.
   *
   * @returns {HTMLElement[]} the three labelled selects.
   */
  selects() {
    const { text } = this;
    const any = ["", text.any];
    const categories = categoryPaths(this.rules).map((path) => [
      path,
      `${path.replaceAll("/", " › ")} (${this.count((rule) => inCategory(rule, path))})`,
    ]);
    const statuses = STATUSES.map((status) => [
      status,
      `${text.statuses[status]} (${this.count((rule) => rule.status === status)})`,
    ]);
    const fixes = [
      ["yes", `${text.yes} (${this.count((rule) => rule.autofix)})`],
      ["no", `${text.no} (${this.count((rule) => !rule.autofix)})`],
    ];
    return [
      select("category", text.category, [any, ...categories]),
      select("status", text.status, [any, ...statuses]),
      select("autofix", text.autofix, [any, ...fixes]),
    ];
  }

  /** Listens to the controls; every change redraws and rewrites the URL. */
  bind() {
    this.filters.addEventListener("submit", (event) => event.preventDefault());
    this.filters.addEventListener("input", (event) => {
      const { target } = event;
      if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement) {
        const value = target.name === "q" ? target.value.trim() : target.value;
        this.update({ [target.name]: value, page: 1 });
      }
    });
    this.per.addEventListener("change", (event) => {
      const value = event.target instanceof HTMLSelectElement ? event.target.value : "";
      this.update({ per: value === "all" ? 0 : Number(value), page: 1 });
    });
    this.head.addEventListener("click", (event) => {
      const button =
        event.target instanceof Element ? event.target.closest("button[data-sort]") : null;
      if (button instanceof HTMLButtonElement) {
        const key = button.dataset.sort || DEFAULTS.sort;
        this.update({ sort: this.state.sort === key ? `-${key}` : key, page: 1 });
      }
    });
    this.pager.addEventListener("click", (event) => this.onPage(event));
    this.empty.querySelector("button")?.addEventListener("click", () => {
      this.update({ ...DEFAULTS, sort: this.state.sort, per: this.state.per });
      this.search.focus();
    });
  }

  /**
   * Follows a pager link in place, without a page load. A modified click
   * (new tab or window) is left to the browser, which uses the link's href.
   *
   * @param {MouseEvent} event - a click in the pager.
   */
  onPage(event) {
    const link = event.target instanceof Element ? event.target.closest("a[data-page]") : null;
    const modified = event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
    if (link instanceof HTMLAnchorElement && !modified) {
      event.preventDefault();
      event.stopPropagation(); // the theme's instant navigation would load the page again
      this.update({ page: Number(link.dataset.page) });
      this.root.scrollIntoView({ block: "start" });
    }
  }

  /**
   * Changes part of the view and draws it.
   *
   * @param {Partial<import("./rule-index-state.mjs").ViewState>} change - the values that change.
   */
  update(change) {
    this.state = { ...this.state, ...change };
    this.draw(true);
  }

  /**
   * Draws the current view, and writes it to the address bar unless this is
   * the first draw, which only reads it. replaceState keeps the history to
   * one entry per page, so Back leaves the rule list instead of undoing a filter.
   *
   * @param {boolean} write - whether to rewrite the URL.
   */
  draw(write) {
    const shown = view(this.rules, this.state);
    this.state = { ...this.state, page: shown.page };
    if (write) {
      const url = new URL(location.href);
      url.search = toSearch(this.state, location.search);
      history.replaceState(history.state, "", url);
    }
    this.syncControls();
    this.body.replaceChildren(...shown.rows.map((rule) => this.row(rule)));
    const last = shown.first + shown.rows.length - 1;
    this.status.textContent = shown.total ? this.text.count(shown.total, shown.first, last) : "";
    this.table.hidden = shown.total === 0;
    this.empty.hidden = shown.total !== 0;
    this.pager.replaceChildren(...this.pagerItems(shown.page, shown.pages));
    this.pager.hidden = shown.pages < 2;
  }

  /** Sets every control, and the headers' aria-sort, to the current view. */
  syncControls() {
    const { state } = this;
    this.search.value = state.q;
    for (const control of this.filters.querySelectorAll("select")) {
      control.value = state[control.name];
    }
    const per = this.per.querySelector("select");
    if (per) {
      per.value = state.per ? String(state.per) : "all";
    }
    for (const th of this.head.querySelectorAll("th")) {
      const key = th.querySelector("button")?.dataset.sort;
      th.removeAttribute("aria-sort");
      if (key && state.sort === key) {
        th.setAttribute("aria-sort", "ascending");
      }
      if (key && state.sort === `-${key}`) {
        th.setAttribute("aria-sort", "descending");
      }
    }
  }

  /**
   * Builds one table row. The name cell also holds what the rule flags and
   * its default, from the index table. Each cell carries its column name for
   * the stacked layout on a phone.
   *
   * @param {import("./rule-index-state.mjs").RuleRecord} rule - the rule.
   * @returns {HTMLElement} the row.
   */
  row(rule) {
    const { text } = this;
    const { href } = new URL(rule.url, this.data);
    const cells = [
      [element("a", { href }, [element("code", {}, [rule.code])])],
      [
        element("div", {}, [
          element("code", { class: "inw-rules__name" }, [rule.name]),
          element("span", { class: "inw-rules__summary" }, inlineCode(rule.summary)),
          element("span", { class: "inw-rules__default" }, [`${text.default}: ${rule.default}`]),
        ]),
      ],
      [rule.category.join(" › ")],
      [text.statuses[rule.status] ?? rule.status],
      [rule.autofix ? text.yes : text.no],
    ];
    return element(
      "tr",
      {},
      cells.map((content, index) => element("td", { "data-label": text.columns[index] }, content)),
    );
  }

  /**
   * Builds the pager: Previous, a link per page, Next. The current page is a
   * span with aria-current. The links carry real hrefs, so they open in a
   * new tab too.
   *
   * @param {number} current - the page shown.
   * @param {number} pages - how many pages there are.
   * @returns {HTMLElement[]} the pager's items.
   */
  pagerItems(current, pages) {
    const { text } = this;
    const items = [];
    if (current > 1) {
      items.push(this.pageLink(current - 1, text.previous, { rel: "prev" }));
    }
    for (let page = 1; page <= pages; page += 1) {
      const name = `${text.page} ${page}`;
      items.push(
        page === current
          ? element("span", { "aria-current": "page", "aria-label": name }, [String(page)])
          : this.pageLink(page, String(page), { "aria-label": name }),
      );
    }
    if (current < pages) {
      items.push(this.pageLink(current + 1, text.next, { rel: "next" }));
    }
    return items;
  }

  /**
   * Builds a link to one page of the current view.
   *
   * @param {number} page - the page it opens.
   * @param {string} label - its text.
   * @param {Record<string, string>} attributes - more attributes, such as rel.
   * @returns {HTMLElement} the link.
   */
  pageLink(page, label, attributes) {
    const url = new URL(location.href);
    url.search = toSearch({ ...this.state, page }, location.search);
    return element("a", { href: url.href, "data-page": String(page), ...attributes }, [label]);
  }
}

/**
 * Loads rules.json and starts the browser in a container, once. When the data
 * can't be loaded, the container stays empty and the static tables stay.
 *
 * @param {HTMLElement} root - the `[data-inwards-rules]` container.
 * @returns {Promise<void>} settles once the browser is drawn or has given up.
 */
async function mount(root) {
  if (root.dataset.mounted) {
    return;
  }
  root.dataset.mounted = "true";
  const data = new URL(root.dataset.inwardsRules || "rules.json", location.href);
  try {
    const response = await fetch(data);
    const { rules } = await response.json();
    new RuleBrowser(root, rules, data).start();
  } catch (error) {
    console.warn("inwards: could not load the rule index data; the static tables stay", error);
    return;
  }
  for (const fallback of document.querySelectorAll(".inw-rules-fallback")) {
    fallback.setAttribute("hidden", "");
  }
}

/**
 * Mounts the browser on the current page, if it has one. Runs on the first
 * load and after every instant navigation.
 */
function wire() {
  for (const root of document.querySelectorAll("[data-inwards-rules]")) {
    if (root instanceof HTMLElement) {
      mount(root);
    }
  }
}

// `document$` (the theme's instant-navigation observable) replays the first
// page load, so subscribing covers it; without the theme's script, run once.
if (globalThis.document$ && typeof globalThis.document$.subscribe === "function") {
  globalThis.document$.subscribe(wire);
} else {
  wire();
}
