/**
 * @file FAPI008 `duplicate-operation-id` (#227): two path operations one app
 * serves with the same explicit `operation_id`. OpenAPI requires the ids to
 * be unique, generated clients get two methods with one name, and FastAPI
 * only warns when it builds the schema, at runtime.
 *
 * Every app's routes come from the app and router graph (`routes.ts`), in the
 * order the app serves them; the first route with an id keeps it and each
 * later one is reported. Only a string literal `operation_id=` counts: an id
 * FastAPI generates, with its default or with a `generate_unique_id_function`,
 * is never read, and an id that isn't a literal is skipped. Routes left out
 * of the schema (`include_in_schema=False` on the route, its router or an
 * inclusion) don't count. Different apps have different schemas, so they
 * never clash. Nothing here reads a file or resolves a name.
 */
import type { Diagnostic, SourceFile } from "../../contracts/records.ts";
import { diagnostic, RULES, type RuleMeta } from "../../meta/registry.ts";
import type { PathOperation } from "./records.ts";
import type { Route } from "./routes.ts";
import { decoratorSpan } from "./syntax.ts";

const RULE: RuleMeta = RULES.FAPI008;

/**
 * Reports each route whose `operation_id` an earlier route of the same app
 * already has. A route is reported once, for the first app where it clashes,
 * and never against its own copy (a router included twice).
 *
 * @param routes - each app's routes in match order (`appRoutes`).
 * @param checked - the checked files, by path; only routes in them are reported.
 * @returns the findings.
 */
export function checkOperationIds(
  routes: ReadonlyMap<string, readonly Route[]>,
  checked: ReadonlyMap<string, SourceFile>,
): Diagnostic[] {
  const found: Diagnostic[] = [];
  const done = new Set<PathOperation>();
  for (const [app, list] of routes) {
    const first = new Map<string, Route>();
    for (const route of list) {
      const id = idOf(route);
      const earlier = id === null ? undefined : first.get(id);
      const src = checked.get(route.file.path);
      if (id !== null && earlier === undefined) {
        first.set(id, route);
      } else if (id !== null && earlier && src && earlier.op !== route.op && !done.has(route.op)) {
        done.add(route.op);
        found.push(finding({ route, earlier, id, app }, src));
      }
    }
  }
  return found;
}

/**
 * Reads the id a route has in the schema, when Inwards can know it.
 *
 * @param route - one of an app's routes.
 * @returns its literal `operation_id`, or null when it has none, it isn't a
 *   literal, or the route is left out of the schema.
 */
function idOf(route: Route): string | null {
  const id = route.op.keywords.get("operation_id")?.value;
  return !route.hidden && id?.kind === "str" ? id.value : null;
}

/**
 * Builds the finding on the later route.
 *
 * @param clash - the two routes, the id and the app.
 * @param clash.route - the later route, reported.
 * @param clash.earlier - the route that has the id first.
 * @param clash.id - the `operation_id`.
 * @param clash.app - the app's qualified name.
 * @param src - the later route's file.
 * @returns the diagnostic, on the later route's decorator.
 */
function finding(
  { route, earlier, id, app }: { route: Route; earlier: Route; id: string; app: string },
  src: SourceFile,
): Diagnostic {
  const at = `${earlier.file.path}:${earlier.op.node.startPosition.row + 1}`;
  return diagnostic(RULE, src, {
    span: decoratorSpan(route.op),
    message: `\`${route.op.name}\` has operation_id "${id}", which \`${earlier.op.name}\` already has in the app \`${app}\`. OpenAPI needs each id once, and a generated client gets two methods with one name.`,
    fix: {
      summary: `Give \`${route.op.name}\` an operation_id of its own; \`${earlier.op.name}\` (${at}) keeps "${id}".`,
      steps: [
        "Rename the id that fits its endpoint worse, and update the client code or tests that call it by that name.",
      ],
    },
  });
}
