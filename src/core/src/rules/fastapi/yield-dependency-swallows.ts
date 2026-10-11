/**
 * @file FAPI007 `yield-dependency-swallows` (#226): a dependency with `yield`
 * sees the exceptions raised in the endpoint. When an `except` clause around
 * the `yield` neither re-raises nor raises another exception, the error stops
 * there: the client gets a 500 and the server has no log of the cause
 * (FastAPI docs, "Dependencies with yield"). The finding sits on the `except`
 * line.
 *
 * It reads one function at a time, with no call graph and no model: any
 * first-party generator function whose `yield` is inside a `try` with an
 * `except`, which covers every dependency. Generators decorated with
 * `contextmanager`, `asynccontextmanager` or `fixture` are skipped, since
 * swallowing is how a context manager suppresses an error on purpose and a
 * test fixture never sees the test's exception. So are streams, generators
 * that yield more than once or in a loop: a dependency yields once. An `except` passes when
 * every path through it raises, as Inwards can tell: a `raise` in the block,
 * or an `if`/`else`, `with` or `try` whose every branch raises.
 */
import type { Node, Parser } from "web-tree-sitter";
import type { Diagnostic, SourceFile, Span } from "../../contracts/records.ts";
import { diagnostic, RULES } from "../../meta/registry.ts";
import { identifierName, namedChildren } from "../../python/nodes.ts";
import { parsePython } from "../../python/parser.ts";
import { ownNodes } from "./function-body.ts";
import { spanOf } from "./syntax.ts";

/** The decorators that make a generator something other than a dependency. */
const NOT_DEPENDENCY = /(?:contextmanager|fixture)\b/u;

/** Source that can hold a dependency that swallows: it spells both words. */
const YIELD = /\byield\b/u;
const EXCEPT = /\bexcept\b/u;

/** The node types of an `except` clause. */
const EXCEPT_CLAUSES: ReadonlySet<string> = new Set(["except_clause", "except_group_clause"]);

/**
 * Finds the block of statements a clause or statement owns.
 *
 * @param node - an `if`, `elif`, `else`, `except`, `with` or `finally` node.
 * @returns the node's `block`, or null when it has none.
 */
function blockOf(node: Node): Node | null {
  const named =
    node.childForFieldName("consequence") ??
    node.childForFieldName("body") ??
    namedChildren(node).findLast((c) => c.type === "block");
  return named?.type === "block" ? named : null;
}

/**
 * Tells whether every path through a block raises, as far as the syntax shows.
 *
 * @param block - a `block` node, or null for a missing one.
 * @returns true when a statement of the block raises on every path through it.
 */
function raises(block: Node | null): boolean {
  for (const statement of block ? namedChildren(block) : []) {
    if (statement.type === "return_statement") {
      return false;
    }
    if (statement.type === "raise_statement" || alwaysRaises(statement)) {
      return true;
    }
  }
  return false;
}

/**
 * Tells whether a compound statement raises whichever branch it takes.
 *
 * @param statement - a statement node.
 * @returns true for an `if` with an `else` whose branches all raise, a `with`
 *   whose body raises, or a `try` that raises in its `finally`, or in its body
 *   and all its `except` clauses.
 */
function alwaysRaises(statement: Node): boolean {
  const parts = namedChildren(statement);
  switch (statement.type) {
    case "if_statement": {
      const branches = parts.filter((p) => p.type === "elif_clause" || p.type === "else_clause");
      const closed = branches.some((p) => p.type === "else_clause");
      return closed && raises(blockOf(statement)) && branches.every((p) => raises(blockOf(p)));
    }
    case "with_statement":
      return raises(blockOf(statement));
    case "try_statement": {
      const finalRaises = parts.some((p) => p.type === "finally_clause" && raises(blockOf(p)));
      const handlers = parts.filter((p) => EXCEPT_CLAUSES.has(p.type));
      const bodyRaises = raises(blockOf(statement)) && handlers.every((p) => raises(blockOf(p)));
      return finalRaises || (bodyRaises && handlers.length > 0);
    }
    default:
      return false;
  }
}

/**
 * Finds the colon that ends an `except` clause's header.
 *
 * @param clause - an `except_clause` node.
 * @returns the colon, or the clause itself when it has none.
 */
function headerEnd(clause: Node): Node {
  return clause.children.find((c) => c?.type === ":") ?? clause;
}

/**
 * Spans the header of an `except` clause, up to its colon.
 *
 * @param clause - an `except_clause` node.
 * @returns the 1-based span of `except Exception:`.
 */
function headerSpan(clause: Node): Span {
  const end = headerEnd(clause);
  return {
    ...spanOf(clause),
    endLine: end.endPosition.row + 1,
    endColumn: end.endPosition.column + 1,
  };
}

/**
 * Tells whether a generator function is something other than a dependency.
 *
 * @param fn - a `function_definition` node.
 * @returns true when a decorator makes it a context manager or a fixture.
 */
function decoratedAway(fn: Node): boolean {
  const decorators = fn.parent?.type === "decorated_definition" ? namedChildren(fn.parent) : [];
  return decorators.some((d) => d.type === "decorator" && NOT_DEPENDENCY.test(d.text));
}

/** Loops: a `yield` inside one makes the generator a stream. */
const LOOPS: ReadonlySet<string> = new Set(["for_statement", "while_statement"]);

/**
 * Tells whether a generator is a stream rather than a dependency: it yields
 * more than once, or in a loop. FastAPI runs a dependency's code up to its
 * one `yield` and the rest after the response, so neither shape is one; the
 * #182 corpus run found only such streams behind FAPI007's findings (Polar's
 * server-sent events, Saleor's discount iterator).
 *
 * @param fn - a `function_definition` node.
 * @param yields - the function's own `yield` nodes.
 * @returns true for a generator with two or more yields, or one inside a `for` or `while` of its own.
 */
function isStream(fn: Node, yields: readonly Node[]): boolean {
  if (yields.length > 1) {
    return true;
  }
  return yields.some((y) => {
    for (let node = y.parent; node !== null && node.id !== fn.id; node = node.parent) {
      if (LOOPS.has(node.type)) {
        return true;
      }
    }
    return false;
  });
}

/**
 * Builds the finding for one `except` clause.
 *
 * @param clause - the clause that doesn't raise on every path.
 * @param label - the generator function's name.
 * @param src - the file.
 * @returns the diagnostic, on the clause's header.
 */
function report(clause: Node, label: string, src: SourceFile): Diagnostic {
  const header = clause.text.slice(0, headerEnd(clause).startIndex - clause.startIndex).trim();
  return diagnostic(RULES.FAPI007, src, {
    span: headerSpan(clause),
    message: `\`${header}\` around the \`yield\` in \`${label}\` never re-raises: an error from the endpoint stops here, so the client gets a 500 and the server has no log of the cause.`,
    fix: {
      summary: "Re-raise the exception at the end of the except block.",
      steps: [
        "Finish the except block with `raise`, after the cleanup it does (a rollback, say), so FastAPI sees the error.",
        "If the client should get another status, raise an HTTPException (`raise HTTPException(...) from exc`) instead of returning quietly.",
        "Don't drop the except block to make this finding go away: the cleanup in it is needed.",
      ],
    },
  });
}

/**
 * Finds the `except` clauses of a function that hide an error from the `yield`.
 *
 * @param fn - a `function_definition` node.
 * @param src - the file, for the diagnostics.
 * @returns one finding per clause that doesn't raise on every path.
 */
function swallowsIn(fn: Node, src: SourceFile): Diagnostic[] {
  const yields = ownNodes(fn, new Set(["yield"]));
  if (yields.length === 0 || decoratedAway(fn) || isStream(fn, yields)) {
    return [];
  }
  const name = fn.childForFieldName("name");
  const label = name ? identifierName(name) : "the generator";
  return ownNodes(fn, new Set(["try_statement"])).flatMap((statement) => {
    const body = statement.childForFieldName("body");
    const around =
      body !== null &&
      yields.some((y) => y.startIndex >= body.startIndex && y.endIndex <= body.endIndex);
    const clauses = around
      ? namedChildren(statement).filter((c) => EXCEPT_CLAUSES.has(c.type))
      : [];
    return clauses.filter((clause) => !raises(blockOf(clause))).map((c) => report(c, label, src));
  });
}

/**
 * Checks one file for dependencies that swallow the endpoint's exceptions.
 * Parses the file only when it spells both `yield` and `except`.
 *
 * @param parser - parser with the Python grammar loaded.
 * @param src - the file, with normalised text.
 * @returns the findings, in source order.
 */
export function checkYieldSwallows(parser: Parser, src: SourceFile): Diagnostic[] {
  if (!(YIELD.test(src.text) && EXCEPT.test(src.text))) {
    return [];
  }
  const tree = parsePython(parser, src.text);
  try {
    return tree.rootNode
      .descendantsOfType("function_definition")
      .flatMap((fn) => (fn ? swallowsIn(fn, src) : []))
      .sort((a, b) => a.line - b.line);
  } finally {
    tree.delete(); // WASM memory is not garbage collected
  }
}
