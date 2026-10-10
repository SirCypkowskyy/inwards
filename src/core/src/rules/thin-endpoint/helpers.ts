/**
 * @file Follows the helpers an INW012 endpoint calls in its own module (#271),
 * so moving the body into `_create_order_impl` doesn't hide it: a call by
 * bare name to a module-level function adds that function's body to the
 * endpoint's, and so on up to `MAX_DEPTH` calls deep. Each function counts
 * once per endpoint, which also ends recursion. Another endpoint, a
 * `Depends(...)` target (never called, only named), a nested function and an
 * imported function are not followed. A helper's parameters read their own
 * annotations first and otherwise take the types of the caller's parameter
 * passed to them. It reads one file's syntax; the caller measures bodies.
 */
import type { Node } from "web-tree-sitter";
import { argumentAt } from "../../python/literals.ts";
import { identifierName } from "../../python/nodes.ts";
import type { Metrics } from "./metrics.ts";

/** How many calls deep helpers are followed: the ones the endpoint calls, theirs, and theirs. */
const MAX_DEPTH = 3;

/** What each parameter of a function stands for, by name. */
export type Params = ReadonlyMap<string, readonly string[]>;

/** One function body INW012 counts for an endpoint: the endpoint's own, or a helper's. */
export interface Body {
  /** The `function_definition` node. */
  readonly fn: Node;
  /** The function's name. */
  readonly name: string;
  readonly metrics: Metrics;
  /** What each parameter stands for, as the call that reached it passed them. */
  readonly params: Params;
}

/** What following helpers needs from the module. */
export interface HelperScope {
  /** The module's top-level functions by name. */
  readonly functions: ReadonlyMap<string, Node>;
  /** Where each endpoint function of the module starts; these are never followed. */
  readonly endpoints: ReadonlySet<number>;
  /** Measures a function's body (cached by the caller). */
  readonly measure: (fn: Node) => Metrics;
  /** Reads what a function's parameters stand for from its own annotations. */
  readonly paramsOf: (fn: Node) => Params;
}

/**
 * Gives a helper's parameters the types of what the call passes to them,
 * where its own annotations say nothing: `_load(db, 1)` makes the helper's
 * first parameter whatever the caller's `db` is.
 *
 * @param call - the call that reaches the helper.
 * @param own - the helper's parameters from its own annotations, in order.
 * @param caller - the caller's parameters.
 * @returns the helper's parameters.
 */
function passed(call: Node, own: Params, caller: Params): Params {
  const params = new Map(own);
  [...own].forEach(([name, types], index) => {
    const arg = types.length === 0 ? argumentAt(call, index, name) : null;
    const from = arg?.type === "identifier" ? caller.get(identifierName(arg)) : undefined;
    if (from !== undefined && from.length > 0) {
      params.set(name, from);
    }
  });
  return params;
}

/**
 * Finds the helper one call reaches: a module-level function called by bare
 * name that isn't an endpoint, isn't shadowed by the caller's parameter and
 * hasn't been counted yet.
 *
 * @param call - a `call` node in the caller's body.
 * @param caller - the body that makes the call.
 * @param scope - the module's functions and endpoints.
 * @param seen - where the functions counted so far start.
 * @returns the helper's function node and name, or null.
 */
function helperAt(
  call: Node,
  caller: Body,
  scope: HelperScope,
  seen: ReadonlySet<number>,
): { fn: Node; name: string } | null {
  const callee = call.childForFieldName("function");
  const name = callee?.type === "identifier" ? identifierName(callee) : "";
  const fn = caller.params.has(name) ? undefined : scope.functions.get(name);
  return fn && !seen.has(fn.startIndex) && !scope.endpoints.has(fn.startIndex)
    ? { fn, name }
    : null;
}

/**
 * Lists the helpers an endpoint runs in its own module, breadth first up to
 * `MAX_DEPTH` calls deep, each once.
 *
 * @param endpoint - the endpoint's own body.
 * @param scope - the module's functions, endpoints, measures and parameter reader.
 * @returns the helpers' bodies, in source order.
 */
export function helpersOf(endpoint: Body, scope: HelperScope): Body[] {
  const seen = new Set<number>([endpoint.fn.startIndex]);
  const found: Body[] = [];
  let level: Body[] = [endpoint];
  for (let depth = 0; depth < MAX_DEPTH && level.length > 0; depth += 1) {
    const next: Body[] = [];
    for (const caller of level) {
      for (const call of caller.metrics.calls) {
        const helper = helperAt(call, caller, scope, seen);
        if (helper) {
          seen.add(helper.fn.startIndex);
          const params = passed(call, scope.paramsOf(helper.fn), caller.params);
          next.push({ ...helper, metrics: scope.measure(helper.fn), params });
        }
      }
    }
    found.push(...next);
    level = next;
  }
  return found.sort((a, b) => a.fn.startIndex - b.fn.startIndex);
}
