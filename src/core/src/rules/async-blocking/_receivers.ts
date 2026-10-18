/**
 * @file Finds INW013's blocking receivers: the names whose method calls
 * block, by where they come from. A parameter counts when its annotation
 * resolves to a blocking type (through `Annotated`, `Optional`, unions and
 * same-file aliases); a name counts when the module or the function binds it
 * from a call to a blocking type or factory (`cache = redis.Redis()`,
 * `with Session(engine) as session`) or annotates it with one; a helper's
 * parameter can also take the receiver its caller passed (#294). It reads
 * one function and its module, and follows no name into another module or
 * through `self`.
 */
import type { Node } from "web-tree-sitter";
import { descendantsOutside, identifierName, namedChildren } from "../../shared/python/nodes.ts";
import { parameterTypes, type TypeContext, typesOf } from "../shared/annotations.ts";
import type { Family } from "./_catalog.ts";

/** Where a receiver's methods block: its family and the qualified name it came from. */
export interface Source {
  readonly family: Family;
  readonly type: string;
}

/** Node types whose body doesn't run when the enclosing function runs. */
export const NESTED_SCOPES: ReadonlySet<string> = new Set([
  "function_definition",
  "lambda",
  "class_definition",
]);

/**
 * Finds the family a list of qualified names belongs to, the first one that matches.
 *
 * @param names - qualified names, e.g. an annotation's types.
 * @param families - the families to try, built-in ones first.
 * @returns the family and the name that matched, or undefined.
 */
function sourceOf(names: readonly string[], families: readonly Family[]): Source | undefined {
  for (const type of names) {
    const family = families.find((f) => f.isType(type));
    if (family) {
      return { family, type };
    }
  }
  return undefined;
}

/**
 * Reads where a value expression comes from: a call to a blocking type or factory.
 *
 * @param value - the right-hand side of a binding.
 * @param context - the file's qualifier and aliases.
 * @param families - the families to try.
 * @returns the source, or undefined for any other expression.
 */
export function valueSource(
  value: Node,
  context: TypeContext,
  families: readonly Family[],
): Source | undefined {
  const callee = value.type === "call" ? value.childForFieldName("function") : null;
  const name = callee ? context.qualify(callee) : null;
  return name === null ? undefined : sourceOf([name], families);
}

/**
 * Reads one binding statement: `x = T(...)`, `x: T = ...` or `x = y = T(...)`.
 *
 * @param assignment - an `assignment` node.
 * @param context - the file's qualifier and aliases.
 * @param families - the families to try.
 * @returns each bound name with its source; none when the value isn't blocking.
 */
function assigned(
  assignment: Node,
  context: TypeContext,
  families: readonly Family[],
): [string, Source][] {
  const targets: Node[] = [];
  let type: Node | null = null;
  let value: Node | null = assignment;
  while (value?.type === "assignment") {
    const left = value.childForFieldName("left");
    if (left) {
      targets.push(left);
    }
    type = type ?? value.childForFieldName("type");
    value = value.childForFieldName("right");
  }
  const source =
    (type ? sourceOf(typesOf(type, context), families) : undefined) ??
    (value ? valueSource(value, context, families) : undefined);
  return source === undefined
    ? []
    : targets.filter((t) => t.type === "identifier").map((t) => [identifierName(t), source]);
}

/**
 * Reads the names a `with T(...) as x` item binds from a blocking type.
 *
 * @param item - a `with_item` node.
 * @param context - the file's qualifier and aliases.
 * @param families - the families to try.
 * @returns the bound name with its source, or none.
 */
function withBound(
  item: Node,
  context: TypeContext,
  families: readonly Family[],
): [string, Source][] {
  const pattern = item.childForFieldName("value");
  if (pattern?.type !== "as_pattern") {
    return [];
  }
  const [value] = namedChildren(pattern);
  const target = pattern.childForFieldName("alias");
  const name = target ? namedChildren(target)[0] : undefined;
  const source = value ? valueSource(value, context, families) : undefined;
  return name?.type === "identifier" && source ? [[identifierName(name), source]] : [];
}

/**
 * Collects a module's top-level bindings: its assignments and `with` items,
 * not those inside compound statements or nested scopes.
 *
 * @param node - the module node, or one of its expression statements.
 * @param context - the file's qualifier and aliases.
 * @param families - the families to try.
 * @returns each bound name with its source, in source order.
 */
function bindingsIn(
  node: Node,
  context: TypeContext,
  families: readonly Family[],
): [string, Source][] {
  const found: [string, Source][] = [];
  for (const child of namedChildren(node)) {
    if (NESTED_SCOPES.has(child.type) || child.type === "decorated_definition") {
      continue;
    }
    if (child.type === "assignment") {
      found.push(...assigned(child, context, families));
    } else if (child.type === "with_item") {
      found.push(...withBound(child, context, families));
    }
    if (child.type === "expression_statement") {
      found.push(...bindingsIn(child, context, families));
    }
  }
  return found;
}

/** What a function body's bindings are made of. */
const BINDINGS: ReadonlySet<string> = new Set(["assignment", "with_item"]);

/** What `bodyBindings` doesn't look inside: other scopes, decorators, and an assignment's own parts. */
const BINDINGS_PRUNE: ReadonlySet<string> = new Set([
  ...NESTED_SCOPES,
  "decorated_definition",
  "assignment",
]);

/**
 * Lists the blocking receivers a function body binds, inside compound
 * statements too, but not inside nested scopes, decorators or an
 * assignment's own parts. One walk inside WASM instead of one call per node
 * (#359).
 *
 * @param body - the function's body.
 * @param context - the file's qualifier and aliases.
 * @param families - the families to try.
 * @returns each bound name with its source, in source order.
 */
function bodyBindings(
  body: Node,
  context: TypeContext,
  families: readonly Family[],
): [string, Source][] {
  return descendantsOutside(body, BINDINGS, BINDINGS_PRUNE).flatMap((node) =>
    node.type === "assignment"
      ? assigned(node, context, families)
      : withBound(node, context, families),
  );
}

/**
 * Lists a module's top-level blocking receivers: `cache = redis.Redis()`.
 *
 * @param root - the module node.
 * @param context - the file's qualifier and aliases.
 * @param families - the families to try.
 * @returns the receivers by name.
 */
export function moduleReceivers(
  root: Node,
  context: TypeContext,
  families: readonly Family[],
): Map<string, Source> {
  return new Map(bindingsIn(root, context, families));
}

/**
 * Lists the blocking receivers a function sees: the module's, then its
 * parameters', then the names its own body binds (which win on a clash). A
 * parameter whose own annotation names no blocking type takes what the
 * caller passed to it, for a helper INW013 follows one hop (#294).
 *
 * @param fn - a `function_definition` node.
 * @param scope - the function's module.
 * @param scope.module - the receivers the module binds at the top level.
 * @param scope.context - the module's qualifier and aliases.
 * @param scope.families - the families to try.
 * @param passed - the receivers the call passes to the function, by parameter name.
 * @returns the receivers by name.
 */
export function functionReceivers(
  fn: Node,
  {
    module,
    context,
    families,
  }: {
    readonly module: ReadonlyMap<string, Source>;
    readonly context: TypeContext;
    readonly families: readonly Family[];
  },
  passed: ReadonlyMap<string, Source> = new Map(),
): Map<string, Source> {
  const receivers = new Map(module);
  for (const [name, types] of parameterTypes(fn, context)) {
    const source = sourceOf(types, families) ?? passed.get(name);
    if (source) {
      receivers.set(name, source);
    } else {
      receivers.delete(name); // a parameter shadows the module's name
    }
  }
  const body = fn.childForFieldName("body");
  for (const [name, source] of body ? bodyBindings(body, context, families) : []) {
    receivers.set(name, source);
  }
  return receivers;
}
