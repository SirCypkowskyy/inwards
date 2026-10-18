/**
 * @file Reads a rule page (`docs/chapters/rules/<code>.md`) the way
 * `explain_rule` serves it: the front matter's plain keys, and the `##`
 * sections by their anchor (`what-it-does`, `why-is-this-bad`, ...), each as
 * Markdown with the docs' test markers dropped and its relative links made
 * absolute, so they still work outside the site. Pure text work: the pages
 * come in as strings.
 */
import { posix } from "node:path";
import { DOCS_BASE } from "@inwards/core";

/** A rule page, read. */
export interface RulePage {
  /** The front matter's scalar keys (`description`, `status`, `autofix`, ...), as written. */
  meta: ReadonlyMap<string, string>;
  /** The `##` sections in page order, by anchor. */
  sections: { id: string; title: string; markdown: string }[];
}

/** The front matter: everything between the first two `---` lines. */
const FRONT_MATTER = /^---\n(?<body>[\s\S]*?\n)---\n/u;
/** One scalar key in the front matter, e.g. `status: stable`. */
const META_LINE = /^(?<key>[a-z_]+): (?<value>\S.*)$/u;
/** A fence that opens or closes a code block. */
const FENCE = /^\s*(?:`{3,}|~{3,})/u;
/** What an anchor drops from a heading: anything but letters, digits, spaces and dashes. */
const NOT_ANCHOR = /[^a-z0-9 -]/gu;
/** A line that is only an HTML comment, such as the docs tests' `<!-- e2e -->`. */
const COMMENT_LINE = /^<!--.*-->$/u;
/** A second-level heading. */
const H2 = /^## (?<title>.+?)\s*$/u;
/** A link target that is a page of the site, relative to the rules folder. */
const RELATIVE_LINK = /\]\((?<target>(?!https?:|#|mailto:)[^)\s]+?)\.md(?<hash>#[^)\s]*)?\)/gu;

/**
 * Turns a heading into its anchor, as the site does: lower case, words
 * joined by `-`, punctuation dropped.
 *
 * @param title - the heading's text.
 * @returns the anchor, e.g. `why-is-this-bad`.
 */
function anchorOf(title: string): string {
  return title.toLowerCase().replace(NOT_ANCHOR, "").trim().replace(/\s+/gu, "-");
}

/**
 * Makes a link to another page of the docs absolute: `INW011.md` is the
 * rule's page on the site, `../05-ADR.md#adr-009` the ADR chapter's.
 *
 * @param markdown - a section's Markdown.
 * @returns the Markdown with every relative `.md` link pointing at the published site.
 */
function absoluteLinks(markdown: string): string {
  return markdown.replace(
    RELATIVE_LINK,
    (_match: string, target: string, hash: string | undefined): string => {
      const page = posix.normalize(posix.join("rules", target));
      const path = page.endsWith("index") ? page.slice(0, -"index".length) : `${page}/`;
      return `](${DOCS_BASE}/${path}${hash ?? ""})`;
    },
  );
}

/**
 * Tidies a section for a reader outside the site: drops the HTML comments
 * the docs tests key on (`<!-- e2e -->`), the blank lines they leave, and
 * makes the links absolute.
 *
 * @param lines - the section's lines, without its heading.
 * @returns the section's Markdown, trimmed.
 */
function tidy(lines: readonly string[]): string {
  const kept = lines.filter((line) => !COMMENT_LINE.test(line.trim()));
  return absoluteLinks(
    kept
      .join("\n")
      .replace(/\n{3,}/gu, "\n\n")
      .trim(),
  );
}

/**
 * Reads the front matter's scalar keys.
 *
 * @param body - the front matter, without its `---` lines.
 * @returns the keys and their values, as written.
 */
function metaOf(body: string): Map<string, string> {
  const meta = new Map<string, string>();
  for (const line of body.split("\n")) {
    const found = META_LINE.exec(line)?.groups;
    if (found !== undefined) {
      meta.set(found["key"] ?? "", found["value"] ?? "");
    }
  }
  return meta;
}

/**
 * Splits a page's body at its `##` headings. A `##` inside a code block is
 * code, not a heading; text before the first heading belongs to none.
 *
 * @param lines - the body's lines, after the front matter.
 * @returns each heading's text with the lines under it.
 */
function splitSections(lines: readonly string[]): { title: string; lines: string[] }[] {
  const sections: { title: string; lines: string[] }[] = [];
  let fenced = false;
  for (const line of lines) {
    fenced = FENCE.test(line) ? !fenced : fenced;
    const title = fenced ? undefined : H2.exec(line)?.groups?.["title"];
    if (title === undefined) {
      sections.at(-1)?.lines.push(line);
    } else {
      sections.push({ title, lines: [] });
    }
  }
  return sections;
}

/**
 * Reads a rule page: its front matter's scalar keys and its `##` sections.
 *
 * @param text - the page's Markdown.
 * @returns the front matter's keys and the sections, in page order.
 */
export function readRulePage(text: string): RulePage {
  const front = FRONT_MATTER.exec(text);
  const body = text.slice(front?.[0].length ?? 0).split("\n");
  return {
    meta: metaOf(front?.groups?.["body"] ?? ""),
    sections: splitSections(body).map(sectionOf),
  };
}

/**
 * Finishes one section: its anchor, its title and its tidied Markdown.
 *
 * @param section - the heading's text and the lines under it.
 * @param section.title - the heading's text.
 * @param section.lines - the lines up to the next heading.
 * @returns the section's anchor, title and tidied Markdown.
 */
function sectionOf(section: { title: string; lines: string[] }): {
  id: string;
  title: string;
  markdown: string;
} {
  return { id: anchorOf(section.title), title: section.title, markdown: tidy(section.lines) };
}
