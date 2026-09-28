/**
 * @file Folds the constant string expressions Python computes from constants:
 * `+`, `%` with `%s`, `*` by an integer literal, `sep.join([...])`,
 * `template.format(...)`, and slicing or indexing by integer literals.
 * Operands are read through a callback, the caller's `constantValue`, so
 * this module doesn't know about literals or names; the string arithmetic
 * itself is in `string-ops.ts`.
 */
import type { Node } from "web-tree-sitter";
import {
  identifierName,
  integerLiteral,
  keywordOf,
  namedChildren,
  signedInteger,
} from "./nodes.ts";
import { braceFormatted, percentFormatted, repeated, sliced } from "./string-ops.ts";

/** A decoded string or bytes constant. */
export interface Literal {
  value: string;
  /** True for `b"..."`; `value` then holds one character per byte. */
  bytes: boolean;
}

/** Reads an expression as a constant, or null when it isn't one. */
export type Fold = (node: Node) => Literal | null;

/**
 * Joins constant parts into one value, as Python's concatenation does.
 *
 * @param parts - the decoded parts, null where a part is not constant.
 * @returns the joined value, or null when a part is missing or str is mixed with bytes.
 */
export function joined(parts: readonly (Literal | null)[]): Literal | null {
  const [first] = parts;
  if (!first || parts.some((part) => part === null || part.bytes !== first.bytes)) {
    return null; // not all constant, or str mixed with bytes
  }
  return { value: parts.map((part) => part?.value ?? "").join(""), bytes: first.bytes };
}

/**
 * Folds `a + b`, `a % b` and `a * n` (or `n * a`) over constants.
 *
 * @param node - a `binary_operator` node.
 * @param fold - reads a sub-expression as a constant, the caller's `constantValue`.
 * @returns the value, or null when an operand isn't constant or the operator isn't one of these.
 */
export function operatorValue(node: Node, fold: Fold): Literal | null {
  const left = node.childForFieldName("left");
  const right = node.childForFieldName("right");
  if (!(left && right)) {
    return null;
  }
  switch (node.childForFieldName("operator")?.type) {
    case "+":
      return joined([fold(left), fold(right)]);
    case "%":
      return percentValue(left, right, fold);
    case "*": {
      const [text, count] = left.type === "integer" ? [right, left] : [left, right];
      const base = fold(text);
      const times = integerLiteral(count);
      return withValue(base, base && times !== null ? repeated(base.value, times) : null);
    }
    default:
      return null;
  }
}

/**
 * Pairs a folded value with the type of the constant it came from.
 *
 * @param base - the constant the operation started from, or null.
 * @param value - the result, or null when the operation couldn't be folded.
 * @returns the result as a constant of the same type, or null.
 */
function withValue(base: Literal | null, value: string | null): Literal | null {
  return base && value !== null ? { value, bytes: base.bytes } : null;
}

/**
 * Folds `template % args`, where args is one constant or a tuple of them.
 *
 * @param left - the template's expression.
 * @param right - the arguments' expression.
 * @param fold - reads a sub-expression as a constant.
 * @returns the value, or null when a part isn't constant, types are mixed, or a directive isn't `%s`.
 */
function percentValue(left: Node, right: Node, fold: Fold): Literal | null {
  const template = fold(left);
  const values = (right.type === "tuple" ? namedChildren(right) : [right]).map(fold);
  // `joined` also checks that every part is constant and of the template's type
  const args = joined([template, ...values]) === null ? null : values.map((v) => v?.value ?? "");
  return withValue(template, template && args ? percentFormatted(template.value, args) : null);
}

/**
 * Folds `sep.join(items)` and `template.format(...)` on a constant `str`.
 *
 * @param call - a `call` node.
 * @param fold - reads a sub-expression as a constant, the caller's `constantValue`.
 * @returns the value, or null for another call or a non-constant argument.
 */
export function methodValue(call: Node, fold: Fold): Literal | null {
  const fn = call.childForFieldName("function");
  const receiver = fn?.type === "attribute" ? fn.childForFieldName("object") : null;
  const method = fn?.childForFieldName("attribute");
  const self = receiver ? fold(receiver) : null;
  const list = call.childForFieldName("arguments");
  if (!(self && method && list?.type === "argument_list") || self.bytes) {
    return null;
  }
  const args = namedChildren(list);
  switch (identifierName(method)) {
    case "join":
      return joinValue(self.value, args, fold);
    case "format":
      return formatValue(self.value, args, fold);
    default:
      return null;
  }
}

/**
 * Folds `sep.join(items)` for a list or tuple of constant `str`.
 *
 * @param separator - the constant `sep`.
 * @param args - the call's arguments.
 * @param fold - reads a sub-expression as a constant.
 * @returns the joined string, or null when the argument isn't such a list.
 */
function joinValue(separator: string, args: readonly Node[], fold: Fold): Literal | null {
  const [items, ...more] = args;
  if (!items || more.length > 0 || !["list", "tuple"].includes(items.type)) {
    return null;
  }
  const parts = namedChildren(items).map(fold);
  const texts = parts.flatMap((part) => (part && !part.bytes ? [part.value] : []));
  return texts.length === parts.length ? { value: texts.join(separator), bytes: false } : null;
}

/**
 * Folds `template.format(...)` with constant `str` arguments, positional or
 * keyword, and no `*args` or `**kwargs`.
 *
 * @param template - the constant the method is called on.
 * @param args - the call's arguments.
 * @param fold - reads a sub-expression as a constant.
 * @returns the formatted string, or null when an argument or a field can't be read.
 */
function formatValue(template: string, args: readonly Node[], fold: Fold): Literal | null {
  const positional: string[] = [];
  const keyword = new Map<string, string>();
  for (const arg of args) {
    const named = arg.type === "keyword_argument";
    const valueNode = named ? arg.childForFieldName("value") : arg;
    const value = valueNode ? fold(valueNode) : null;
    if (!value || value.bytes) {
      return null; // a splat, a non-str or a computed argument
    }
    if (named) {
      keyword.set(keywordOf(arg), value.value);
    } else {
      positional.push(value.value);
    }
  }
  const value = braceFormatted(template, positional, keyword);
  return value === null ? null : { value, bytes: false };
}

/**
 * Folds `s[i]` and `s[a:b:c]` over a constant with integer-literal bounds.
 * Indexing bytes gives an int, so only a `str` can be indexed.
 *
 * @param node - a `subscript` node.
 * @param fold - reads a sub-expression as a constant, the caller's `constantValue`.
 * @returns the value, or null when the value or a bound isn't constant.
 */
export function subscriptValue(node: Node, fold: Fold): Literal | null {
  const valueNode = node.childForFieldName("value");
  const key = node.childForFieldName("subscript");
  const base = valueNode ? fold(valueNode) : null;
  if (!(base && key)) {
    return null;
  }
  if (key.type !== "slice") {
    const index = signedInteger(key);
    const chars = Array.from(base.value);
    const char = index === null ? undefined : chars[index < 0 ? index + chars.length : index];
    return char === undefined || base.bytes ? null : { value: char, bytes: false };
  }
  const bounds = sliceBounds(key);
  const value = bounds ? sliced(base.value, ...bounds) : null;
  return value === null ? null : { value, bytes: base.bytes };
}

/**
 * Reads the start, stop and step of a slice whose bounds are integer literals.
 *
 * @param slice - a `slice` node.
 * @returns the three bounds (null where omitted), or null when a bound isn't an integer literal.
 */
function sliceBounds(slice: Node): [number | null, number | null, number | null] | null {
  const bounds: (number | null)[] = [null, null, null];
  let at = 0;
  for (const child of slice.children) {
    if (child?.type === ":") {
      at += 1;
    } else if (child && child.type !== "comment") {
      const value = signedInteger(child);
      if (value === null || at > 2) {
        return null;
      }
      bounds[at] = value;
    }
  }
  const [start = null, stop = null, step = null] = bounds;
  return [start, stop, step];
}
