/**
 * @file Where a syntax node sits and how a message quotes it: the 1-based
 * span a finding points at, and a statement's first line cut to a length.
 * INW014 and INW020 word their findings with these. It reads one node and
 * decides nothing about what is reported.
 */
import type { Node } from "web-tree-sitter";
import type { Span } from "../../shared/contracts/records.ts";

/** What a cut quote ends with. */
const CUT = "...";

/**
 * Spans a node.
 *
 * @param node - any node, such as a class's name or a whole statement.
 * @returns the 1-based span from its first to its last character.
 */
export function nodeSpan(node: Node): Span {
  return {
    line: node.startPosition.row + 1,
    column: node.startPosition.column + 1,
    endLine: node.endPosition.row + 1,
    endColumn: node.endPosition.column + 1,
  };
}

/**
 * Quotes a statement's first line for a message, cut to a length.
 *
 * @param statement - a statement node.
 * @param max - the longest quote, `...` included.
 * @returns the first line, cut with `...` when it is longer than `max`.
 */
export function firstLine(statement: Node, max: number): string {
  const [first = ""] = statement.text.split("\n");
  return first.length > max ? `${first.slice(0, max - CUT.length)}${CUT}` : first;
}
