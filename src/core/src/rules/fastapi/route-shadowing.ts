/**
 * @file FAPI005 `route-shadowing` (#224): FastAPI matches routes in the order
 * they were added and the first match wins, silently. A path operation is
 * reported when every method it serves is already served by an earlier
 * operation whose path matches everything its own path does: `/users/{id}`
 * above `/users/me`, or the same method and path twice. The finding sits on
 * the unreachable operation's decorator and names the earlier one.
 *
 * One router in one file needs no graph, which is all the per-edit check
 * asks for (`checkFileShadowing`). The whole-project check compares full
 * paths across the routers an app includes (`checkGraphShadowing`). Unknown
 * means silent: a path, method list or prefix that isn't a literal, a
 * `**kwargs`, a converter Inwards doesn't know, a router whose routes sit in
 * several files, and an operation that is reachable through some other
 * inclusion all keep an operation from being reported.
 */
import type { Diagnostic, SourceFile } from "../../contracts/records.ts";
import { diagnostic, RULES } from "../../meta/registry.ts";
import { covers } from "./path-match.ts";
import type { FastApiProject } from "./project.ts";
import type { FastApiFile, PathOperation } from "./records.ts";
import { fileRoutes, graphRoutes, type Route } from "./route-list.ts";
import { decoratorSpan, decoratorText } from "./syntax.ts";

/** Why an operation can't be reached. */
interface Cover {
  /** The earliest route that answers all of its methods. */
  readonly by: Route;
  /** True when `by` answers exactly the same requests: a repeat, not a shadow. */
  readonly duplicate: boolean;
}

/** An operation that cannot be reached, with the route that comes first. */
interface Shadowed {
  readonly route: Route;
  readonly cover: Cover;
}

/** How often an operation appears in the lists, and how often it is covered. */
interface Tally {
  readonly route: Route;
  cover: Cover | null;
  seen: number;
  covered: number;
}

/**
 * Finds the earlier route that answers every method of the route at `at`.
 *
 * @param list - the routes in the order the router or app holds them.
 * @param at - the index of the route to check.
 * @returns the earliest covering route, or null when some method can still reach it.
 */
function coverOf(list: readonly Route[], at: number): Cover | null {
  const route = list[at];
  if (route === undefined || route.segments === null || !route.ordered) {
    return null;
  }
  const { segments, methods } = route;
  if (methods === null || methods.length === 0) {
    return null;
  }
  const earlier = list.slice(0, at).filter((r) => r.ordered && r.op !== route.op);
  const firsts = methods.map((method) =>
    earlier.findIndex(
      (r) => r.segments !== null && r.methods?.includes(method) && covers(r.segments, segments),
    ),
  );
  const by = firsts.includes(-1) ? undefined : earlier[Math.min(...firsts)];
  if (by === undefined || by.segments === null) {
    return null;
  }
  return { by, duplicate: by.methods?.length === methods.length && covers(segments, by.segments) };
}

/**
 * Picks the operations that no route list lets through, once each. An
 * operation that appears in several lists (a router two apps include, or one
 * app includes twice) counts only when every appearance is covered.
 *
 * @param lists - route lists, each in the order its router or app holds them.
 * @returns the unreachable operations, in list order.
 */
function unreachable(lists: readonly (readonly Route[])[]): Shadowed[] {
  const tally = new Map<PathOperation, Tally>();
  for (const list of lists) {
    for (const [at, route] of list.entries()) {
      const entry = tally.get(route.op) ?? { route, cover: null, seen: 0, covered: 0 };
      const cover = coverOf(list, at);
      entry.seen += 1;
      entry.covered += cover === null ? 0 : 1;
      entry.cover ??= cover;
      tally.set(route.op, entry);
    }
  }
  return [...tally.values()].flatMap(({ route, cover, seen, covered }) =>
    cover !== null && seen === covered ? [{ route, cover }] : [],
  );
}

/**
 * Spells a route for a message: `GET /users/{id}`.
 *
 * @param route - the route to describe, with its methods and full path.
 * @returns the methods and the full path, as far as they are known.
 */
function spell(route: Route): string {
  const methods = (route.methods ?? []).map((m) => m.toUpperCase()).join(", ");
  return `${methods} ${route.path ?? ""}`.trim();
}

/**
 * Builds the finding for one unreachable operation.
 *
 * @param shadowed - the operation and what comes first.
 * @param shadowed.route - the unreachable route.
 * @param shadowed.cover - the earlier route that answers it.
 * @param src - the file the operation is in.
 * @returns the diagnostic, on the decorator.
 */
function report({ route, cover }: Shadowed, src: SourceFile): Diagnostic {
  const { by } = cover;
  const mine = `\`${decoratorText(route.op)}\` (${spell(route)})`;
  const other = `\`${decoratorText(by.op)}\` (${spell(by)})`;
  const first = `${other} at ${by.file.path}:${decoratorSpan(by.op).line}`;
  const message = cover.duplicate
    ? `${mine} repeats ${first}: FastAPI matches routes in the order they were added and keeps the first, so this one never runs.`
    : `${mine} can never be reached: ${first} comes first and matches the same requests, so FastAPI always picks that one.`;
  return diagnostic(RULES.FAPI005, src, {
    span: decoratorSpan(route.op),
    message,
    fix: {
      summary: cover.duplicate
        ? "Remove the repeated route or give it its own path or method."
        : "Declare the specific route before the one with the path parameter.",
      steps: cover.duplicate
        ? [
            `Both routes answer ${spell(route)}, and only the first one runs. Decide which one is meant.`,
            "Give this one a different path or method. If it is a stale copy, tell the user and delete it: don't delete the first one, which is the one clients reach today.",
          ]
        : [
            `Move ${mine} above ${other}, so the specific path is matched first.`,
            "If they are on different routers, include the router with the specific route first: the order of the include_router calls decides.",
            "Don't delete either route to make this finding go away.",
          ],
    },
  });
}

/**
 * Checks one file's operations against the ones above them on the same
 * router, which needs no other file.
 *
 * @param file - the file's FastAPI records.
 * @param src - the file, for the diagnostics.
 * @param scope - this check's FastAPI lookups.
 * @returns the file's findings, in source order.
 */
export function checkFileShadowing(
  file: FastApiFile,
  src: SourceFile,
  scope: FastApiProject,
): Diagnostic[] {
  return unreachable(fileRoutes(file, scope)).map((found) => report(found, src));
}

/**
 * Checks the whole project: every operation the checked files hold against
 * the routes before it in each app that includes it, with the full paths.
 *
 * @param scope - this check's FastAPI lookups.
 * @param checked - the checked files, by path.
 * @returns the findings in the checked files.
 */
export function checkGraphShadowing(
  scope: FastApiProject,
  checked: ReadonlyMap<string, SourceFile>,
): Diagnostic[] {
  return unreachable(graphRoutes(scope)).flatMap((found) => {
    const src = checked.get(found.route.file.path);
    return src === undefined ? [] : [report(found, src)];
  });
}
