/**
 * @file FAPI009 `depends-called` (#228): `Depends(get_db())` calls the
 * dependency once, when the module is imported, and hands FastAPI its result
 * instead of the function to call per request. Ruff's B008 only reads
 * argument defaults, so `Annotated[Session, Depends(get_db())]` is checked
 * by nothing else. The call is reported when the callee is a first-party
 * function that a call cannot turn into something callable: a generator
 * (FastAPI gets a generator object), an `async def` (a coroutine nobody
 * awaits), or a function whose every return is a plain value or nothing.
 *
 * A factory such as `Depends(require_role("admin"))` that returns a function
 * passes, and so does any return Inwards can't classify (a call, a name, a
 * lambda): unknown means silent. A decorated function passes too, as its
 * decorator may change what it returns. The callee is resolved through the
 * model, so a function in another module is read, one hop.
 */
import type { Node } from "web-tree-sitter";
import type { Diagnostic, SourceFile } from "../../contracts/records.ts";
import { diagnostic, RULES } from "../../meta/registry.ts";
import { namedChildren } from "../../python/nodes.ts";
import { isAsync, isGenerator, ownNodes } from "./function-body.ts";
import type { FastApiProject } from "./project.ts";
import type { DependencyUse, FastApiFile } from "./records.ts";
import { spanOf } from "./syntax.ts";

/** The expressions that are never callable. */
const PLAIN: ReadonlySet<string> = new Set([
  "string",
  "concatenated_string",
  "integer",
  "float",
  "true",
  "false",
  "none",
  "list",
  "tuple",
  "set",
  "dictionary",
  "list_comprehension",
  "set_comprehension",
  "dictionary_comprehension",
  "generator_expression",
  "comparison_operator",
  "not_operator",
]);

/**
 * Says why calling a function cannot give FastAPI something callable.
 *
 * @param fn - the callee's `function_definition` node.
 * @returns the reason, or null when the result may be callable or can't be told.
 */
function whyNotCallable(fn: Node): string | null {
  if (fn.parent?.type === "decorated_definition") {
    return null;
  }
  if (isGenerator(fn)) {
    return "is a generator function (the call returns a generator object)";
  }
  if (isAsync(fn)) {
    return "is an async function (the call returns a coroutine that nothing awaits)";
  }
  const returns = ownNodes(fn, new Set(["return_statement"]));
  if (returns.length === 0) {
    return "returns nothing (the call gives None)";
  }
  const plain = returns.every((r) => namedChildren(r).every((v) => PLAIN.has(v.type)));
  return plain ? "returns a plain value (the call gives data, not a function)" : null;
}

/**
 * Quotes a dependency call as written, without its other arguments.
 *
 * @param use - the `Depends(...)` or `Security(...)` call.
 * @returns for example `Depends(get_db())`.
 */
function quote(use: DependencyUse): string {
  const callee = use.node.childForFieldName("function")?.text ?? "Depends";
  return `${callee}(${use.argument?.text ?? ""})`;
}

/**
 * Checks one file's `Depends(...)` and `Security(...)` calls.
 *
 * @param file - the file's FastAPI records.
 * @param src - the file, for the diagnostics.
 * @param scope - this check's FastAPI lookups.
 * @returns the findings, in source order.
 */
export function checkDependsCalled(
  file: FastApiFile,
  src: SourceFile,
  scope: FastApiProject,
): Diagnostic[] {
  return file.dependencies.flatMap((use) => {
    const { target } = use;
    const callee = target?.kind === "call" ? target.callee : null;
    const found = callee === null ? null : scope.resolve(callee);
    const why = found?.kind === "function" ? whyNotCallable(found.node) : null;
    if (callee === null || why === null || use.argument === null) {
      return [];
    }
    const name = callee.slice(callee.lastIndexOf(".") + 1);
    return [
      diagnostic(RULES.FAPI009, src, {
        span: spanOf(use.node),
        message: `\`${quote(use)}\` calls \`${name}\` once, when the module is imported, and passes its result: \`${name}\` ${why}, so FastAPI never gets a function to call per request.`,
        fix: {
          summary: `Pass the function: \`Depends(${name})\`.`,
          steps: [
            `Remove the parentheses: \`Depends(${name})\` hands FastAPI the function, which it calls for each request.`,
            `If \`${name}\` needs arguments, don't call it here: make it a factory that returns the dependency function, or give the dependency parameters FastAPI resolves itself.`,
          ],
        },
      }),
    ];
  });
}
