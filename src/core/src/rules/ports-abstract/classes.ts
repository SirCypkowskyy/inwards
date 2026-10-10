/**
 * @file Reads the top-level classes of a port module for INW014: what kind
 * each one is and which of its methods has a body that does work. An
 * interface is an ABC (`abc.ABC` among its bases or `metaclass=abc.ABCMeta`)
 * or a `typing.Protocol`; a derived class extends a class from a port
 * module; an exempt class has a base or decorator the options allow
 * (exceptions, DTOs, dataclasses); anything else is concrete. It reads one
 * parsed tree and decides nothing about wording; the caller parses and frees
 * the tree.
 */
import type { Node } from "web-tree-sitter";
import { identifierName, keywordOf, namedChildren } from "../../python/nodes.ts";
import type { Qualify } from "../../python/qualify.ts";
import type { NameMatch } from "../shared/name-patterns.ts";

/** The base that makes a class an ABC (`abc` docs). */
const ABC = "abc.ABC";

/** The bases that make a class a Protocol (typing spec, "Protocols"). */
const PROTOCOLS: ReadonlySet<string> = new Set(["typing.Protocol", "typing_extensions.Protocol"]);

/** The metaclass that makes a class an ABC. */
const ABC_META = "abc.ABCMeta";

/** The exception a method body may raise and still count as abstract. */
const NOT_IMPLEMENTED = "NotImplementedError";

/**
 * What a top-level class in a port module is: an ABC or a Protocol itself
 * (`abc`, `protocol`), a class that extends one from a port module
 * (`derived`), a class the options exempt, or none of these (`concrete`).
 */
export type Kind = "abc" | "protocol" | "derived" | "exempt" | "concrete";

/** What the class reader needs from the checked file and the options. */
export interface ClassContext {
  /** Qualifies a name or attribute: imported names to their target, same-file classes to the module's, the rest (builtins) bare. */
  readonly qualify: Qualify;
  /** Tells whether a module is a port module, for bases imported from one. */
  readonly inScope: (module: string) => boolean;
  readonly allowBase: NameMatch;
  readonly allowDecorator: NameMatch;
}

/** One top-level class and what it is. */
export interface PortClass {
  /** The `class_definition` node. */
  readonly node: Node;
  readonly name: string;
  readonly kind: Kind;
  /** For a `derived` class, its first base from a port module, as written. */
  readonly base?: string;
}

/** A method whose body does more than an abstract one may. */
export interface ConcreteMethod {
  /** The `function_definition` node. */
  readonly fn: Node;
  readonly name: string;
  /** The body's first statement that does work. */
  readonly statement: Node;
}

/**
 * Lists a module's top-level classes with their decorators.
 *
 * @param root - the module node.
 * @returns each `class_definition` with the decorator nodes above it, in source order.
 */
function topLevelClasses(root: Node): { node: Node; decorators: Node[] }[] {
  const classes: { node: Node; decorators: Node[] }[] = [];
  for (const child of namedChildren(root)) {
    const decorated = child.type === "decorated_definition";
    const node = decorated ? child.childForFieldName("definition") : child;
    if (node?.type === "class_definition") {
      const decorators = decorated
        ? namedChildren(child).filter((part) => part.type === "decorator")
        : [];
      classes.push({ node, decorators });
    }
  }
  return classes;
}

/**
 * Lists the names a module binds to top-level classes.
 *
 * @param root - the module node.
 * @returns every name a top-level `class` statement binds, decorated or not.
 */
export function classNames(root: Node): Set<string> {
  const names = new Set<string>();
  for (const { node } of topLevelClasses(root)) {
    const name = node.childForFieldName("name");
    if (name) {
      names.add(identifierName(name));
    }
  }
  return names;
}

/**
 * Qualifies a base or decorator expression: `Protocol[T]` reads as
 * `Protocol`, and `dataclass(frozen=True)` as `dataclass`.
 *
 * @param node - the expression.
 * @param qualify - the file's qualifier.
 * @returns the dotted name, or null for anything it can't name.
 */
function qualifiedHead(node: Node, qualify: Qualify): string | null {
  if (node.type === "subscript") {
    const value = node.childForFieldName("value");
    return value ? qualifiedHead(value, qualify) : null;
  }
  if (node.type === "call") {
    const callee = node.childForFieldName("function");
    return callee ? qualifiedHead(callee, qualify) : null;
  }
  return qualify(node);
}

/**
 * Says what one base makes of a class: `exempt` for an allowed base, `abc`
 * for `abc.ABC` or `metaclass=abc.ABCMeta`, `protocol` for `Protocol`,
 * `derived` for a same-file class that isn't exempt or a class from a port
 * module; nothing otherwise.
 *
 * @param base - one entry of the class's argument list.
 * @param context - the file's qualifier and the options.
 * @param kinds - the kinds of the same-file classes read so far, by qualified name.
 * @returns the kind the base gives, or undefined when it gives none.
 */
function kindFromBase(
  base: Node,
  context: ClassContext,
  kinds: ReadonlyMap<string, Kind>,
): Kind | undefined {
  if (base.type === "keyword_argument") {
    const value = base.childForFieldName("value");
    const meta = keywordOf(base) === "metaclass" && value ? context.qualify(value) : null;
    return meta === ABC_META ? "abc" : undefined;
  }
  const name = qualifiedHead(base, context.qualify);
  return name === null ? undefined : kindFromName(name, context, kinds);
}

/**
 * Says what a base, by qualified name, makes of a class (see `kindFromBase`).
 *
 * @param name - the base's qualified name; a builtin is bare.
 * @param context - the file's qualifier and the options.
 * @param kinds - the kinds of the same-file classes read so far, by qualified name.
 * @returns the kind the base gives, or undefined when it gives none.
 */
function kindFromName(
  name: string,
  context: ClassContext,
  kinds: ReadonlyMap<string, Kind>,
): Kind | undefined {
  if (context.allowBase(name)) {
    return "exempt";
  }
  if (name === ABC) {
    return "abc";
  }
  if (PROTOCOLS.has(name)) {
    return "protocol";
  }
  const local = kinds.get(name);
  if (local !== undefined) {
    return local === "exempt" ? "exempt" : "derived";
  }
  const owner = name.includes(".") ? name.slice(0, name.lastIndexOf(".")) : "";
  return owner !== "" && context.inScope(owner) ? "derived" : undefined;
}

/** Which kind wins when bases disagree: an exemption first, then the class's own interface. */
const PRECEDENCE: readonly Kind[] = ["exempt", "protocol", "abc", "derived"];

/**
 * Decides what one class is. An allowed decorator or base wins over
 * anything else, so an exception that also subclasses a port stays exempt;
 * a class that lists `Protocol` or `ABC` itself is an interface even when it
 * also extends another port.
 *
 * @param node - the `class_definition` node.
 * @param decorators - its decorator nodes.
 * @param context - the file's qualifier and the options.
 * @param kinds - the kinds of the same-file classes read so far.
 * @returns its kind, and for a derived class the base that makes it one.
 */
function kindOf(
  node: Node,
  decorators: readonly Node[],
  context: ClassContext,
  kinds: ReadonlyMap<string, Kind>,
): { kind: Kind; base?: string } {
  const allowed = decorators.some((decorator) => {
    const [expression] = namedChildren(decorator);
    const name = expression ? qualifiedHead(expression, context.qualify) : null;
    return name !== null && context.allowDecorator(name);
  });
  if (allowed) {
    return { kind: "exempt" };
  }
  const list = node.childForFieldName("superclasses");
  const bases = (list ? namedChildren(list) : []).map((base) => ({
    base,
    kind: kindFromBase(base, context, kinds),
  }));
  const kind = PRECEDENCE.find((k) => bases.some((b) => b.kind === k)) ?? "concrete";
  const via = bases.find((b) => b.kind === "derived")?.base.text;
  return kind === "derived" && via !== undefined ? { kind, base: via } : { kind };
}

/**
 * Reads every top-level class of a port module and decides its kind, in
 * source order, so a class sees the kinds of the classes above it.
 *
 * @param root - the module node.
 * @param module - the module's dotted name, which qualifies its own classes.
 * @param context - the file's qualifier and the options.
 * @returns the classes in source order.
 */
export function portClasses(root: Node, module: string, context: ClassContext): PortClass[] {
  const kinds = new Map<string, Kind>();
  const classes: PortClass[] = [];
  for (const { node, decorators } of topLevelClasses(root)) {
    const nameNode = node.childForFieldName("name");
    if (nameNode) {
      const name = identifierName(nameNode);
      const found = kindOf(node, decorators, context, kinds);
      kinds.set(`${module}.${name}`, found.kind);
      classes.push({ node, name, ...found });
    }
  }
  return classes;
}

/**
 * Tells whether a statement may stand in an abstract method's body: a
 * docstring or other string, `...`, `pass`, or `raise NotImplementedError`
 * with or without a message.
 *
 * @param statement - one statement of the body.
 * @returns true when it does no work.
 */
function isAbstractStatement(statement: Node): boolean {
  if (statement.type === "pass_statement") {
    return true;
  }
  const [first] = namedChildren(statement);
  if (statement.type === "expression_statement") {
    const only = namedChildren(statement).length === 1;
    const kind = first?.type ?? "";
    return only && (kind === "ellipsis" || kind === "string" || kind === "concatenated_string");
  }
  if (statement.type === "raise_statement" && first) {
    const raised = first.type === "call" ? first.childForFieldName("function") : first;
    return raised?.type === "identifier" && identifierName(raised) === NOT_IMPLEMENTED;
  }
  return false;
}

/**
 * Lists a class's methods whose body does work, decorated ones included.
 *
 * @param node - the `class_definition` node.
 * @returns each such method with its first working statement, in source order.
 */
export function concreteMethods(node: Node): ConcreteMethod[] {
  const body = node.childForFieldName("body");
  const methods: ConcreteMethod[] = [];
  for (const child of body ? namedChildren(body) : []) {
    const fn =
      child.type === "decorated_definition" ? child.childForFieldName("definition") : child;
    const nameNode = fn?.type === "function_definition" ? fn.childForFieldName("name") : null;
    const block = fn?.childForFieldName("body");
    const statement = block ? namedChildren(block).find((s) => !isAbstractStatement(s)) : undefined;
    if (fn && nameNode && statement) {
      methods.push({ fn, name: identifierName(nameNode), statement });
    }
  }
  return methods;
}
