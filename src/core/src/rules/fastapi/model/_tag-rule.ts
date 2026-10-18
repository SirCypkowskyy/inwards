/**
 * @file Runs a route class's tag rule for one route (#392): the `__init__`
 * that `schema-rule.ts` found, as an `if`/`elif`/`else` chain over
 * `<tag> in self.tags` (or a local bound to it) and
 * `self.include_in_schema`, assigning `True`, `False`, or anything else,
 * which leaves the answer unknown (Polar's `settings.is_development()` for
 * private routes). Any other statement that writes `include_in_schema`, or a
 * condition it can't read around one, makes the whole answer unknown. It
 * evaluates syntax and resolves nothing; the caller reads each tag.
 */
import type { Node } from "web-tree-sitter";
import { identifierName, namedChildren } from "../../../shared/python/nodes.ts";
import { type TagSet, type Visibility, writtenName } from "./_schema-rule.ts";

/** Three-valued truth while a route class's `__init__` is read. */
type Truth = boolean | "unknown";

/** What evaluating a route class's `__init__` needs. */
interface Evaluation {
  readonly tags: TagSet;
  readonly tagOf: (node: Node) => string | null;
  /** Local names bound to `self.tags`. */
  readonly aliases: Set<string>;
  /** `include_in_schema` so far: a literal, or `unknown` for any other value. */
  include: Truth;
}

/**
 * Runs a tag rule's `__init__` for one route's tags: an `if`/`elif`/`else`
 * chain over `<tag> in self.tags` (or a local bound to it) and
 * `self.include_in_schema`, assigning `True`, `False` or anything else
 * (unknown, such as Polar's `settings.is_development()` for private routes).
 *
 * @param rule - the tag rule.
 * @param rule.body - the `__init__` body.
 * @param tags - the route's tags.
 * @param tagOf - reads a tag written in a condition.
 * @returns shown, hidden, or unknown.
 */
export function evaluate(
  rule: { readonly body: Node },
  tags: TagSet,
  tagOf: (node: Node) => string | null,
): Visibility {
  const state: Evaluation = { tags, tagOf, aliases: new Set(), include: true };
  if (!run(rule.body, state)) {
    return "unknown";
  }
  if (state.include === "unknown") {
    return "unknown";
  }
  return state.include ? "shown" : "hidden";
}

/**
 * Runs a block's statements.
 *
 * @param block - a block node.
 * @param state - the evaluation, changed in place.
 * @returns false when a statement that writes `include_in_schema` can't be read.
 */
function run(block: Node, state: Evaluation): boolean {
  for (const statement of namedChildren(block)) {
    if (!step(statement, state)) {
      return false;
    }
  }
  return true;
}

/**
 * Runs one statement of the rule's `__init__`.
 *
 * @param statement - one statement of the `__init__` body.
 * @param state - the evaluation, changed in place.
 * @returns false when it writes `include_in_schema` in a way that can't be read.
 */
function step(statement: Node, state: Evaluation): boolean {
  if (statement.type === "if_statement") {
    return branch(statement, state);
  }
  const [assignment] = statement.type === "expression_statement" ? namedChildren(statement) : [];
  const left = assignment?.type === "assignment" ? assignment.childForFieldName("left") : null;
  const right = assignment?.childForFieldName("right") ?? null;
  if (left?.type === "identifier" && right !== null) {
    if (isSelfTags(right)) {
      state.aliases.add(identifierName(left));
    } else {
      state.aliases.delete(identifierName(left));
    }
    return true;
  }
  if (left !== null && writtenName(left) === "include_in_schema") {
    state.include =
      right?.type === "true" || right?.type === "false" ? right.type === "true" : "unknown";
    return true;
  }
  return !writesSchema(statement);
}

/**
 * Runs an `if` statement: the first clause whose condition holds.
 *
 * @param statement - the `if_statement`.
 * @param state - the evaluation, changed in place.
 * @returns false when a condition can't be read and a clause writes `include_in_schema`.
 */
function branch(statement: Node, state: Evaluation): boolean {
  const clauses: { condition: Node | null; body: Node | null }[] = [
    {
      condition: statement.childForFieldName("condition"),
      body: statement.childForFieldName("consequence"),
    },
    ...statement.childrenForFieldName("alternative").flatMap((clause) =>
      clause === null
        ? []
        : [
            {
              condition: clause.childForFieldName("condition"),
              body: clause.childForFieldName(
                clause.type === "else_clause" ? "body" : "consequence",
              ),
            },
          ],
    ),
  ];
  for (const { condition, body } of clauses) {
    const holds = condition === null ? true : truth(condition, state);
    if (holds === "unknown") {
      return !writesSchema(statement);
    }
    if (holds) {
      return body === null ? true : run(body, state);
    }
  }
  return true;
}

/**
 * Reads a condition: `<tag> in tags`, `<tag> not in tags`,
 * `self.include_in_schema`, and `not`, `and`, `or` over those.
 *
 * @param node - the condition.
 * @param state - the evaluation.
 * @returns its truth, or unknown.
 */
function truth(node: Node, state: Evaluation): Truth {
  if (node.type === "parenthesized_expression") {
    const [inner] = namedChildren(node);
    return inner ? truth(inner, state) : "unknown";
  }
  if (node.type === "not_operator") {
    const argument = node.childForFieldName("argument");
    const value = argument ? truth(argument, state) : "unknown";
    return value === "unknown" ? value : !value;
  }
  if (node.type === "boolean_operator") {
    return logic(node, state);
  }
  if (node.type === "attribute" && writtenName(node) === "include_in_schema") {
    return state.include;
  }
  return node.type === "comparison_operator" ? membership(node, state) : "unknown";
}

/**
 * Reads `a and b` or `a or b`.
 *
 * @param node - the `boolean_operator`.
 * @param state - the evaluation.
 * @returns its truth, or unknown.
 */
function logic(node: Node, state: Evaluation): Truth {
  const left = node.childForFieldName("left");
  const right = node.childForFieldName("right");
  const a = left ? truth(left, state) : "unknown";
  const b = right ? truth(right, state) : "unknown";
  const and = node.childForFieldName("operator")?.type === "and";
  // `and` is decided by a false side, `or` by a true one; otherwise an unknown side leaves it unknown.
  if (a === !and || b === !and) {
    return !and;
  }
  return a === "unknown" || b === "unknown" ? "unknown" : and;
}

/**
 * Reads `<tag> in tags` or `<tag> not in tags`.
 *
 * @param node - the `comparison_operator`.
 * @param state - the evaluation.
 * @returns its truth, or unknown when the tag or the collection can't be read.
 */
function membership(node: Node, state: Evaluation): Truth {
  const [tag, collection, ...rest] = namedChildren(node);
  const operator = node.children
    .filter((child) => child !== null && !child.isNamed)
    .map((child) => child?.type)
    .join(" ");
  const negated = operator === "not in";
  const ofTags =
    collection !== undefined &&
    (isSelfTags(collection) ||
      (collection.type === "identifier" && state.aliases.has(identifierName(collection))));
  const value = tag ? state.tagOf(tag) : null;
  if (rest.length > 0 || !ofTags || value === null || !(operator === "in" || negated)) {
    return "unknown";
  }
  let found: Truth = false;
  if (state.tags.values.has(value)) {
    found = true;
  } else if (state.tags.open) {
    found = "unknown";
  }
  return found === "unknown" ? found : found !== negated;
}

/**
 * Tells whether a node is `self.tags`.
 *
 * @param node - an expression.
 * @returns true for that attribute.
 */
function isSelfTags(node: Node): boolean {
  const object = node.type === "attribute" ? node.childForFieldName("object") : null;
  return (
    object?.type === "identifier" &&
    identifierName(object) === "self" &&
    writtenName(node) === "tags"
  );
}

/**
 * Tells whether a statement writes `include_in_schema` anywhere inside it.
 *
 * @param statement - a statement.
 * @returns true when an assignment in it targets `self.include_in_schema`.
 */
function writesSchema(statement: Node): boolean {
  return statement.descendantsOfType("assignment").some((assignment) => {
    const left = assignment?.childForFieldName("left");
    return left ? writtenName(left) === "include_in_schema" : false;
  });
}
