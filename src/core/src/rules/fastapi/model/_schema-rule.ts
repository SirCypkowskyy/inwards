/**
 * @file How a route class decides whether a route is in the OpenAPI schema
 * (#392), read from its first-party classes: FastAPI's default when none
 * writes `include_in_schema` or `tags`, a tag rule when one `__init__`
 * writes `self.include_in_schema` and nothing writes the tags (Polar's
 * `IncludedInSchemaAPIRoute`), unknown otherwise. Also the tag sets the
 * rule is run on and the small syntax readers `tag-rule.ts` shares. It
 * reads syntax only; `tag-rule.ts` runs the rule for one route.
 */
import type { Node } from "web-tree-sitter";
import { identifierName, namedChildren } from "../../../shared/python/nodes.ts";
import type { Qualify } from "../../../shared/python/qualify.ts";

/** The nodes whose bodies are another scope. */
const SCOPES: ReadonlySet<string> = new Set(["function_definition", "class_definition", "lambda"]);

/** Whether a route is in the schema: shown, left out, or unknown (which means silent). */
export type Visibility = "shown" | "hidden" | "unknown";

/** A first-party class as the project lookups give it. */
export interface ClassSyntax {
  readonly node: Node;
  readonly qualify: Qualify;
}

/** How a route class decides whether a route is in the schema. */
export type SchemaRule =
  | { readonly kind: "default" | "unknown" }
  | { readonly kind: "tags"; readonly body: Node; readonly qualify: Qualify };

/** A route's tags as string values; `open` when some can't be read. */
export interface TagSet {
  readonly values: ReadonlySet<string>;
  readonly open: boolean;
}

/**
 * Joins two tag sets.
 *
 * @param a - the first set.
 * @param b - the second set.
 * @returns their union, open when either is.
 */
export function join(a: TagSet, b: TagSet): TagSet {
  return { values: new Set([...a.values, ...b.values]), open: a.open || b.open };
}

/**
 * Reads a plain string literal's text.
 *
 * @param node - a node.
 * @returns the text between the quotes, or null for anything else.
 */
export function stringText(node: Node): string | null {
  const parts = node.type === "string" ? namedChildren(node) : [];
  const content = parts.filter((part) => part.type === "string_content");
  return node.type === "string" && content.length <= 1 && !node.text.startsWith("f")
    ? (content[0]?.text ?? "")
    : null;
}

/**
 * Finds how a route class's first-party classes decide the schema: FastAPI's
 * default when none writes `include_in_schema` or `tags`, a tag rule when
 * only one `__init__` writes `self.include_in_schema` and nothing writes
 * the tags, unknown otherwise.
 *
 * @param classes - the route class and its first-party bases.
 * @returns the default, a tag rule over one `__init__` body, or unknown.
 */
export function schemaRule(classes: readonly ClassSyntax[]): SchemaRule {
  const writes = classes.flatMap((c) =>
    c.node.descendantsOfType(["assignment", "augmented_assignment"]).flatMap((assignment) => {
      const left = assignment?.childForFieldName("left");
      const target = left ? writtenName(left) : null;
      return assignment && (target === "include_in_schema" || target === "tags")
        ? [{ assignment, target, c }]
        : [];
    }),
  );
  const [first] = writes;
  if (first === undefined) {
    return { kind: "default" };
  }
  const body = enclosingInit(first.assignment);
  const one = writes.every(
    (w) =>
      w.target === "include_in_schema" &&
      body !== null &&
      enclosingInit(w.assignment)?.id === body.id,
  );
  const self = first.assignment.childForFieldName("left")?.type === "attribute";
  return one && self && body !== null
    ? { kind: "tags", body, qualify: first.c.qualify }
    : { kind: "unknown" };
}

/**
 * Names what an assignment target writes: `self.x` and `kwargs["x"]` give `x`.
 *
 * @param left - the assignment's left side.
 * @returns the attribute or key, or null for any other target.
 */
export function writtenName(left: Node): string | null {
  if (left.type === "attribute") {
    const attribute = left.childForFieldName("attribute");
    return attribute ? identifierName(attribute) : null;
  }
  const key = left.type === "subscript" ? left.childForFieldName("subscript") : null;
  return key ? stringText(key) : null;
}

/**
 * Finds the `__init__` body a node sits in, directly in its own scope.
 *
 * @param node - a node inside a class.
 * @returns the `__init__`'s body block, or null when the node isn't in one.
 */
function enclosingInit(node: Node): Node | null {
  for (let at = node.parent; at !== null; at = at.parent) {
    if (SCOPES.has(at.type)) {
      const name = at.type === "function_definition" ? at.childForFieldName("name") : null;
      return name && identifierName(name) === "__init__" ? at.childForFieldName("body") : null;
    }
  }
  return null;
}
