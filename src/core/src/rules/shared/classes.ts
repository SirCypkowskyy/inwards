/**
 * @file Reads a module's top-level classes the way the role rules need them:
 * INW014 in port modules and INW020 in adapter modules. It lists each class
 * with its decorators, qualifies a base or decorator through the file's
 * imports (`Protocol[T]` as `typing.Protocol`, `dataclass(frozen=True)` as
 * `dataclasses.dataclass`), and holds the bases and decorators both rules
 * exempt by default: exceptions, enums, Pydantic models, typed dicts, named
 * tuples and dataclasses. It reads one parsed tree and decides nothing about
 * findings; the caller parses and frees the tree. It also makes the test
 * for a role's modules from an option or a default segment, and the
 * exemption matchers from a rule's options.
 */
import type { Node } from "web-tree-sitter";
import { matchEntry, type RuleOptions, stringList } from "../../config/index.ts";
import { identifierName, namedChildren } from "../../python/nodes.ts";
import { type Qualify, qualifierFor } from "../../python/qualify.ts";
import { type NameMatch, nameMatcher } from "./name-patterns.ts";

/**
 * The bases a class may extend and stay out of a role rule's check:
 * exceptions (builtin ones are spelled bare), Pydantic models, named tuples,
 * typed dicts and enums.
 */
const DEFAULT_ALLOW_BASES: readonly string[] = [
  "BaseException",
  "Exception",
  "*Error",
  "*Exception",
  "*Warning",
  "pydantic.BaseModel",
  "typing.NamedTuple",
  "typing.TypedDict",
  "typing_extensions.NamedTuple",
  "typing_extensions.TypedDict",
  "enum.*",
];

/** The decorators that make a class a data record and keep it out of a role rule's check. */
const DEFAULT_ALLOW_DECORATORS: readonly string[] = [
  "dataclasses.dataclass",
  "pydantic.dataclasses.dataclass",
  "attrs.define",
  "attrs.frozen",
  "attrs.mutable",
  "attr.s",
  "attr.attrs",
  "attr.define",
  "attr.frozen",
];

/** One top-level class statement and the decorators above it. */
export interface TopLevelClass {
  /** The `class_definition` node. */
  readonly node: Node;
  readonly decorators: readonly Node[];
}

/**
 * Lists a module's top-level classes with their decorators.
 *
 * @param root - the module node.
 * @returns each `class_definition` with the decorator nodes above it, in source order.
 */
export function topLevelClasses(root: Node): TopLevelClass[] {
  const classes: TopLevelClass[] = [];
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
 * Makes the file's qualifier: an imported name reads as its target, a
 * same-file class as the module's, and any other bare name (a builtin such
 * as `Exception`) as itself, so the allow patterns can name builtins.
 *
 * @param names - what each imported name refers to.
 * @param module - the file's dotted module name.
 * @param local - the names of the file's top-level classes.
 * @returns a function that qualifies a name or attribute node, or returns null for any other expression.
 */
export function classQualifier(
  names: ReadonlyMap<string, string>,
  module: string,
  local: ReadonlySet<string>,
): Qualify {
  const imported = qualifierFor(names, module);
  return (node: Node): string | null => {
    if (node.type !== "identifier") {
      return imported(node);
    }
    const name = identifierName(node);
    return names.get(name) ?? (local.has(name) ? `${module}.${name}` : name);
  };
}

/**
 * Qualifies a base, decorator or annotation expression by its head:
 * `Protocol[T]` reads as `Protocol`, and `dataclass(frozen=True)` as
 * `dataclass`.
 *
 * @param node - the expression.
 * @param qualify - the file's qualifier.
 * @returns the dotted name, or null for anything it can't name.
 */
export function qualifiedHead(node: Node, qualify: Qualify): string | null {
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
 * Makes the test for a role's modules: the entries when set, else a segment
 * anywhere in the name (`ports` for INW014's port modules, `adapters` for
 * INW020's adapter modules).
 *
 * @param entries - the option's module prefixes or selectors, if set.
 * @param segment - the module segment that marks the role by default.
 * @returns the test.
 */
export function moduleScope(
  entries: readonly string[] | undefined,
  segment: string,
): (module: string) => boolean {
  if (entries === undefined) {
    return (module: string): boolean => module.split(".").includes(segment);
  }
  return (module: string): boolean =>
    entries.some((entry) => matchEntry(entry, module) !== undefined);
}

/**
 * Builds the exemption matchers from a role rule's options: `allow-bases`
 * (or its default) plus `extend-allow-bases`, and `allow-decorators` (or its
 * default).
 *
 * @param options - the rule's options table, if set.
 * @returns the matchers for an exempt base and an exempt decorator.
 */
export function exemptMatchers(options: RuleOptions | undefined): {
  allowBase: NameMatch;
  allowDecorator: NameMatch;
} {
  const bases = stringList(options?.["allow-bases"]) ?? DEFAULT_ALLOW_BASES;
  const extra = stringList(options?.["extend-allow-bases"]) ?? [];
  const decorators = stringList(options?.["allow-decorators"]) ?? DEFAULT_ALLOW_DECORATORS;
  return { allowBase: nameMatcher([...bases, ...extra]), allowDecorator: nameMatcher(decorators) };
}
