/**
 * @file What a function's parameters stand for: the qualified types of each
 * annotation and the dependency each `Depends(...)` names. INW012 tells a
 * call on `db` apart as database work (`db: AsyncSession`) or a call into a
 * use case (`place_order: Annotated[PlaceOrder, Depends(...)]`), and INW013
 * finds the parameters whose methods block (`db: Session`). It reads
 * `Annotated[T, ...]`, `Optional[T]`, `Union[...]`, `T | None` and aliases
 * bound at module level in the same file. String annotations and aliases
 * imported from another module are not read.
 */
import type { Node } from "web-tree-sitter";
import { argumentAt } from "../../python/literals.ts";
import { identifierName, namedChildren } from "../../python/nodes.ts";
import type { Qualify } from "../../python/qualify.ts";

/** How many aliases `typesOf` follows before it stops (an alias cycle ends here). */
const MAX_ALIASES = 4;

/** The wrappers whose first argument is the type and the rest is metadata. */
const ANNOTATED: ReadonlySet<string> = new Set(["typing.Annotated", "typing_extensions.Annotated"]);

/** The wrappers whose every argument is a type the value may have. */
const UNIONS: ReadonlySet<string> = new Set([
  "typing.Optional",
  "typing.Union",
  "typing_extensions.Optional",
  "typing_extensions.Union",
]);

/** The calls that declare a FastAPI dependency. */
const DEPENDS: ReadonlySet<string> = new Set([
  "fastapi.Depends",
  "fastapi.Security",
  "fastapi.params.Depends",
  "fastapi.params.Security",
]);

/** What one file gives the parameter reader. */
export interface TypeContext {
  readonly qualify: Qualify;
  /** Module-level aliases by name: `DbSession = Annotated[AsyncSession, Depends(get_db)]`. */
  readonly aliases: ReadonlyMap<string, Node>;
}

/**
 * Lists a module's top-level aliases: `Name = <expression>` and `type Name = <expression>`.
 *
 * @param root - the module node.
 * @returns each alias's value node, by name.
 */
export function moduleAliases(root: Node): Map<string, Node> {
  const aliases = new Map<string, Node>();
  for (const child of namedChildren(root)) {
    const statement = child.type === "expression_statement" ? namedChildren(child)[0] : child;
    const left =
      statement?.type === "type_alias_statement"
        ? namedChildren(statement)[0]
        : statement?.childForFieldName("left");
    const right =
      statement?.type === "type_alias_statement"
        ? namedChildren(statement)[1]
        : statement?.childForFieldName("right");
    const name = left?.type === "type" ? namedChildren(left)[0] : left;
    if (
      (statement?.type === "assignment" || statement?.type === "type_alias_statement") &&
      name?.type === "identifier" &&
      right
    ) {
      aliases.set(identifierName(name), right);
    }
  }
  return aliases;
}

/**
 * Reads what a subscripted annotation stands for: `Annotated[T, Depends(f)]`
 * gives `T`'s types and `f`; `Optional[T]` and `Union[A, B]` give each
 * argument's types; any other generic (`list[Item]`) gives its own name.
 *
 * @param base - the subscripted name, qualified.
 * @param args - the subscript's argument nodes.
 * @param context - the file's qualifier and aliases.
 * @param hops - aliases followed so far.
 * @returns the qualified names.
 */
function genericTypes(
  base: string,
  args: readonly Node[],
  context: TypeContext,
  hops: number,
): string[] {
  if (ANNOTATED.has(base)) {
    const [type, ...metadata] = args;
    const dependencies = metadata.flatMap((node) => dependencyOf(node, context.qualify));
    return [...(type ? typesOf(type, context, hops) : []), ...dependencies];
  }
  return UNIONS.has(base) ? args.flatMap((arg) => typesOf(arg, context, hops)) : [base];
}

/**
 * Reads the dependency a `Depends(f)` or `Security(f)` call names.
 *
 * @param node - an expression, possibly wrapped in a `type` node.
 * @param qualify - qualifies a name through the file's imports.
 * @returns `f`'s qualified name, or nothing for any other expression.
 */
function dependencyOf(node: Node, qualify: Qualify): string[] {
  const call = node.type === "type" ? namedChildren(node)[0] : node;
  const callee = call?.type === "call" ? call.childForFieldName("function") : null;
  const argument =
    call && callee && DEPENDS.has(qualify(callee) ?? "") ? argumentAt(call, 0, "dependency") : null;
  const target = argument ? qualify(argument) : null;
  return target === null ? [] : [target];
}

/**
 * Reads the qualified types an annotation names, through the wrappers and
 * same-file aliases the module comment lists.
 *
 * @param node - an annotation, or a part of one.
 * @param context - the file's qualifier and aliases.
 * @param hops - aliases followed so far.
 * @returns the qualified names, `Depends` targets included; none for what it can't read.
 */
export function typesOf(node: Node, context: TypeContext, hops = 0): string[] {
  const { qualify, aliases } = context;
  if (node.type === "type") {
    return namedChildren(node).flatMap((child) => typesOf(child, context, hops));
  }
  if (node.type === "identifier") {
    const alias = aliases.get(identifierName(node));
    return alias && hops < MAX_ALIASES ? typesOf(alias, context, hops + 1) : [qualify(node) ?? ""];
  }
  if (node.type === "attribute") {
    return [qualify(node) ?? ""].filter((name) => name !== "");
  }
  if (node.type === "binary_operator") {
    return namedChildren(node).flatMap((side) => typesOf(side, context, hops));
  }
  const parts = namedChildren(node);
  const [head, ...rest] = parts;
  if (node.type === "subscript" && head) {
    return genericTypes(qualify(head) ?? "", rest, context, hops);
  }
  if (node.type === "generic_type" && head) {
    const args = rest.flatMap((part) =>
      part.type === "type_parameter" ? namedChildren(part) : [],
    );
    return genericTypes(qualify(head) ?? "", args, context, hops);
  }
  return [];
}

/**
 * Reads what each parameter of a function stands for: its annotation's types,
 * and the dependency its default `Depends(f)` names.
 *
 * @param fn - a `function_definition` node.
 * @param context - the file's qualifier and aliases.
 * @returns qualified names by parameter name; an unannotated parameter maps to none.
 */
export function parameterTypes(fn: Node, context: TypeContext): Map<string, readonly string[]> {
  const params = new Map<string, readonly string[]>();
  const list = fn.childForFieldName("parameters");
  for (const param of list ? namedChildren(list) : []) {
    const name =
      param.type === "identifier"
        ? param
        : (param.childForFieldName("name") ?? namedChildren(param)[0]);
    const type = param.childForFieldName("type");
    const value = param.childForFieldName("value");
    if (name?.type === "identifier") {
      const types = type ? typesOf(type, context) : [];
      const dependency = value ? dependencyOf(value, context.qualify) : [];
      params.set(
        identifierName(name),
        [...types, ...dependency].filter((t) => t !== ""),
      );
    }
  }
  return params;
}
