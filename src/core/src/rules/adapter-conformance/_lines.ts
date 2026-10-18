/**
 * @file Reads an adapter module for INW020: which top-level classes need a
 * conformance line, and which module-level annotated assignments are one.
 * A class needs a line unless its name starts with `_` or it is a port
 * itself (a Protocol or an ABC) or a record the options allow (an
 * exception, an enum, a Pydantic model, a dataclass). A conformance line is
 * `x: Port = Adapter(...)` (`Adapter[T](...)` too) or
 * `x: type[Port] = Adapter`, read at module level and in the branches of a
 * module-level `if`. It reads one parsed tree and words nothing; the caller
 * parses and frees the tree.
 */
import type { Node } from "web-tree-sitter";
import { identifierName, keywordOf, namedChildren } from "../../shared/python/nodes.ts";
import type { Qualify } from "../../shared/python/qualify.ts";
import { underTypeChecking } from "../../shared/python/type-checking.ts";
import { qualifiedHead, topLevelClasses } from "../shared/classes.ts";
import type { NameMatch } from "../shared/name-patterns.ts";

/** The bases that make a class a port rather than an adapter: Protocols and ABCs. */
const PORT_BASES: ReadonlySet<string> = new Set([
  "typing.Protocol",
  "typing_extensions.Protocol",
  "abc.ABC",
]);

/** The metaclass that makes a class an ABC. */
const ABC_META = "abc.ABCMeta";

/** The spellings of `type[...]` a class-form line may use. */
const TYPE_FORMS: ReadonlySet<string> = new Set(["type", "typing.Type", "typing_extensions.Type"]);

/** What the reader needs from the file and the options. */
export interface LineContext {
  readonly qualify: Qualify;
  readonly allowBase: NameMatch;
  readonly allowDecorator: NameMatch;
}

/** A class that needs a conformance line. */
export interface AdapterClass {
  readonly name: string;
  /** The class's name node, where its finding goes. */
  readonly nameNode: Node;
}

/** One annotated assignment that declares a class's port. */
export interface ConformanceLine {
  /** The class the value names. */
  readonly cls: string;
  /** The `expression_statement`. */
  readonly statement: Node;
  /** The port's expression: the annotation, or what `type[...]` holds. */
  readonly port: Node;
  /** `call` for `x: Port = Adapter(...)`, `class` for `x: type[Port] = Adapter`. */
  readonly form: "call" | "class";
  /** False when the line sits outside `if TYPE_CHECKING:` and runs at import. */
  readonly typeOnly: boolean;
}

/**
 * Qualifies the heads of base or decorator expressions, dropping what can't be named.
 *
 * @param nodes - base or decorator expressions.
 * @param qualify - the file's qualifier.
 * @returns the dotted names, in order.
 */
function heads(nodes: readonly Node[], qualify: Qualify): string[] {
  return nodes.flatMap((n) => qualifiedHead(n, qualify) ?? []);
}

/**
 * Tells whether a class's bases or decorators keep it out of the check.
 *
 * @param node - the `class_definition`.
 * @param decorators - its decorator nodes.
 * @param context - the qualifier and the options.
 * @param exempt - the qualified names of same-file classes exempt by an allowed base or decorator.
 * @returns `record` when an allowed base or decorator exempts it, `port` for a Protocol or ABC, or undefined when it needs a line.
 */
function exemption(
  node: Node,
  decorators: readonly Node[],
  context: LineContext,
  exempt: ReadonlySet<string>,
): "record" | "port" | undefined {
  const decorated = heads(
    decorators.flatMap((d) => namedChildren(d).slice(0, 1)),
    context.qualify,
  );
  const list = node.childForFieldName("superclasses");
  const args = list ? namedChildren(list) : [];
  const bases = heads(
    args.filter((a) => a.type !== "keyword_argument"),
    context.qualify,
  );
  if (
    decorated.some(context.allowDecorator) ||
    bases.some((b) => context.allowBase(b) || exempt.has(b))
  ) {
    return "record";
  }
  const meta = args.some((a) => {
    const value = a.type === "keyword_argument" ? a.childForFieldName("value") : null;
    return keywordOf(a) === "metaclass" && value !== null && context.qualify(value) === ABC_META;
  });
  return meta || bases.some((b) => PORT_BASES.has(b)) ? "port" : undefined;
}

/**
 * Lists the top-level classes of an adapter module that need a conformance line.
 *
 * @param root - the module node.
 * @param module - the module's dotted name, which qualifies its own classes.
 * @param context - the qualifier and the options.
 * @returns the classes in source order.
 */
export function adapterClasses(root: Node, module: string, context: LineContext): AdapterClass[] {
  const exempt = new Set<string>();
  const found: AdapterClass[] = [];
  for (const { node, decorators } of topLevelClasses(root)) {
    const nameNode = node.childForFieldName("name");
    if (nameNode === null) {
      continue;
    }
    const name = identifierName(nameNode);
    const kind = exemption(node, decorators, context, exempt);
    if (kind === "record") {
      exempt.add(`${module}.${name}`);
    }
    if (kind === undefined && !name.startsWith("_")) {
      found.push({ name, nameNode });
    }
  }
  return found;
}

/**
 * Lists the statements at module level and directly inside the branches of
 * a module-level `if`, where a conformance line may stand.
 *
 * shortcut: deeper nesting (an `if` inside `if TYPE_CHECKING:`, a `try`) isn't read; read it if a project needs it.
 *
 * @param root - the module node.
 * @returns the statements in source order.
 */
function moduleStatements(root: Node): Node[] {
  const out: Node[] = [];
  for (const child of namedChildren(root)) {
    if (child.type !== "if_statement") {
      out.push(child);
      continue;
    }
    for (const part of namedChildren(child)) {
      const branch = part.type === "block" ? [part] : namedChildren(part);
      for (const block of branch.filter((b) => b.type === "block")) {
        out.push(...namedChildren(block));
      }
    }
  }
  return out;
}

/**
 * Splits a type expression into its head and arguments: `type[Port]` (a
 * `generic_type` in an annotation) and `typing.Type[Port]` (a `subscript`)
 * into the head and `Port`; anything else is its own head.
 *
 * @param node - an annotation's expression.
 * @returns the head node and the argument expressions.
 */
function typeParts(node: Node): { head: Node; args: Node[] } {
  if (node.type === "subscript") {
    return {
      head: node.childForFieldName("value") ?? node,
      args: node.childrenForFieldName("subscript"),
    };
  }
  const [head, params] = node.type === "generic_type" ? namedChildren(node) : [];
  if (head === undefined || params?.type !== "type_parameter") {
    return { head: node, args: [] };
  }
  return { head, args: namedChildren(params).flatMap((t) => namedChildren(t).slice(0, 1)) };
}

/**
 * Qualifies the port a line's annotation names, by its head: `Repo[int]` as `Repo`.
 *
 * @param port - the port's expression.
 * @param qualify - the file's qualifier.
 * @returns the dotted name, or null for a string or anything else it can't name.
 */
export function portName(port: Node, qualify: Qualify): string | null {
  return qualify(typeParts(port).head);
}

/**
 * Names the class a line's value refers to: the callee of `Adapter(...)`
 * or `Adapter[T](...)`, or the bare `Adapter` of the class form.
 *
 * @param value - the assignment's right-hand side.
 * @returns the class name and the form, or undefined for any other value.
 */
function valueClass(value: Node): { cls: string; form: "call" | "class" } | undefined {
  const form = value.type === "call" ? "call" : "class";
  const callee = form === "call" ? value.childForFieldName("function") : value;
  const head = callee?.type === "subscript" ? callee.childForFieldName("value") : callee;
  return head?.type === "identifier" ? { cls: identifierName(head), form } : undefined;
}

/**
 * Reads one statement as a conformance line for one of the given classes.
 *
 * @param statement - a module-level statement.
 * @param classes - the names of the classes that need a line.
 * @param qualify - the file's qualifier, for `type[...]`.
 * @returns the line, or undefined when the statement isn't one.
 */
function lineOf(
  statement: Node,
  classes: ReadonlySet<string>,
  qualify: Qualify,
): ConformanceLine | undefined {
  const [assignment] = statement.type === "expression_statement" ? namedChildren(statement) : [];
  const type = assignment?.type === "assignment" ? assignment.childForFieldName("type") : null;
  const [annotation] = type ? namedChildren(type) : [];
  const right = assignment?.childForFieldName("right");
  const value = right ? valueClass(right) : undefined;
  if (annotation === undefined || value === undefined || !classes.has(value.cls)) {
    return undefined;
  }
  const typeOnly = underTypeChecking(statement);
  if (value.form === "call") {
    return { cls: value.cls, statement, port: annotation, form: "call", typeOnly };
  }
  const { head, args } = typeParts(annotation);
  const [inner] = args;
  const wrapped = inner !== undefined && TYPE_FORMS.has(qualify(head) ?? "");
  return wrapped ? { cls: value.cls, statement, port: inner, form: "class", typeOnly } : undefined;
}

/**
 * Lists the conformance lines for the given classes, in source order.
 *
 * @param root - the module node.
 * @param classes - the names of the classes that need a line.
 * @param qualify - the file's qualifier.
 * @returns every line whose value names one of the classes.
 */
export function conformanceLines(
  root: Node,
  classes: ReadonlySet<string>,
  qualify: Qualify,
): ConformanceLine[] {
  return moduleStatements(root).flatMap((s) => lineOf(s, classes, qualify) ?? []);
}
