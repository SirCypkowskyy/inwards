/**
 * @file Measures one endpoint's body for INW012 in one walk: statements,
 * branches, how deep blocks nest, its loops, and the calls it makes. Mapping
 * an error to HTTP is the endpoint's job, so a guard (`if <cond>: raise
 * HTTPException(...)`) and an `except` that only raises one count for
 * nothing. A docstring doesn't count either. A nested function, class or
 * lambda counts as one statement and its body is its own business. It reads
 * syntax only; what is denied is `check.ts`'s question.
 */
import type { Node } from "web-tree-sitter";
import { namedChildren } from "../../python/nodes.ts";

/** Nodes whose bodies run in another scope. */
const SCOPES: ReadonlySet<string> = new Set([
  "function_definition",
  "class_definition",
  "decorated_definition",
  "lambda",
]);

/** Statements that hold blocks. */
const COMPOUND: ReadonlySet<string> = new Set([
  "if_statement",
  "for_statement",
  "while_statement",
  "try_statement",
  "with_statement",
  "match_statement",
]);

/** The clauses of a compound statement that hold a block of their own. */
const CLAUSES: ReadonlySet<string> = new Set([
  "elif_clause",
  "else_clause",
  "except_clause",
  "except_group_clause",
  "finally_clause",
  "case_clause",
]);

/** Comprehensions: loops written as expressions. */
const COMPREHENSIONS: ReadonlySet<string> = new Set([
  "list_comprehension",
  "set_comprehension",
  "dictionary_comprehension",
  "generator_expression",
]);

/** What INW012 counts in one endpoint. */
export interface Metrics {
  /** Statements, nested ones included; guards and the docstring left out. */
  readonly statements: number;
  /** `if` and `elif`, `case` clauses and `except` handlers, guards left out. */
  readonly branches: number;
  /** How many compound statements nest inside each other at the deepest point. */
  readonly nesting: number;
  /** `for` and `while` statements. */
  readonly loops: number;
  /** Comprehensions and generator expressions. */
  readonly comprehensions: number;
  /** The calls in the body, nested scopes left out, in source order. */
  readonly calls: readonly Node[];
  /** The first and last line of the counted statements, 1-based; 0 when there are none. */
  readonly lines: readonly [number, number];
}

/** Tells whether a `raise` statement maps an error to HTTP. */
export type RaisesHttp = (raise: Node) => boolean;

/** The counts so far, and what the walk needs to tell guards and the docstring apart. */
interface Tally {
  statements: number;
  branches: number;
  nesting: number;
  loops: number;
  first: number;
  last: number;
  readonly raisesHttp: RaisesHttp;
  /** Where the function's docstring starts, which doesn't count; -1 for none. */
  readonly docstring: number;
}

/**
 * Tells whether a block holds one statement and it raises an HTTP error.
 *
 * @param block - a `block` node.
 * @param raisesHttp - tells whether a `raise` maps an error to HTTP.
 * @returns true for a guard's or a mapping handler's body.
 */
function onlyRaisesHttp(block: Node | null | undefined, raisesHttp: RaisesHttp): boolean {
  const statements = block ? namedChildren(block) : [];
  const [only] = statements;
  return statements.length === 1 && only?.type === "raise_statement" && raisesHttp(only);
}

/**
 * Tells whether a statement is a guard: an `if` with no `elif` or `else`
 * whose body only raises an HTTP error.
 *
 * @param statement - a statement node.
 * @param raisesHttp - tells whether a `raise` maps an error to HTTP.
 * @returns true for `if <cond>: raise HTTPException(...)`.
 */
function isGuard(statement: Node, raisesHttp: RaisesHttp): boolean {
  return (
    statement.type === "if_statement" &&
    statement.childrenForFieldName("alternative").length === 0 &&
    onlyRaisesHttp(statement.childForFieldName("consequence"), raisesHttp)
  );
}

/**
 * Tells whether a clause holds a block that counts: every clause but an
 * `except` handler that only raises an HTTP error.
 *
 * @param clause - a clause node of a compound statement.
 * @param raisesHttp - tells whether a `raise` maps an error to HTTP.
 * @returns false for a mapping handler.
 */
function counts(clause: Node, raisesHttp: RaisesHttp): boolean {
  const handler = clause.type === "except_clause" || clause.type === "except_group_clause";
  const block = namedChildren(clause).find((child) => child.type === "block");
  return !(handler && onlyRaisesHttp(block, raisesHttp));
}

/**
 * Lists the blocks a compound statement holds, each with whether it is a
 * branch of its own (`elif`, `case`, `except`), handlers that only map an
 * error to HTTP left out.
 *
 * @param statement - a compound statement.
 * @param raisesHttp - tells whether a `raise` maps an error to HTTP.
 * @returns the blocks and whether each adds a branch.
 */
function blocksOf(statement: Node, raisesHttp: RaisesHttp): { block: Node; branch: boolean }[] {
  const children = namedChildren(statement).flatMap((child) =>
    statement.type === "match_statement" && child.type === "block" ? namedChildren(child) : [child],
  );
  return children.flatMap((child) => {
    if (child.type === "block") {
      return [{ block: child, branch: false }];
    }
    if (!(CLAUSES.has(child.type) && counts(child, raisesHttp))) {
      return [];
    }
    const branch = child.type !== "else_clause" && child.type !== "finally_clause";
    const blocks = namedChildren(child).filter((part) => part.type === "block");
    return blocks.map((block) => ({ block, branch }));
  });
}

/**
 * Counts one compound statement: its nesting level, its own branch or loop,
 * and the blocks it holds, each walked one level deeper.
 *
 * @param statement - an `if`, `for`, `while`, `try`, `with` or `match` statement.
 * @param depth - how many compound statements enclose it.
 * @param tally - the counts so far, updated in place.
 */
function countCompound(statement: Node, depth: number, tally: Tally): void {
  tally.nesting = Math.max(tally.nesting, depth + 1);
  tally.branches += statement.type === "if_statement" ? 1 : 0;
  const loop = statement.type === "for_statement" || statement.type === "while_statement";
  tally.loops += loop ? 1 : 0;
  for (const { block, branch } of blocksOf(statement, tally.raisesHttp)) {
    tally.branches += branch ? 1 : 0;
    walk(block, depth + 1, tally);
  }
}

/**
 * Walks one block's statements, counting into the tally.
 *
 * @param block - a `block` node.
 * @param depth - how many compound statements enclose it.
 * @param tally - the counts so far, updated in place.
 */
function walk(block: Node, depth: number, tally: Tally): void {
  for (const statement of namedChildren(block)) {
    if (statement.startIndex === tally.docstring || isGuard(statement, tally.raisesHttp)) {
      continue;
    }
    tally.statements += 1;
    tally.first = tally.first === 0 ? statement.startPosition.row + 1 : tally.first;
    tally.last = Math.max(tally.last, statement.endPosition.row + 1);
    if (COMPOUND.has(statement.type)) {
      countCompound(statement, depth, tally);
    }
  }
}

/**
 * Lists the calls and comprehensions in a function's body, leaving out
 * nested functions, classes and lambdas.
 *
 * @param body - the function's `block`.
 * @returns the `call` nodes in source order, and how many comprehensions there are.
 */
function callsIn(body: Node): { calls: Node[]; comprehensions: number } {
  const calls: Node[] = [];
  let comprehensions = 0;
  const stack = [body];
  for (let node = stack.pop(); node; node = stack.pop()) {
    if (node.type === "call") {
      calls.push(node);
    }
    comprehensions += COMPREHENSIONS.has(node.type) ? 1 : 0;
    if (!SCOPES.has(node.type)) {
      stack.push(...namedChildren(node).reverse());
    }
  }
  return { calls, comprehensions };
}

/**
 * Tells whether a statement is a docstring: a lone string expression.
 *
 * @param statement - the first statement of a body.
 * @returns true for a docstring.
 */
function isDocstring(statement: Node): boolean {
  const [only, ...more] = namedChildren(statement);
  const literal = only?.type === "string" || only?.type === "concatenated_string";
  return statement.type === "expression_statement" && literal && more.length === 0;
}

/**
 * Measures an endpoint's body.
 *
 * @param fn - the endpoint's `function_definition` node.
 * @param raisesHttp - tells whether a `raise` maps an error to HTTP.
 * @returns the counts, the calls and the lines the counted statements span.
 */
export function measure(fn: Node, raisesHttp: RaisesHttp): Metrics {
  const body = fn.childForFieldName("body");
  const [first] = body ? namedChildren(body) : [];
  const docstring = first && isDocstring(first) ? first.startIndex : -1;
  const start = { statements: 0, branches: 0, nesting: 0, loops: 0, first: 0, last: 0 };
  const tally: Tally = { ...start, raisesHttp, docstring };
  if (!body) {
    return { ...start, comprehensions: 0, calls: [], lines: [0, 0] };
  }
  walk(body, 0, tally);
  const { calls, comprehensions } = callsIn(body);
  const { statements, branches, nesting, loops } = tally;
  return {
    statements,
    branches,
    nesting,
    loops,
    comprehensions,
    calls,
    lines: [tally.first, tally.last],
  };
}
