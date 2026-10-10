/**
 * @file Finds the class-based views in one file for INW012 (#270): a class
 * whose bases lead to Flask's `View` or `MethodView`, a Django or DRF view
 * class, or a configured `base-classes` entry, through classes of the same
 * file or, through the caller's resolver, of another first-party module. Its
 * methods named after the HTTP verbs (and, for Django, the ViewSet actions)
 * are the endpoints. It reads one tree; the caller resolves other modules.
 */
import type { Node } from "web-tree-sitter";
import { identifierName, namedChildren } from "../../python/nodes.ts";
import type { Qualify } from "../../python/qualify.ts";
import {
  type Framework,
  frameworkBase,
  inFrameworkPackage,
  type Kind,
  VIEW_METHODS,
  type ViewKind,
} from "./frameworks.ts";
import type { NameMatch } from "./settings.ts";

/** Tells what kind of view a first-party class in another module is, if any. */
export type ResolveBase = (qualified: string) => ViewKind | undefined;

/** What reading one file's classes needs. */
export interface ClassContext {
  /** The file's dotted module name. */
  readonly module: string;
  /** Qualifies a name through the file's imports. */
  readonly qualify: Qualify;
  /** The frameworks recognised in the file. */
  readonly active: ReadonlySet<Framework>;
  /** Matches the configured `base-classes`. */
  readonly custom: NameMatch;
  /** Resolves a base from another first-party module; undefined reads none. */
  readonly resolveBase: ResolveBase | undefined;
}

/** A view method: its function, its name as `Class.method`, and what marked it. */
export interface ViewMethod {
  readonly fn: Node;
  readonly name: string;
  readonly kind: Kind;
}

/**
 * Lists a module's top-level classes by name.
 *
 * @param root - the module node.
 * @returns each `class_definition` node by its name.
 */
export function moduleClasses(root: Node): Map<string, Node> {
  const classes = new Map<string, Node>();
  for (const child of namedChildren(root)) {
    const cls =
      child.type === "decorated_definition" ? child.childForFieldName("definition") : child;
    const name = cls?.type === "class_definition" ? cls.childForFieldName("name") : null;
    if (cls && name) {
      classes.set(identifierName(name), cls);
    }
  }
  return classes;
}

/**
 * Lists a class's base expressions, keyword arguments (`metaclass=`) left out.
 *
 * @param cls - a `class_definition` node.
 * @returns the base nodes, in order.
 */
function basesOf(cls: Node): Node[] {
  const list = cls.childForFieldName("superclasses");
  return list ? namedChildren(list).filter((arg) => arg.type !== "keyword_argument") : [];
}

/**
 * Works out what kind of view a class is from its bases, first match wins
 * (see `baseKind`).
 *
 * @param cls - a `class_definition` node.
 * @param classes - the module's top-level classes by name.
 * @param context - the file's module, qualifier, frameworks, base patterns and resolver.
 * @param seen - the classes already on the path, which ends a cycle.
 * @returns the kind, or undefined when the class is no view.
 */
export function viewKind(
  cls: Node,
  classes: ReadonlyMap<string, Node>,
  context: ClassContext,
  seen: Set<number> = new Set(),
): ViewKind | undefined {
  if (seen.has(cls.startIndex)) {
    return undefined;
  }
  seen.add(cls.startIndex);
  for (const base of basesOf(cls)) {
    const qualified = context.qualify(base);
    const kind = qualified === null ? undefined : baseKind(qualified, classes, context, seen);
    if (kind !== undefined) {
      return kind;
    }
  }
  return undefined;
}

/**
 * Tells what kind of view one base makes a class: a configured base class,
 * a framework view, a class of the same module (followed once each), or a
 * first-party class from another module, which the resolver reads.
 *
 * @param qualified - the base's qualified name.
 * @param classes - the module's top-level classes by name.
 * @param context - the file's module, qualifier, frameworks, base patterns and resolver.
 * @param seen - the classes already on the path.
 * @returns the kind, or undefined when the base makes no view.
 */
function baseKind(
  qualified: string,
  classes: ReadonlyMap<string, Node>,
  context: ClassContext,
  seen: Set<number>,
): ViewKind | undefined {
  if (context.custom(qualified)) {
    return "custom";
  }
  const framework = frameworkBase(qualified, context.active);
  if (framework !== undefined || inFrameworkPackage(qualified)) {
    return framework;
  }
  const prefix = `${context.module}.`;
  if (!qualified.startsWith(prefix)) {
    return context.resolveBase?.(qualified);
  }
  const local = classes.get(qualified.slice(prefix.length));
  return local ? viewKind(local, classes, context, seen) : undefined;
}

/**
 * Lists the methods a class defines in its own body, decorated or not.
 *
 * @param cls - a `class_definition` node.
 * @returns each method's `function_definition` node with its name.
 */
function methodsOf(cls: Node): { fn: Node; name: string }[] {
  const body = cls.childForFieldName("body");
  return (body ? namedChildren(body) : []).flatMap((child) => {
    const fn =
      child.type === "decorated_definition" ? child.childForFieldName("definition") : child;
    const name = fn?.type === "function_definition" ? fn.childForFieldName("name") : null;
    return fn && name ? [{ fn, name: identifierName(name) }] : [];
  });
}

/**
 * Finds the request-handling methods of the file's view classes, at any depth.
 *
 * @param root - the module node.
 * @param context - the file's module, qualifier, frameworks, base patterns and resolver.
 * @returns the methods, named `Class.method`, in source order.
 */
export function viewMethods(root: Node, context: ClassContext): ViewMethod[] {
  const classes = moduleClasses(root);
  return root.descendantsOfType("class_definition").flatMap((cls) => {
    const kind = viewKind(cls, classes, context);
    const className = cls.childForFieldName("name");
    if (kind === undefined || !className) {
      return [];
    }
    return methodsOf(cls)
      .filter(({ name }) => VIEW_METHODS[kind].has(name))
      .map(({ fn, name }) => ({
        fn,
        name: `${identifierName(className)}.${name}`,
        kind,
      }));
  });
}
