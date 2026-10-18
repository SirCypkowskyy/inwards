/**
 * @file Reads constant values out of Python syntax nodes: string and bytes
 * literals, constant string expressions built from them (folded in
 * `folding.ts`), and the arguments of a call. INW011 uses these to find the module name a loader is given, as
 * Python would compute it before the call runs. Names are read only through a
 * caller-supplied table of constants; this module doesn't decide which names
 * are constant.
 */
import type { Node } from "web-tree-sitter";
import { joined, type Literal, methodValue, operatorValue, subscriptValue } from "./folding.ts";
import { identifierName, keywordOf, namedChildren } from "./nodes.ts";
import { formatted } from "./string-ops.ts";

/**
 * Finds a call argument by position or keyword.
 * A positional argument after `*args` has no known position, so it is not found.
 * A keyword is also read from a literal `**{"name": value}`.
 *
 * @param call - the `call` node.
 * @param index - the 0-based position.
 * @param keyword - the keyword name, or "" when the parameter is positional-only.
 * @returns the argument's value node, or null when it isn't given (or can't be placed).
 */
export function argumentAt(call: Node, index: number, keyword: string): Node | null {
  const list = call.childForFieldName("arguments");
  if (list?.type !== "argument_list") {
    return null;
  }
  const args = namedChildren(list);
  const splat = args.findIndex((a) => a.type === "list_splat" || a.type === "dictionary_splat");
  const positional = (splat === -1 ? args : args.slice(0, splat)).filter(
    (a) => a.type !== "keyword_argument",
  );
  const byPosition = positional[index];
  if (byPosition) {
    return byPosition;
  }
  if (keyword === "") {
    return null;
  }
  const named = args.find((a) => a.type === "keyword_argument" && keywordOf(a) === keyword);
  const spread = args
    .flatMap((a) => (a.type === "dictionary_splat" ? (literalKwargs(a) ?? []) : []))
    .find((pair) => literalString(pair.childForFieldName("key")) === keyword);
  return (named ?? spread)?.childForFieldName("value") ?? null;
}

/**
 * Reads the entries of a `**{...}` whose keys are all string literals.
 *
 * @param splat - a `dictionary_splat` node.
 * @returns the `pair` nodes, or null when the splat isn't such a literal.
 */
function literalKwargs(splat: Node): Node[] | null {
  const [dict, ...more] = namedChildren(splat);
  const pairs = dict?.type === "dictionary" && more.length === 0 ? namedChildren(dict) : null;
  const literal = pairs?.every(
    (p) => p.type === "pair" && literalString(p.childForFieldName("key")) !== null,
  );
  return literal ? pairs : null;
}

/**
 * Tells whether a call passes `*args` or `**kwargs`, behind which any
 * argument `argumentAt` doesn't find may hide. A literal `**{"name": value}`
 * hides nothing: `argumentAt` reads it.
 *
 * @param call - the `call` node.
 * @returns true when the argument list holds a splat.
 */
export function hasSplat(call: Node): boolean {
  const list = call.childForFieldName("arguments");
  return list?.type === "argument_list"
    ? namedChildren(list).some(
        (a) =>
          a.type === "list_splat" || (a.type === "dictionary_splat" && literalKwargs(a) === null),
      )
    : false;
}

/** Names whose value is a known constant, e.g. a module-level `TARGET = "..."`. */
export type Constants = ReadonlyMap<string, Literal>;

const NO_CONSTANTS: Constants = new Map();

/**
 * Reads a `str` constant, the form a module name must take.
 *
 * @param node - an expression node, or null.
 * @param constants - names with known values; none by default.
 * @returns the string's value, or null when it is not a constant `str`.
 */
export function literalString(
  node: Node | null,
  constants: Constants = NO_CONSTANTS,
): string | null {
  const literal = node ? constantValue(node, constants) : null;
  return literal && !literal.bytes ? literal.value : null;
}

/**
 * Reads the constant source of `exec`, `eval` or `compile`: `str`, or bytes read as UTF-8.
 * The caller must still honour a coding declaration in bytes, as CPython does.
 *
 * @param node - the source argument, or null.
 * @param constants - names with known values; none by default.
 * @returns the source text and whether it came from bytes, or null when it is not a constant.
 */
export function literalSource(
  node: Node | null,
  constants: Constants = NO_CONSTANTS,
): { text: string; bytes: boolean } | null {
  const literal = node ? constantValue(node, constants) : null;
  if (!literal) {
    return null;
  }
  if (!literal.bytes) {
    return { text: literal.value, bytes: false };
  }
  const bytes = Uint8Array.from(literal.value, (ch) => ch.charCodeAt(0));
  return { text: new TextDecoder().decode(bytes), bytes: true };
}

/**
 * Decodes a constant string expression: a literal, implicit concatenation,
 * parentheses, a name in `constants`, `+`, `%` with `%s`, `*` by an integer
 * literal, `sep.join([...])`, `template.format(...)`, and slicing or indexing
 * by integer literals. Each step is linear in the node's size, bounded by the
 * length cap in `string-ops.ts`.
 *
 * @param node - an expression node.
 * @param constants - names with known values.
 * @returns the value, or null for anything that is not a constant string.
 */
export function constantValue(node: Node, constants: Constants): Literal | null {
  /**
   * Reads a sub-expression with the same constants.
   *
   * @param inner - the sub-expression.
   * @returns its value, or null when it isn't constant.
   */
  function fold(inner: Node): Literal | null {
    return constantValue(inner, constants);
  }
  switch (node.type) {
    case "parenthesized_expression": {
      const [inner, ...more] = namedChildren(node);
      return inner && more.length === 0 ? constantValue(inner, constants) : null;
    }
    case "identifier":
      return constants.get(identifierName(node)) ?? null;
    case "string":
      return stringPart(node, constants);
    case "concatenated_string":
      return joined(
        namedChildren(node).map((part) =>
          part.type === "string" ? stringPart(part, constants) : null,
        ),
      );
    case "binary_operator":
      return operatorValue(node, fold);
    case "call":
      return methodValue(node, fold);
    case "subscript":
      return subscriptValue(node, fold);
    default:
      return null;
  }
}

const STRING_START = /^(?<prefix>[A-Za-z]*)(?:'''|"""|'|")$/u;

/**
 * Decodes one string literal token, with its prefix (`r`, `b`, `f`, `u`).
 * An f-string counts when each replacement field is itself a constant `str`
 * (`f"shop.{'infrastructure'}"`), with at most a `!s` conversion and a `str`
 * format spec; a t-string is never a `str`.
 *
 * @param node - a `string` node.
 * @param constants - names with known values.
 * @returns the value, or null when the string is not constant.
 */
function stringPart(node: Node, constants: Constants): Literal | null {
  const start = node.firstChild;
  const end = node.lastChild;
  const prefix = STRING_START.exec(start?.text ?? "")?.groups?.["prefix"]?.toLowerCase();
  if (!(start && end) || end.type !== "string_end" || prefix === undefined) {
    return null;
  }
  if (prefix.includes("t")) {
    return null;
  }
  const bytes = prefix.includes("b");
  const pieces: string[] = [];
  let from = start.endIndex;
  for (const field of node.children) {
    if (field?.type !== "interpolation") {
      continue;
    }
    const text = textPiece(node, from, field.startIndex, prefix);
    const value = fieldValue(field, constants);
    if (text === null || value === null) {
      return null;
    }
    pieces.push(text, value);
    from = field.endIndex;
  }
  const last = textPiece(node, from, end.startIndex, prefix);
  return last === null ? null : { value: [...pieces, last].join(""), bytes };
}

/**
 * Decodes the literal text between two offsets of a string token.
 *
 * @param node - the `string` node.
 * @param from - start offset in the source, inclusive.
 * @param to - end offset in the source, exclusive.
 * @param prefix - the string's lower-cased prefix.
 * @returns the decoded text, or null for an escape Inwards can't decode.
 */
function textPiece(node: Node, from: number, to: number, prefix: string): string | null {
  // Python reads CRLF inside a literal as \n.
  let body = node.text.slice(from - node.startIndex, to - node.startIndex).replaceAll("\r\n", "\n");
  if (prefix.includes("f")) {
    body = body.replaceAll("{{", "{").replaceAll("}}", "}");
  }
  return prefix.includes("r") ? body : decodeEscapes(body, prefix.includes("b"));
}

/**
 * Reads a replacement field whose expression is a constant `str`.
 * `!s` changes nothing on a `str`, and a format spec is applied when it is a
 * plain `str` spec; `!r`, `!a`, `=` and a spec with nested fields are not read.
 *
 * @param field - an `interpolation` node.
 * @param constants - names with known values.
 * @returns the value, or null when the field is computed or can't be folded.
 */
function fieldValue(field: Node, constants: Constants): string | null {
  const [open, expression, ...rest] = field.children;
  let value = open?.type === "{" && expression ? literalString(expression, constants) : null;
  for (const part of rest) {
    value = value === null || part === null ? null : fieldPart(value, part);
  }
  return value;
}

/**
 * Applies one part of a replacement field after its expression.
 *
 * @param value - the field's value so far.
 * @param part - `}`, a `type_conversion` or a `format_specifier` node.
 * @returns the value after the part, or null for `!r`, `!a`, `=` or a spec that can't be read.
 */
function fieldPart(value: string, part: Node): string | null {
  if (part.type === "}" || (part.type === "type_conversion" && part.text === "!s")) {
    return value;
  }
  if (part.type !== "format_specifier") {
    return null; // `!r`, `!a` or `=`
  }
  const nested = part.children.some((c) => c?.type === "format_expression");
  const spec = part.text.slice(1);
  return nested || spec.includes("\\") ? null : formatted(value, spec);
}

const ESCAPE =
  /\\(?:(?<newline>\n)|(?<octal>[0-7]{1,3})|x(?<hex>[0-9A-Fa-f]{2})|u(?<u4>[0-9A-Fa-f]{4})|U(?<u8>[0-9A-Fa-f]{8})|N\{[^}]*\}|(?<other>[\s\S]))/gu;

const SIMPLE_ESCAPES: Readonly<Record<string, string>> = {
  "\\": "\\",
  "'": "'",
  '"': '"',
  a: "\x07",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
  v: "\v",
};

/** Largest code point Python accepts in `\U` escapes. */
const MAX_CODE_POINT = 0x10_ff_ff;
const OCTAL = 8;
const HEX = 16;

/**
 * Applies Python's backslash escapes to the body of a non-raw literal.
 * In bytes, `\u`, `\U` and `\N` are not escapes and stay as written.
 *
 * @param body - the text between the quotes.
 * @param bytes - true for a bytes literal.
 * @returns the decoded value, or null for a `\N{...}` escape or an invalid code point.
 */
function decodeEscapes(body: string, bytes: boolean): string | null {
  let unsupported = false;
  const value = body.replace(ESCAPE, (match, ...rest: unknown[]) => {
    const groups = rest.at(-1);
    const g = isGroups(groups) ? groups : {};
    if (g["newline"] !== undefined) {
      return "";
    }
    const code = codeOf(g, bytes);
    if (code !== undefined) {
      unsupported ||= code > MAX_CODE_POINT;
      return code > MAX_CODE_POINT ? match : String.fromCodePoint(code);
    }
    const other = g["other"];
    if (other !== undefined) {
      return SIMPLE_ESCAPES[other] ?? match;
    }
    unsupported ||= !bytes && match.startsWith("\\N"); // named escape: no name table here
    return match;
  });
  return unsupported ? null : value;
}

/**
 * Reads the code point of a numeric escape.
 *
 * @param g - the escape's named groups.
 * @param bytes - true for a bytes literal, where `\u` and `\U` are not escapes.
 * @returns the code point, or undefined when the escape is not numeric here.
 */
function codeOf(
  g: Readonly<Record<string, string | undefined>>,
  bytes: boolean,
): number | undefined {
  const octal = g["octal"];
  const hex = g["hex"];
  const wide = bytes ? undefined : (g["u4"] ?? g["u8"]);
  if (octal !== undefined) {
    return Number.parseInt(octal, OCTAL);
  }
  if (hex !== undefined) {
    return Number.parseInt(hex, HEX);
  }
  return wide === undefined ? undefined : Number.parseInt(wide, HEX);
}

/**
 * Tells whether a replace callback's last argument is its named-groups object.
 *
 * @param value - the last argument passed to the callback.
 * @returns true when it is a record of group names to matched text.
 */
function isGroups(value: unknown): value is Record<string, string | undefined> {
  return typeof value === "object" && value !== null;
}
