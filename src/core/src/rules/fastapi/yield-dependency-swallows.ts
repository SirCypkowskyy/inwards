/**
 * @file FAPI007 `yield-dependency-swallows` (#226): a dependency with `yield`
 * whose `except` around the `yield` can end without raising. FastAPI throws
 * the endpoint's exception in at the `yield`, so such a clause swallows it:
 * the client gets a 500, even for an `HTTPException`, and the server logs
 * nothing.
 *
 * Per function, no call graph. A dependency is recognised by its shape, not
 * by a `Depends(...)` that names it (that may be in any file): an undecorated
 * generator function with exactly one `yield`, outside any loop. That leaves
 * out streaming generators, which yield in a loop, and `@contextmanager` or
 * `@pytest.fixture` functions. Unknown means silent: a clause counts as raising
 * when a loop or `match` in it may raise.
 */
import type { Node } from "web-tree-sitter";
import type { Diagnostic, SourceFile } from "../../contracts/records.ts";
import { diagnostic, RULES } from "../../meta/registry.ts";
import { identifierName, namedChildren } from "../../python/nodes.ts";
import { scopeNodes, spanOf } from "./syntax.ts";

/** The text pre-filter: a file without both words has no `yield` inside a `try`. */
const MENTIONS = /\byield\b[\s\S]*\bexcept\b/u;

/** Statements whose paths Inwards doesn't follow: a `raise` in one counts as raising. */
const OPAQUE: ReadonlySet<string> = new Set([
  "for_statement",
  "while_statement",
  "match_statement",
]);

/** Statements that leave a block without raising. */
const EXITS: ReadonlySet<string> = new Set([
  "return_statement",
  "break_statement",
  "continue_statement",
]);

/**
 * Tells whether a file may hold a `yield` inside a `try`, before any parse.
 *
 * @param text - the file's text.
 * @returns true when it spells `yield` and, later, `except`.
 */
export function mentionsYieldExcept(text: string): boolean {
  return MENTIONS.test(text);
}

/**
 * Reports the swallowing `except` clauses of one file's yield dependencies.
 *
 * @param src - the file.
 * @param root - its module node.
 * @returns one FAPI007 diagnostic per such clause.
 */
export function checkYieldDependencies(src: SourceFile, root: Node): Diagnostic[] {
  return root.descendantsOfType("function_definition").flatMap((fn) => {
    const yields = fn && fn.parent?.type !== "decorated_definition" ? scopeNodes(fn, "yield") : [];
    const [only, ...more] = yields;
    if (!(fn && only) || more.length > 0 || inLoop(only, fn)) {
      return [];
    }
    const name = fn.childForFieldName("name");
    return swallowing(only, fn).map((clause) =>
      report(src, clause, name ? identifierName(name) : ""),
    );
  });
}

/**
 * Tells whether a `yield` sits in a loop of its function.
 *
 * @param node - the `yield` node.
 * @param fn - its function.
 * @returns true for a `for` or `while` between them.
 */
function inLoop(node: Node, fn: Node): boolean {
  for (let at = node.parent; at !== null && at.id !== fn.id; at = at.parent) {
    if (at.type === "for_statement" || at.type === "while_statement") {
      return true;
    }
  }
  return false;
}

/**
 * Lists the `except` clauses around a `yield` that can end without raising:
 * those of every `try` whose body holds it. A clause that handles only
 * `GeneratorExit` is left out, as it never sees the endpoint's exception.
 *
 * @param node - the `yield` node.
 * @param fn - its function.
 * @returns the clauses, innermost `try` first.
 */
function swallowing(node: Node, fn: Node): Node[] {
  const clauses: Node[] = [];
  let child = node;
  for (let at = node.parent; at !== null && at.id !== fn.id; at = at.parent) {
    if (at.type === "try_statement" && at.childForFieldName("body")?.id === child.id) {
      const handlers = namedChildren(at).filter((c) => c.type === "except_clause");
      clauses.push(...handlers.filter((c) => !(generatorExit(c) || raises(blockOf(c)))));
    }
    child = at;
  }
  return clauses;
}

/**
 * Tells whether an `except` clause handles `GeneratorExit` and nothing else.
 *
 * @param clause - an `except_clause` node.
 * @returns true for `except GeneratorExit:`.
 */
function generatorExit(clause: Node): boolean {
  const type = clause.childForFieldName("value");
  const name = type?.type === "as_pattern" ? namedChildren(type)[0] : type;
  return name?.type === "identifier" && identifierName(name) === "GeneratorExit";
}

/**
 * Finds the block a clause runs.
 *
 * @param clause - an `except_clause`, `else_clause`, `finally_clause` or `elif_clause` node.
 * @returns its block, or null.
 */
function blockOf(clause: Node): Node | null {
  return namedChildren(clause).find((c) => c.type === "block") ?? null;
}

/**
 * Tells whether a block raises on every path: it reaches a `raise`, or a
 * statement that always raises, before anything that leaves it.
 *
 * @param block - a `block` node, or null for a missing one.
 * @returns true when every path through the block raises.
 */
function raises(block: Node | null): boolean {
  for (const statement of block ? namedChildren(block) : []) {
    if (EXITS.has(statement.type)) {
      return false;
    }
    if (statement.type === "raise_statement" || alwaysRaises(statement)) {
      return true;
    }
  }
  return false;
}

/**
 * Tells whether a compound statement raises on every path.
 *
 * @param statement - a statement node.
 * @returns true for an `if` whose every branch raises, a `try` that raises
 *   whichever way it goes, a `with` whose body raises, and a loop or `match`
 *   with any `raise` in it.
 */
function alwaysRaises(statement: Node): boolean {
  if (OPAQUE.has(statement.type)) {
    return statement.descendantsOfType("raise_statement").length > 0;
  }
  const body = statement.childForFieldName("body") ?? statement.childForFieldName("consequence");
  const clauses = namedChildren(statement);
  switch (statement.type) {
    case "with_statement":
      return raises(body);
    case "if_statement": {
      const branches = clauses.filter((c) => c.type === "elif_clause" || c.type === "else_clause");
      const hasElse = branches.some((c) => c.type === "else_clause");
      return (
        hasElse &&
        raises(body) &&
        branches.every((c) =>
          raises(c.childForFieldName("consequence") ?? c.childForFieldName("body")),
        )
      );
    }
    case "try_statement": {
      const final = clauses.find((c) => c.type === "finally_clause");
      const handlers = clauses.filter((c) => c.type === "except_clause");
      const orElse = clauses.find((c) => c.type === "else_clause");
      const bodyRaises =
        raises(body) || (orElse !== undefined && raises(orElse.childForFieldName("body")));
      return (
        (final !== undefined && raises(blockOf(final))) ||
        (bodyRaises && handlers.every((c) => raises(blockOf(c))))
      );
    }
    default:
      return false;
  }
}

/**
 * Builds the finding for one clause.
 *
 * @param src - the file.
 * @param clause - the `except_clause` node.
 * @param name - the dependency's name.
 * @returns the diagnostic, on the clause's `except ...:` line.
 */
function report(src: SourceFile, clause: Node, name: string): Diagnostic {
  const colon = clause.children.find((c) => c?.type === ":");
  const header = colon ? clause.text.slice(0, colon.endIndex - clause.startIndex) : "except:";
  const span = spanOf(clause);
  return diagnostic(RULES.FAPI007, src, {
    span: { ...span, endLine: span.line, endColumn: span.column + header.length },
    message: `\`${header}\` in \`${name}\` can end without raising, so it swallows what the endpoint raised at the \`yield\`: the client gets a 500, even for an HTTPException, and the server logs nothing.`,
    fix: {
      summary: `End \`${header}\` in \`${name}\` with a \`raise\`.`,
      steps: [
        "Keep the cleanup (a rollback, say), then re-raise with a bare `raise`, or raise an `HTTPException` that says what went wrong.",
        "Put cleanup that must always run in `finally:` rather than in `except`.",
        "If the dependency swallows the error on purpose, ask the user before suppressing this; don't edit [tool.inwards] yourself.",
      ],
    },
  });
}
