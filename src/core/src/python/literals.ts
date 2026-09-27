/**
 * @file Reads constant values out of Python syntax nodes: string, bytes and integer
 * literals, and the arguments of a call. INW011 uses these to find the module
 * name a loader is given, as Python would compute it before the call runs.
 */
import type { Node } from "web-tree-sitter";

/**
 * Lists a node's named children, without comments.
 *
 * @param node - any node.
 * @returns the named children that are not comments.
 */
export function namedChildren(node: Node): Node[] {
  return node.namedChildren.flatMap((c) => (c && c.type !== "comment" ? [c] : []));
}

/**
 * Spells an identifier the way Python does: NFKC-normalised.
 *
 * @param node - a name as tree-sitter parsed it (an `identifier` node).
 * @returns the identifier's text in NFKC form, as Python compares names.
 */
export function identifierName(node: Node): string {
  return node.text.normalize("NFKC");
}

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

/**
 * Reads the name of a keyword argument.
 *
 * @param arg - a `keyword_argument` node.
 * @returns the keyword, or "" when the node has none.
 */
function keywordOf(arg: Node): string {
  const name = arg.childForFieldName("name");
  return name ? identifierName(name) : "";
}

/**
 * Reads an integer literal such as `2`, `0x1` or `1_0`.
 *
 * @param node - an expression node.
 * @returns the value, or null when the node is not an integer literal.
 */
export function integerLiteral(node: Node): number | null {
  if (node.type !== "integer") {
    return null;
  }
  const value = Number(node.text.replaceAll("_", ""));
  return Number.isSafeInteger(value) ? value : null;
}

/** A decoded string or bytes literal. */
interface Literal {
  value: string;
  /** True for `b"..."`; `value` then holds one character per byte. */
  bytes: boolean;
}

/**
 * Reads a `str` literal, the form a module name must take.
 *
 * @param node - an expression node, or null.
 * @returns the string's value, or null when it is not a constant `str`.
 */
export function literalString(node: Node | null): string | null {
  const literal = node ? literalValue(node) : null;
  return literal && !literal.bytes ? literal.value : null;
}

/**
 * Reads the literal source of `exec`, `eval` or `compile`: `str`, or bytes read as UTF-8.
 * The caller must still honour a coding declaration in bytes, as CPython does.
 *
 * @param node - the source argument, or null.
 * @returns the source text and whether it came from bytes, or null when it is not a constant.
 */
export function literalSource(node: Node | null): { text: string; bytes: boolean } | null {
  const literal = node ? literalValue(node) : null;
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
 * `+` between constants, and parentheses.
 *
 * @param node - an expression node.
 * @returns the value, or null for anything that is not a constant string.
 */
function literalValue(node: Node): Literal | null {
  switch (node.type) {
    case "parenthesized_expression": {
      const [inner, ...more] = namedChildren(node);
      return inner && more.length === 0 ? literalValue(inner) : null;
    }
    case "string":
      return stringPart(node);
    case "concatenated_string":
      return joined(
        namedChildren(node).map((part) => (part.type === "string" ? stringPart(part) : null)),
      );
    case "binary_operator": {
      const left = node.childForFieldName("left");
      const right = node.childForFieldName("right");
      const plus = node.childForFieldName("operator")?.type === "+";
      return plus && left && right ? joined([literalValue(left), literalValue(right)]) : null;
    }
    default:
      return null;
  }
}

/**
 * Joins constant parts into one value, as Python's concatenation does.
 *
 * @param parts - the decoded parts, null where a part is not constant.
 * @returns the joined value, or null when a part is missing or str is mixed with bytes.
 */
function joined(parts: readonly (Literal | null)[]): Literal | null {
  const [first] = parts;
  if (!first || parts.some((part) => part === null || part.bytes !== first.bytes)) {
    return null; // not all constant, or str mixed with bytes
  }
  return { value: parts.map((part) => part?.value ?? "").join(""), bytes: first.bytes };
}

const STRING_START = /^(?<prefix>[A-Za-z]*)(?:'''|"""|'|")$/u;

/**
 * Decodes one string literal token, with its prefix (`r`, `b`, `f`, `u`).
 * An f-string counts when each replacement field is itself a constant `str`
 * with no conversion or format spec (`f"shop.{'infrastructure'}"`); a
 * t-string is never a `str`.
 *
 * @param node - a `string` node.
 * @returns the value, or null when the string is not constant.
 */
function stringPart(node: Node): Literal | null {
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
    const value = fieldValue(field);
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
 *
 * @param field - an `interpolation` node.
 * @returns the value, or null when the field is computed, converted or formatted.
 */
function fieldValue(field: Node): string | null {
  // `{`, the expression, `}`: anything else is `!r`, `:spec` or `=`.
  const [open, expression, close, ...rest] = field.children;
  const plain = open?.type === "{" && close?.type === "}" && rest.length === 0;
  return plain && expression ? literalString(expression) : null;
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
