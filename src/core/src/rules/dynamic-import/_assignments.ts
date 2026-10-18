/**
 * @file Reads what an assignment or a walrus binds, for the loader search in
 * `callees.ts`: plain, chained, tuple and starred targets paired with their
 * values by position, attribute targets, and names assigned in a class body.
 * It pairs syntax only; deciding what a value means is `callees.ts`'s job.
 */
import type { Node } from "web-tree-sitter";
import { identifierName, namedChildren } from "../../python/nodes.ts";

/** Prefix of the keys under which attribute names are bound: `.load` for `x.load = loader`. */
export const ATTRIBUTE = ".";

/** A name, or an attribute name under `ATTRIBUTE`, and the expression it is bound to. */
export interface Assigned {
  name: string;
  right: Node;
}

/**
 * Reads what an assignment binds. `a = b = x` binds both names to `x`;
 * `a, b = x, y` and `a, *rest, b = x, y, z` pair names with values by
 * position (a starred name gets a list, never a loader); `obj.attr = x`
 * binds the attribute name, and so does `attr = x` directly in a class body.
 *
 * @param node - an `assignment` node.
 * @returns each bound name with its value; nothing for a value that can't be paired.
 */
export function assignedNames(node: Node): Assigned[] {
  const left = node.childForFieldName("left");
  let right = node.childForFieldName("right");
  while (right?.type === "assignment") {
    right = right.childForFieldName("right"); // `a = b = x`
  }
  if (!(left && right)) {
    return [];
  }
  const pairs = paired(left, right);
  const inClass = node.parent?.parent?.parent?.type === "class_definition";
  const attributes =
    inClass && left.type === "identifier" && node.parent?.type === "expression_statement"
      ? [{ name: ATTRIBUTE + identifierName(left), right }]
      : [];
  return [...pairs, ...attributes];
}

/** Target patterns whose parts pair with the parts of a literal tuple or list. */
const TARGET_PATTERNS = new Set(["pattern_list", "tuple_pattern", "list_pattern"]);

/** Values whose parts pair with a target pattern. */
const VALUE_SEQUENCES = new Set(["expression_list", "tuple", "list"]);

/**
 * Pairs an assignment target with its value, recursing into tuple and list targets.
 *
 * @param target - the target: a name, an attribute, or a pattern of them.
 * @param value - the assigned expression.
 * @returns each bound name with its value.
 */
function paired(target: Node, value: Node): Assigned[] {
  if (target.type === "identifier") {
    return [{ name: identifierName(target), right: value }];
  }
  if (target.type === "attribute") {
    const attribute = target.childForFieldName("attribute");
    return attribute ? [{ name: ATTRIBUTE + identifierName(attribute), right: value }] : [];
  }
  if (!(TARGET_PATTERNS.has(target.type) && VALUE_SEQUENCES.has(value.type))) {
    return [];
  }
  const names = namedChildren(target);
  const values = namedChildren(value);
  if (values.some((v) => v.type === "list_splat")) {
    return []; // `*xs` on the right: positions unknown
  }
  const star = names.findIndex((n) => n.type === "list_splat_pattern");
  const before = star === -1 ? names : names.slice(0, star);
  const after = star === -1 ? [] : names.slice(star + 1);
  const tail = values.slice(values.length - after.length);
  return [
    ...before.flatMap((n, i) => {
      const v = values[i];
      return v ? paired(n, v) : [];
    }),
    ...after.flatMap((n, i) => {
      const v = tail[i];
      return v && values.length >= before.length + after.length ? paired(n, v) : [];
    }),
  ];
}

/**
 * Reads what a walrus binds: `(im := importlib.import_module)`.
 *
 * @param node - a `named_expression` node.
 * @returns the bound name and value, or nothing for a malformed node.
 */
export function walrusName(node: Node): Assigned[] {
  const name = node.childForFieldName("name");
  const value = node.childForFieldName("value");
  return name && value ? [{ name: identifierName(name), right: value }] : [];
}
