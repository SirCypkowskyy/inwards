/**
 * @file Carries what a caller knows about a name into the function it calls:
 * `_load(db, 1)` gives the callee's first parameter whatever the caller knew
 * about `db`. INW012 passes parameter types into the helpers it counts
 * (#271), and INW013 passes blocking receivers into the sync helpers it
 * follows one hop (#294). Only a bare name passed by position or keyword is
 * carried; an expression, or an argument behind `*args`, is not. It reads
 * one call's syntax; the caller says what each name stands for.
 */
import type { Node } from "web-tree-sitter";
import { argumentAt } from "../../python/literals.ts";
import { identifierName } from "../../python/nodes.ts";

/**
 * Reads what the call passes to each parameter of the callee, where the
 * argument is a name the caller knows.
 *
 * @param call - the `call` node that reaches the callee.
 * @param params - the callee's parameter names, in order.
 * @param known - what the caller knows about one of its names, or undefined.
 * @returns what each parameter receives, by parameter name; a parameter whose
 *   argument is missing, isn't a bare name, or isn't known is left out.
 */
export function passedNames<T>(
  call: Node,
  params: readonly string[],
  known: (name: string) => T | undefined,
): Map<string, T> {
  const passed = new Map<string, T>();
  params.forEach((param, index) => {
    const arg = argumentAt(call, index, param);
    const value = arg?.type === "identifier" ? known(identifierName(arg)) : undefined;
    if (value !== undefined) {
      passed.set(param, value);
    }
  });
  return passed;
}
