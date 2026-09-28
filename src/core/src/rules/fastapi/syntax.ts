/**
 * @file How a FAPI finding points at and talks about the code: a node's span,
 * the span of a path operation's decorator, where one finding per endpoint goes (and where an
 * inline suppression goes), the decorator as a message quotes it, and word
 * lists. It only reads the syntax the model recorded.
 */
import type { Node } from "web-tree-sitter";
import type { Span } from "../../contracts/records.ts";
import { argumentAt } from "../../python/literals.ts";
import type { PathOperation } from "./records.ts";

/**
 * Gives a node's 1-based span.
 *
 * @param node - a syntax node.
 * @returns where it starts and ends.
 */
export function spanOf(node: Node): Span {
  return {
    line: node.startPosition.row + 1,
    column: node.startPosition.column + 1,
    endLine: node.endPosition.row + 1,
    endColumn: node.endPosition.column + 1,
  };
}

/**
 * Spans a call, from the decorator's `@` when the call is a decorator.
 *
 * @param call - a `call` node.
 * @returns the 1-based span.
 */
export function callSpan(call: Node): Span {
  const start = call.parent?.type === "decorator" ? call.parent : call;
  return {
    ...spanOf(call),
    line: start.startPosition.row + 1,
    column: start.startPosition.column + 1,
  };
}

/**
 * Spans a path operation's decorator, from its `@` to the end of the call.
 *
 * @param op - the path operation.
 * @returns the 1-based span.
 */
export function decoratorSpan(op: PathOperation): Span {
  return callSpan(op.node);
}

/**
 * Quotes a decorator by its callee and path, e.g. `@router.post("/orders")`.
 *
 * @param op - the path operation.
 * @returns the short form, without the other arguments.
 */
export function decoratorText(op: PathOperation): string {
  const callee = op.node.childForFieldName("function")?.text ?? op.decorator;
  const path = argumentAt(op.node, 0, "path");
  return `@${callee}(${path?.text ?? ""})`;
}

/**
 * Joins words as English lists them.
 *
 * @param words - the items, in order.
 * @param conjunction - the word before the last one.
 * @returns "a", "a and b", or "a, b and c".
 */
export function joined(words: readonly string[], conjunction = "and"): string {
  return words.length <= 1
    ? (words[0] ?? "")
    : `${words.slice(0, -1).join(", ")} ${conjunction} ${words.at(-1) ?? ""}`;
}
