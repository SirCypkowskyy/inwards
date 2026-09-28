/**
 * @file FAPI009 `depends-called` (#228): `Depends(get_db())` or
 * `Security(get_user())` calls the dependency once, where the route is
 * declared, and hands FastAPI what it returned instead of a dependency to call
 * per request. Reported when the called name resolves, in the same file or
 * through the index, to a first-party function whose result can't be a
 * dependency: a generator, a coroutine, or only literals and instances of
 * first-party classes without `__call__`.
 *
 * A factory that returns a function (`Depends(require_role("admin"))`), a
 * class, and anything Inwards can't read stay quiet. In a parameter default,
 * Ruff's B008 already reports the inner call, so FAPI009 reads only
 * `Annotated[...]` metadata and other arguments (`dependencies=[...]`) unless
 * `check-defaults` is on.
 */
import type { Node } from "web-tree-sitter";
import type { RuleOptions } from "../../config/rule-settings.ts";
import type { Diagnostic, SourceFile } from "../../contracts/records.ts";
import { diagnostic, RULES } from "../../meta/registry.ts";
import { argumentAt } from "../../python/literals.ts";
import { identifierName, namedChildren } from "../../python/nodes.ts";
import type { Definition } from "./model.ts";
import { flag } from "./options.ts";
import type { FastApiProject } from "./project.ts";
import { scopeNodes, spanOf } from "./syntax.ts";
import type { Qualify } from "./values.ts";

/** The text pre-filter: a file that spells neither has no `Depends(...)` to read. */
const MENTIONS = /Depends|Security/u;

/** The dependency markers, by qualified name. */
const MARKERS: ReadonlySet<string> = new Set([
  "fastapi.Depends",
  "fastapi.Security",
  "fastapi.params.Depends",
  "fastapi.params.Security",
  "fastapi.param_functions.Depends",
  "fastapi.param_functions.Security",
]);

/** Parameters with a default value, whose `value` field B008 reads. */
const DEFAULTS: ReadonlySet<string> = new Set(["default_parameter", "typed_default_parameter"]);

/** Return values that are never callable. */
const LITERALS: ReadonlySet<string> = new Set([
  "string",
  "concatenated_string",
  "integer",
  "float",
  "true",
  "false",
  "none",
  "list",
  "tuple",
  "dictionary",
  "set",
  "list_comprehension",
  "dictionary_comprehension",
  "set_comprehension",
  "generator_expression",
]);

/** What calling a first-party function gives back, when it can't be a dependency. */
type Result = "generator" | "coroutine" | "value";

/**
 * Tells whether a file may pass a called dependency, before any parse.
 *
 * @param text - the file's text.
 * @returns true when it spells `Depends` or `Security`.
 */
export function mentionsDepends(text: string): boolean {
  return MENTIONS.test(text);
}

/**
 * Reports the `Depends(f(...))` and `Security(f(...))` calls of one file.
 *
 * @param src - the file.
 * @param syntax - its module node and name qualifier.
 * @param syntax.root - the module node.
 * @param syntax.qualify - qualifies names in the file.
 * @param scope - the project lookups.
 * @param raw - the rule's options table, if any.
 * @returns one FAPI009 diagnostic per such call.
 */
export function checkDependsCalled(
  src: SourceFile,
  { root, qualify }: { root: Node; qualify: Qualify },
  scope: FastApiProject,
  raw: RuleOptions | undefined,
): Diagnostic[] {
  const defaults = flag(raw, "check-defaults", false);
  return root.descendantsOfType("call").flatMap((marker) => {
    const callee = marker?.childForFieldName("function");
    const name = callee ? qualify(callee) : null;
    if (!marker || name === null || !MARKERS.has(name) || (!defaults && isDefault(marker))) {
      return [];
    }
    const d = calledIn(src, marker, qualify, scope);
    return d ? [d] : [];
  });
}

/**
 * Reports one marker whose argument calls a first-party function that can't
 * give back a dependency.
 *
 * @param src - the file.
 * @param marker - the `Depends(...)` or `Security(...)` call.
 * @param qualify - qualifies names in the file.
 * @param scope - resolves the called name.
 * @returns the diagnostic, or null when the argument isn't such a call.
 */
function calledIn(
  src: SourceFile,
  marker: Node,
  qualify: Qualify,
  scope: FastApiProject,
): Diagnostic | null {
  const inner = argumentAt(marker, 0, "dependency");
  const fn = inner?.type === "call" ? inner.childForFieldName("function") : null;
  const target = fn ? qualify(fn) : null;
  const found = target === null ? null : scope.resolve(target);
  const result = found ? resultOf(found, scope) : null;
  return inner && fn && result ? report(src, marker, { inner, fn, result }) : null;
}

/**
 * Tells whether a marker is a parameter's default value.
 *
 * @param marker - the `Depends(...)` call.
 * @returns true for `db=Depends(...)` in a signature.
 */
function isDefault(marker: Node): boolean {
  const { parent } = marker;
  return (
    parent !== null &&
    DEFAULTS.has(parent.type) &&
    parent.childForFieldName("value")?.id === marker.id
  );
}

/**
 * Tells what calling a first-party function gives back, when that can't be a dependency.
 *
 * @param found - what the called name resolves to.
 * @param scope - resolves the classes a function returns instances of.
 * @returns the kind of result, or null when it may be callable or Inwards can't tell.
 */
function resultOf(found: Definition, scope: FastApiProject): Result | null {
  if (found.kind !== "function") {
    return null;
  }
  const fn = found.node;
  if (scopeNodes(fn, "yield").length > 0) {
    return "generator";
  }
  if (fn.child(0)?.type === "async") {
    return "coroutine";
  }
  const values = scopeNodes(fn, "return_statement").map((r) => namedChildren(r)[0] ?? null);
  const plain = values.every(
    (v) => v === null || LITERALS.has(v.type) || plainInstance(v, found.qualify, scope),
  );
  return plain ? "value" : null;
}

/**
 * Tells whether an expression builds an instance of a first-party class
 * that isn't callable: no `__call__` in it or its first-party bases, and
 * no base Inwards can't see.
 *
 * @param value - a returned expression.
 * @param qualify - qualifies names in the function's file.
 * @param scope - resolves the class.
 * @returns true for such an instance.
 */
function plainInstance(value: Node, qualify: Qualify, scope: FastApiProject): boolean {
  const callee = value.type === "call" ? value.childForFieldName("function") : null;
  const name = callee ? qualify(callee) : null;
  const lineage = name === null ? null : scope.lineage(name);
  return (
    lineage !== null &&
    lineage.external.size === 0 &&
    lineage.classes.every((c) => !methodNames(c.node).includes("__call__"))
  );
}

/**
 * Lists the methods a class defines in its body.
 *
 * @param cls - a `class_definition` node.
 * @returns their names.
 */
function methodNames(cls: Node): string[] {
  const body = cls.childForFieldName("body");
  return (body ? namedChildren(body) : []).flatMap((child) => {
    const fn =
      child.type === "decorated_definition" ? child.childForFieldName("definition") : child;
    const name = fn?.type === "function_definition" ? fn.childForFieldName("name") : null;
    return name ? [identifierName(name)] : [];
  });
}

/**
 * Builds the finding for one marker.
 *
 * @param src - the file.
 * @param marker - the `Depends(...)` call.
 * @param found - what is called and what it gives back.
 * @param found.inner - the call passed to the marker.
 * @param found.fn - that call's callee.
 * @param found.result - what calling it gives back.
 * @returns the diagnostic, on the marker.
 */
function report(
  src: SourceFile,
  marker: Node,
  { inner, fn, result }: { inner: Node; fn: Node; result: Result },
): Diagnostic {
  const markerName = marker.childForFieldName("function")?.text ?? "Depends";
  return diagnostic(RULES.FAPI009, src, {
    span: spanOf(marker),
    message: `\`${markerName}(${inner.text})\` calls \`${fn.text}\` where the route is declared and passes FastAPI the ${result} it returns, which FastAPI can't call as a dependency.`,
    fix: {
      summary: `Pass the function itself: \`${markerName}(${fn.text})\`.`,
      steps: [
        `Replace \`${inner.text}\` with \`${fn.text}\`; FastAPI calls the dependency on each request and fills its parameters itself.`,
        `If \`${fn.text}\` needs arguments, make it a factory that returns the dependency function, or give it parameters FastAPI can fill.`,
      ],
    },
  });
}
