/**
 * @file The rule documentation pages (docs/chapters/rules, docs/pl/rules) agree
 * with the rule registry. Every rule has a page in both languages with the full
 * front matter, every diagnostic's link points at its page, and the index
 * marks the opt-in rules.
 */
import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { DOCS_BASE, RULES } from "@inwards/core";

// #49: every rule has a docs page, in English and in Polish, and every
// diagnostic links to its own. The pages' front matter follows OKF
// (`type: rule`) plus the Inwards fields #145 will validate in full.
const DOCS = resolve(import.meta.dir, "../../../../docs");
const SITES = { en: join(DOCS, "chapters/rules"), pl: join(DOCS, "pl/rules") };
const REPO_URL = "https://github.com/SirCypkowskyy/inwards";
const FRONT_MATTER = /^---\n(?<body>[\s\S]*?\n)---\n/u;
const REQUIRED = [
  "type",
  "title",
  "description",
  "code",
  "name",
  "severity",
  "suppressible",
  "autofix",
  "status",
  "tags",
  "resource",
  "timestamp",
  "related_issues",
];
const registered = Object.values(RULES);

/**
 * Reads a page's front matter.
 *
 * @param path - the page's absolute path.
 * @returns the parsed front matter, empty when the page has none.
 */
function frontMatter(path: string): Record<string, unknown> {
  const body = FRONT_MATTER.exec(readFileSync(path, "utf8"))?.groups?.["body"];
  const parsed: unknown = body === undefined ? {} : Bun.YAML.parse(body);
  return typeof parsed === "object" && parsed !== null
    ? Object.fromEntries(Object.entries(parsed))
    : {};
}

/**
 * Lists the rule pages of one site, without the index.
 *
 * @param dir - the site's rules directory.
 * @returns the page file names.
 */
function pages(dir: string): string[] {
  return readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "index.md");
}

test.each(registered)("$code links its diagnostics to its own page", (rule) => {
  expect(rule.docs).toBe(`${DOCS_BASE}/rules/${rule.code}/`);
});

test.each(Object.entries(SITES))("every registered rule has a page (%s)", (_site, dir) => {
  const have = new Set(pages(dir));
  expect(registered.map((r) => `${r.code}.md`).filter((page) => !have.has(page))).toEqual([]);
});

// Every page in either language, as [site, file name].
const allPages = Object.entries(SITES).flatMap(([site, dir]) =>
  pages(dir).map((page): [string, string] => [site, page]),
);

test.each(allPages)("%s/%s names a registered rule and carries the page contract", (site, page) => {
  const meta = frontMatter(join(site === "pl" ? SITES.pl : SITES.en, page));
  const rule = registered.find((r) => `${r.code}.md` === page);
  expect(REQUIRED.filter((key) => !(key in meta))).toEqual([]);
  expect(meta).toMatchObject({
    type: "rule",
    code: rule?.code ?? "not registered",
    name: rule?.name ?? "not registered",
    severity: rule?.severity ?? "not registered",
    title: `${rule?.code} ${rule?.name}`,
  });
  // "View source" points at a file that exists on this branch.
  const source = String(meta["resource"]).replace(`${REPO_URL}/blob/develop/`, "");
  expect(existsSync(resolve(DOCS, "..", source)) && source.startsWith("src/core/src/")).toBe(true);
});

test.each(pages(SITES.pl))("pl/rules/%s carries the English page's metadata", (page) => {
  // Only the prose (description) is translated; source and source_hash are the translation's own.
  const { description: _en, ...en } = frontMatter(join(SITES.en, page));
  const {
    description: _pl,
    source: _source,
    source_hash: _hash,
    ...pl
  } = frontMatter(join(SITES.pl, page));
  expect(pl).toEqual(en);
});

// #181: the rule index's Default column says "opt-in" for exactly the rules
// the registry turns off by default.
test.each(Object.entries(SITES))("the rule index marks opt-in rules (%s)", (_site, dir) => {
  const index = readFileSync(join(dir, "index.md"), "utf8");
  for (const rule of registered) {
    const row = index.split("\n").find((line) => line.startsWith(`| [${rule.code}]`));
    const cells = row?.split("|").map((cell) => cell.trim()) ?? [];
    expect([rule.code, cells[4]?.startsWith("opt-in")]).toEqual([
      rule.code,
      rule.default === "off",
    ]);
  }
});
