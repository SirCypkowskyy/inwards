/**
 * @file How a FAPI finding points at and talks about a path operation: the
 * span of its decorator, where one finding per endpoint goes (and where an
 * inline suppression goes), and the decorator as a message quotes it. It
 * only reads the syntax the model recorded.
 */
import type { Node } from "web-tree-sitter";
import type { Span } from "../../contracts/records.ts";
import { argumentAt } from "../../python/literals.ts";
import type { PathOperation } from "./records.ts";

/**
 * Spans a syntax node, 1-based.
 *
 * @param node - any syntax node.
 * @returns its span.
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
 * Spans a decorator call, from its `@` to the end of the call.
 *
 * @param op - a path operation, or any record of a call that may be a decorator.
 * @param op.node - the call.
 * @returns the 1-based span.
 */
export function decoratorSpan(op: { readonly node: Node }): Span {
  const start = op.node.parent?.type === "decorator" ? op.node.parent : op.node;
  return {
    ...spanOf(start),
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
