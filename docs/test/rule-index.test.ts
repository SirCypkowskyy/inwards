/**
 * @file The rule browser's view logic (issue #145): a view must survive a round
 * trip through the query string, invalid values must fall back to defaults,
 * and filtering, sorting and paging must pick the right rules. The browser
 * draws in the page, so this tests the pure part against the real rules.json.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  categoryPaths,
  DEFAULTS,
  type matches,
  parseState,
  toSearch,
  view,
} from "../chapters/javascripts/rule-index-state.mjs";

type Rule = Parameters<typeof matches>[0];

/**
 * Reads one site's rules.json, the data the browser loads.
 *
 * @param site - "chapters" for English, "pl" for Polish.
 * @returns the rules in file order.
 */
function load(site: string): Rule[] {
  const path = resolve(import.meta.dir, `../${site}/rules/rules.json`);
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  // biome-ignore lint/nursery/noUnsafeTypeAssertion: the file is written by scripts/check-rule-pages.py, which CI checks is current
  return (parsed as { rules: Rule[] }).rules;
}

const rules = load("chapters");

describe("rule browser state", () => {
  test("the default view has an empty query string", () => {
    expect(toSearch({ ...DEFAULTS }, "")).toBe("");
    expect(parseState("", rules)).toEqual({ ...DEFAULTS });
  });

  test("a view round-trips through the query string", () => {
    const state = {
      q: "import cycle",
      category: "imports/contexts",
      status: "stable",
      autofix: "no",
      sort: "-name",
      page: 2,
      per: 10,
    };
    const search = toSearch(state, "");
    expect(search).toBe(
      "?q=import%20cycle&category=imports/contexts&status=stable&autofix=no&sort=-name&page=2&per=10",
    );
    expect(parseState(search, rules)).toEqual(state);
    expect(parseState(toSearch({ ...DEFAULTS, per: 0 }, ""), rules).per).toBe(0);
  });

  test("other parameters in the query string are kept", () => {
    expect(toSearch({ ...DEFAULTS, status: "stable" }, "?h=layers&page=3")).toBe(
      "?status=stable&h=layers",
    );
  });

  test("invalid values fall back to the defaults", () => {
    const state = parseState(
      "?category=nope&status=done&autofix=maybe&sort=size&page=-1&per=7",
      rules,
    );
    expect(state).toEqual({ ...DEFAULTS });
  });

  test("category paths list every parent before its children", () => {
    const paths = categoryPaths(rules);
    expect(paths).toContain("imports");
    expect(paths).toContain("imports/contexts");
    expect(paths.indexOf("imports")).toBeLessThan(paths.indexOf("imports/layers"));
  });
});

describe("rule browser view", () => {
  test("the default view lists every rule, INW before FAPI", () => {
    const shown = view(rules, { ...DEFAULTS, per: 0 });
    expect(shown.total).toBe(rules.length);
    expect(shown.rows[0]?.code).toBe("INW000");
    expect(shown.rows.at(-1)?.code.startsWith("FAPI")).toBe(true);
  });

  test("a parent category includes its sub-categories", () => {
    const codes = view(rules, { ...DEFAULTS, category: "imports" }).rows.map((r) => r.code);
    expect(codes).toContain("INW001"); // imports/layers
    expect(codes).toContain("INW002"); // imports/contexts/slices
    expect(codes).not.toContain("FAPI001");
    const nested = view(rules, { ...DEFAULTS, category: "imports/contexts" }).rows;
    expect(nested.map((r) => r.code)).toEqual(["INW002", "INW003"]);
  });

  test("status, autofix and search filter", () => {
    expect(view(rules, { ...DEFAULTS, status: "backlog" }).total).toBe(
      rules.filter((r) => r.status === "backlog").length,
    );
    expect(view(rules, { ...DEFAULTS, autofix: "yes" }).total).toBe(
      rules.filter((r) => r.autofix).length,
    );
    expect(view(rules, { ...DEFAULTS, q: "ROUTE shadow" }).rows.map((r) => r.code)).toEqual([
      "FAPI005",
    ]);
  });

  test("sorting by name descending reverses the names", () => {
    const names = view(rules, { ...DEFAULTS, sort: "-name", per: 0 }).rows.map((r) => r.name);
    expect(names).toEqual([...names].sort().reverse());
  });

  test("pages split the list, and a page past the end shows the last one", () => {
    const first = view(rules, { ...DEFAULTS, per: 10, page: 1 });
    expect(first.rows).toHaveLength(Math.min(10, rules.length));
    expect(first.pages).toBe(Math.ceil(rules.length / 10));
    const late = view(rules, { ...DEFAULTS, per: 10, page: 99 });
    expect(late.page).toBe(first.pages);
    expect(late.first).toBe((first.pages - 1) * 10 + 1);
  });

  test("no match gives an empty first page", () => {
    expect(view(rules, { ...DEFAULTS, q: "no-such-rule-anywhere" })).toEqual({
      rows: [],
      total: 0,
      page: 1,
      pages: 1,
      first: 0,
    });
  });

  test("the Polish data lists the same rules in the same order", () => {
    expect(load("pl").map((r) => r.code)).toEqual(rules.map((r) => r.code));
  });
});
