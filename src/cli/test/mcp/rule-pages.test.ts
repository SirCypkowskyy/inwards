/**
 * @file The rule pages `explain_rule` serves: the binary embeds one for every
 * rule the registry has, and every page gives the four sections the tool
 * answers with by default, so a new rule can't ship without its page in
 * `inwards mcp`. Also how a page is read: headings inside code blocks stay
 * code, test markers go, and relative links become the site's.
 */
import { expect, test } from "bun:test";
import { RULES } from "@inwards/core";
import { RULE_PAGES } from "../../src/adapters/rule-pages.ts";
import { readRulePage } from "../../src/mcp/rule-page.ts";

test("every registered rule has an embedded page, and nothing else does", () => {
  expect([...RULE_PAGES.keys()].sort()).toEqual(Object.keys(RULES).sort());
});

test("every page has what it does, why, an example and how to fix, each with text", () => {
  for (const [code, text] of RULE_PAGES) {
    const page = readRulePage(text);
    const ids = page.sections.map((s) => s.id);
    for (const id of ["what-it-does", "why-is-this-bad", "example", "how-to-fix"]) {
      expect(`${code} ${ids.includes(id)}`).toBe(`${code} true`);
    }
    expect(page.sections.every((s) => s.markdown.length > 0)).toBe(true);
    expect(page.meta.get("code")).toBe(code);
  }
});

test("a page is read with code blocks intact, markers dropped and links made absolute", () => {
  const page = readRulePage(
    [
      "---",
      "type: rule",
      "status: stable",
      "---",
      "",
      "# X",
      "",
      "## What it does",
      "",
      "See [INW011](INW011.md), [rules](index.md#configure-rules) and [ADR-9](../05-ADR.md#adr-009).",
      "",
      "<!-- e2e -->",
      "",
      "```python",
      "## not a heading",
      "```",
      "",
      "## Why is this bad",
      "",
      "Because.",
    ].join("\n"),
  );
  expect(page.meta.get("status")).toBe("stable");
  expect(page.sections.map((s) => s.id)).toEqual(["what-it-does", "why-is-this-bad"]);
  const base = "https://sircypkowskyy.github.io/inwards";
  expect(page.sections[0]?.markdown).toBe(
    [
      `See [INW011](${base}/rules/INW011/), [rules](${base}/rules/#configure-rules) and [ADR-9](${base}/05-ADR/#adr-009).`,
      "",
      "```python",
      "## not a heading",
      "```",
    ].join("\n"),
  );
});
