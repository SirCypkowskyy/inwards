/**
 * @file Reads the path a route decorator or registration spells, for
 * INW012's health-check exemption (#360): `@router.get("/healthz")`,
 * `add_api_route("/healthz", probe)`, `Route("/health", health)`. It reads a
 * literal string only; a path built at run time reads as none.
 */
import type { Node } from "web-tree-sitter";
import { argumentAt, literalString } from "../../python/literals.ts";

/**
 * Reads the path a route decorator or registration spells as a literal:
 * its first positional argument, or `path=`.
 *
 * @param expression - the decorator's expression or the registration call.
 * @returns the path, e.g. `/healthz`, or null when it isn't a literal string.
 */
export function routeOf(expression: Node): string | null {
  return expression.type === "call" ? literalString(argumentAt(expression, 0, "path")) : null;
}

/**
 * Turns a path that may be missing into the optional `route` field of an endpoint record.
 *
 * @param route - the path, if known.
 * @returns `{ route }`, or an empty object when it isn't known.
 */
export function routeField(route: string | null | undefined): { route?: string } {
  return route === null || route === undefined ? {} : { route };
}
