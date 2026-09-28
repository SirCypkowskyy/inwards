/**
 * @file How a FAPI finding points at and talks about a path operation: the
 * span of its decorator, where one finding per endpoint goes (and where an
 * inline suppression goes), the decorator as a message quotes it, and word
 * lists. It only reads the syntax the model recorded.
 */
import type { Span } from "../../contracts/records.ts";
import { argumentAt } from "../../python/literals.ts";
import type { PathOperation } from "./records.ts";

/**
 * Spans a path operation's decorator, from its `@` to the end of the call.
 *
 * @param op - the path operation.
 * @returns the 1-based span.
 */
export function decoratorSpan(op: PathOperation): Span {
  const start = op.node.parent?.type === "decorator" ? op.node.parent : op.node;
  return {
    line: start.startPosition.row + 1,
    column: start.startPosition.column + 1,
    endLine: op.node.endPosition.row + 1,
    endColumn: op.node.endPosition.column + 1,
  };
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
