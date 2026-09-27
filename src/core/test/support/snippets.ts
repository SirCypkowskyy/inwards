/**
 * @file Finds the `[tool.inwards]` examples in the docs and checks each one as
 * its marker says. Fences are read structurally (backticks or tildes, any
 * indent), and a snippet is recognised from its parsed TOML, so no spelling of
 * the table (`["tool"."inwards"]`, `[tool . inwards]`) slips past. Every
 * `<!-- config: … -->` marker must sit one blank line before an Inwards TOML
 * fence and be `fragment` or `invalid <key>`; the key is the one the parser
 * error must name, so an unrelated error can't pass for the intended one.
 */
import { parse } from "smol-toml";
import { isRecord } from "../../src/config/toml.ts";
import { merged, parserError, schemaErrors } from "./config-schema.ts";

/** A fence opening line: indent, three or more backticks or tildes, info string. */
const OPEN = /^(?<indent>\s*)(?<fence>`{3,}|~{3,})\s*(?<info>.*)$/u;
/** A marker line, whatever it says. */
const MARKER_LINE = /^\s*<!--\s*config\s*:\s*(?<rest>[^>]*?)\s*-->\s*$/u;
/** Any mention of a config marker, so one not on a line of its own is caught too. */
const MARKER_ANYWHERE = /<!--\s*config\s*:/gu;
/** Runs of whitespace, between words of an info string or a marker. */
const WHITESPACE = /\s+/u;
/** A spelling of the table's name in text TOML can't parse. */
const TABLE_TEXT = /\btool\s*\.\s*inwards\b|["']tool["']\s*\.\s*["']inwards["']/u;

/** One fenced code block. */
export interface Fence {
  /** The first word of the info string, e.g. `toml`. */
  lang: string;
  /** The content, with the fence's indent removed. */
  body: string;
  /** The 1-based line of the opening fence. */
  line: number;
  /** What the marker before it says (`fragment`, `invalid tool.inwards.x`), if any. */
  marker?: string;
}

/**
 * Reads the fenced code blocks of a Markdown page, with the marker before each.
 *
 * @param markdown - the page's text.
 * @returns the fences, in page order.
 */
export function fences(markdown: string): Fence[] {
  const lines = markdown.split("\n");
  const found: Fence[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const open = OPEN.exec(lines[i] ?? "")?.groups;
    if (open !== undefined) {
      const end = closingLine(lines, i, open["fence"] ?? "```");
      const marker = markerBefore(lines, i);
      found.push({
        lang: (open["info"] ?? "").split(WHITESPACE)[0] ?? "",
        body: dedent(lines.slice(i + 1, end), (open["indent"] ?? "").length),
        line: i + 1,
        ...(marker === undefined ? {} : { marker }),
      });
      i = end;
    }
  }
  return found;
}

/**
 * Finds the line that closes a fence: the same character, at least as many.
 *
 * @param lines - the page's lines.
 * @param open - the index of the opening line.
 * @param fence - the opening fence, e.g. three backticks.
 * @returns the index of the closing line, or the line count when it's never closed.
 */
function closingLine(lines: readonly string[], open: number, fence: string): number {
  const char = fence.startsWith("`") ? "`" : "~";
  let end = open + 1;
  while (end < lines.length) {
    const line = (lines[end] ?? "").trim();
    if (line.length >= fence.length && [...line].every((c) => c === char)) {
      return end;
    }
    end += 1;
  }
  return end;
}

/**
 * Reads the config marker on the line before the blank line before a fence.
 *
 * @param lines - the page's lines.
 * @param open - the index of the fence's opening line.
 * @returns what the marker says, or undefined when there is none there.
 */
function markerBefore(lines: readonly string[], open: number): string | undefined {
  if (open < 2 || lines[open - 1]?.trim() !== "") {
    return undefined;
  }
  return MARKER_LINE.exec(lines[open - 2] ?? "")?.groups?.["rest"];
}

/**
 * Removes a fence's indent from its content lines.
 *
 * @param lines - the lines between the fences.
 * @param indent - the opening fence's indent.
 * @returns the content, joined.
 */
function dedent(lines: readonly string[], indent: number): string {
  return lines
    .map((line) => line.slice(Math.min(indent, line.length - line.trimStart().length)))
    .join("\n");
}

/**
 * Tells whether a TOML snippet is about Inwards' config, from its parsed
 * table when it parses, else from the text.
 *
 * @param body - the fence's TOML.
 * @returns true when it holds `[tool.inwards]` in any spelling.
 */
export function isInwardsSnippet(body: string): boolean {
  try {
    const doc = parse(body);
    return isRecord(doc["tool"]) && doc["tool"]["inwards"] !== undefined;
  } catch {
    return TABLE_TEXT.test(body);
  }
}

/**
 * Checks every Inwards TOML example of a page and every marker on it.
 *
 * @param path - the page's path, for messages.
 * @param markdown - the page's text.
 * @returns one line per problem, empty when the page is fine.
 */
export function snippetProblems(path: string, markdown: string): string[] {
  const problems: string[] = [];
  let attached = 0;
  for (const fence of fences(markdown)) {
    const where = `${path}:${fence.line}`;
    const inwards = fence.lang === "toml" && isInwardsSnippet(fence.body);
    if (fence.marker !== undefined) {
      attached += 1;
      if (!inwards) {
        problems.push(`${where}: a config marker before a fence that isn't [tool.inwards] TOML`);
        continue;
      }
    }
    if (inwards) {
      problems.push(...fenceProblems(where, fence.body, fence.marker));
    }
  }
  const markers = (markdown.match(MARKER_ANYWHERE) ?? []).length;
  if (markers !== attached) {
    problems.push(
      `${path}: ${markers - attached} config marker(s) not one blank line before a fence`,
    );
  }
  return problems;
}

/**
 * Checks one Inwards example as its marker classifies it.
 *
 * @param where - the page and line, for messages.
 * @param body - the fence's TOML.
 * @param marker - what the marker says, or undefined for a complete config.
 * @returns one line per problem, empty when the example is fine.
 */
function fenceProblems(where: string, body: string, marker: string | undefined): string[] {
  const words = (marker ?? "").split(WHITESPACE).filter(Boolean);
  const [kind] = words;
  const known =
    marker === undefined || (kind === "fragment" && words.length === 1) || kind === "invalid";
  if (!known) {
    return [`${where}: unknown config marker "${marker}"; use "fragment" or "invalid <key>"`];
  }
  let config: string;
  try {
    config = marker === undefined ? body : merged(body);
  } catch (err) {
    return [`${where}: not valid TOML: ${err instanceof Error ? err.message : String(err)}`];
  }
  return kind === "invalid"
    ? invalidProblems(where, config, words.slice(1))
    : validProblems(where, config, marker === undefined);
}

/**
 * Checks an example marked invalid: the parser must fail, naming its key.
 *
 * @param where - the page and line, for messages.
 * @param config - the example merged into the minimal config.
 * @param args - the words after `invalid`: exactly one key.
 * @returns one line per problem, empty when the example fails as marked.
 */
function invalidProblems(where: string, config: string, args: readonly string[]): string[] {
  const [key] = args;
  if (key === undefined || args.length > 1) {
    return [`${where}: an invalid example must name the one key its error names`];
  }
  const error = parserError(config);
  if (error?.includes(key) === true) {
    return [];
  }
  return [
    `${where}: marked invalid for ${key}, but ${error === undefined ? "it parses" : `the error is: ${error}`}`,
  ];
}

/**
 * Checks a complete config or a merged fragment: it must parse and validate.
 *
 * @param where - the page and line, for messages.
 * @param config - the config's text.
 * @param complete - true for an unmarked example, for the message.
 * @returns one line per problem, empty when it parses and validates.
 */
function validProblems(where: string, config: string, complete: boolean): string[] {
  const error = parserError(config);
  if (error !== undefined) {
    return [`${where}: ${complete ? "complete config" : "fragment"}: ${error}`];
  }
  return schemaErrors(config).map((problem) => `${where}: schema: ${problem}`);
}
