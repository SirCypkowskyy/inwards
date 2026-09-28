/**
 * @file FAPI005 `route-shadowing` (#224): a path operation that can never
 * match, because a route declared before it with the same method matches
 * every request it would (`/users/{user_id}` before `/users/me`), or has the
 * same method and path. FastAPI tries routes in order and takes the first
 * match, without a warning.
 *
 * Two checks: routes declared on one app or router in one file, compared on
 * their own paths, which is all the per-edit hook asks for; and every app's
 * routes compared on their full paths (`routes.ts`), which needs the app and
 * router graph. A route whose path or some prefix above it isn't a string
 * literal, or whose `methods=` isn't a literal list, is skipped. Nothing
 * here reads a file or resolves a name.
 */
import type { Diagnostic, SourceFile } from "../../contracts/records.ts";
import { diagnostic, RULES, type RuleMeta } from "../../meta/registry.ts";
import type { FastApiFile, PathOperation } from "./records.ts";
import type { Route } from "./routes.ts";
import { decoratorSpan } from "./syntax.ts";

const RULE: RuleMeta = RULES.FAPI005;

/** A whole `{name}` or `{name:convertor}` path segment. */
const PARAM = /^\{[^{}:]+(?::(?<convertor>\w+))?\}$/u;

/** A path segment of digits only, which `{name:int}` matches. */
const DIGITS = /^\d+$/u;

/** A route as the checks compare it: the operation, its file, and the path it is matched on. */
interface Candidate {
  readonly op: PathOperation;
  readonly file: FastApiFile;
  readonly path: string;
  readonly methods: readonly string[];
}

/** An earlier route that takes a later one's requests, and the methods they share. */
interface Shadow {
  readonly earlier: Candidate;
  readonly methods: readonly string[];
  /** True when the two paths match exactly the same requests. */
  readonly duplicate: boolean;
}

/**
 * Checks the routes of each app or router in one file on their own paths:
 * the prefix above them is the same for all, so this needs no other file.
 *
 * @param file - the file's FastAPI records.
 * @param src - the file, for the diagnostics.
 * @returns one finding per route an earlier one on the same receiver shadows, in source order.
 */
export function checkFileShadowing(file: FastApiFile, src: SourceFile): Diagnostic[] {
  const ops = [...file.operations].sort(
    (a, b) => a.node.startPosition.row - b.node.startPosition.row,
  );
  const seen = new Map<string, Candidate[]>();
  const found: Diagnostic[] = [];
  for (const op of ops) {
    const later = candidate({ op, file, path: op.path?.kind === "str" ? op.path.value : null });
    const before = seen.get(op.receiver) ?? [];
    const shadow = later && firstShadow(before, later);
    if (later && shadow) {
      found.push(finding(later, shadow, src, "file"));
    }
    if (later) {
      seen.set(op.receiver, [...before, later]);
    }
  }
  return found;
}

/**
 * Checks every app's routes on their full paths, across routers and files.
 * A pair on one receiver in one file is `checkFileShadowing`'s, and each
 * route is reported once, for the first route that shadows it.
 *
 * @param routes - each app's routes in match order (`appRoutes`).
 * @param checked - the checked files, by path; only routes in them are reported.
 * @returns the findings.
 */
export function checkGraphShadowing(
  routes: ReadonlyMap<string, readonly Route[]>,
  checked: ReadonlyMap<string, SourceFile>,
): Diagnostic[] {
  const found: Diagnostic[] = [];
  const done = new Set<PathOperation>();
  for (const list of routes.values()) {
    // ponytail: every checked route against every earlier one, O(n^2) per app; fine for hundreds of routes.
    const seen: Candidate[] = [];
    for (const route of list) {
      const later = candidate(route);
      const src = checked.get(route.file.path);
      const shadow =
        later && src && !done.has(route.op)
          ? firstShadow(
              seen.filter((c) => c.op !== route.op),
              later,
            )
          : null;
      const oneFile =
        shadow?.earlier.op.receiver === route.op.receiver &&
        shadow.earlier.file.path === route.file.path;
      if (later && src && shadow && !oneFile) {
        done.add(route.op);
        found.push(finding(later, shadow, src, "graph"));
      }
      if (later) {
        seen.push(later);
      }
    }
  }
  return found;
}

/**
 * Makes a route comparable: it needs a literal path and literal methods.
 *
 * @param route - the operation, its file and its path.
 * @param route.op - the path operation.
 * @param route.file - the file that declares it.
 * @param route.path - the path it is matched on, or null when unknown.
 * @returns the candidate, or null when the route can't be compared.
 */
function candidate({
  op,
  file,
  path,
}: {
  op: PathOperation;
  file: FastApiFile;
  path: string | null;
}): Candidate | null {
  return path === null || op.methods === "unknown" ? null : { op, file, path, methods: op.methods };
}

/**
 * Finds the first earlier route that takes some of a later route's requests.
 *
 * @param earlier - the routes before it, in match order.
 * @param later - the route.
 * @returns the shadow, or null when every earlier route leaves it reachable.
 */
function firstShadow(earlier: readonly Candidate[], later: Candidate): Shadow | null {
  for (const e of earlier) {
    // A GET route answers HEAD too.
    const served = e.methods.includes("get") ? [...e.methods, "head"] : e.methods;
    const methods = later.methods.filter((m) => served.includes(m));
    if (methods.length > 0 && covers(e.path, later.path)) {
      return { earlier: e, methods, duplicate: covers(later.path, e.path) };
    }
  }
  return null;
}

/**
 * Tells whether every request path one route matches, another matches too.
 * Segment by segment: a literal matches itself, `{x}` any one non-empty
 * segment, `{x:int}` digits, and another convertor only itself. A path with a
 * `:path` parameter, or a segment that mixes text and a parameter, is only
 * compared for being the same path.
 *
 * @param wide - the earlier route's path.
 * @param narrow - the later route's path.
 * @returns true when `wide` matches everything `narrow` does.
 */
function covers(wide: string, narrow: string): boolean {
  const a = normalise(wide).split("/");
  const b = normalise(narrow).split("/");
  if (a.join("/") === b.join("/")) {
    return true;
  }
  if (a.length !== b.length || [...a, ...b].some((s) => s === "{:path}")) {
    return false;
  }
  return a.every((s, i) => segmentCovers(s, b[i] ?? ""));
}

/**
 * Tells whether one path segment matches everything another does.
 *
 * @param wide - a segment of the earlier path, normalised.
 * @param narrow - the same segment of the later path, normalised.
 * @returns true when `wide` matches every value `narrow` does.
 */
function segmentCovers(wide: string, narrow: string): boolean {
  if (wide === narrow || (wide === "{:str}" && narrow !== "")) {
    return true;
  }
  return wide === "{:int}" && DIGITS.test(narrow);
}

/**
 * Drops parameter names, which don't change what a path matches:
 * `{user_id}` and `{id:str}` both become `{:str}`.
 *
 * @param path - a route path.
 * @returns the path with each whole parameter segment reduced to its convertor.
 */
function normalise(path: string): string {
  return path
    .split("/")
    .map((s) => {
      const match = PARAM.exec(s);
      return match ? `{:${match.groups?.["convertor"] ?? "str"}}` : s;
    })
    .join("/");
}

/**
 * Builds the finding on the route that never runs.
 *
 * @param later - the route that never runs.
 * @param shadow - the earlier route that takes its requests.
 * @param src - the later route's file.
 * @param scope - `file` when both are on one receiver in one file, `graph` when they meet in an app.
 * @returns the diagnostic, on the later route's decorator.
 */
function finding(
  later: Candidate,
  shadow: Shadow,
  src: SourceFile,
  scope: "file" | "graph",
): Diagnostic {
  const { earlier, duplicate } = shadow;
  const methods = shadow.methods.map((m) => m.toUpperCase()).join(", ");
  const at = `${earlier.file.path}:${earlier.op.node.startPosition.row + 1}`;
  const reason = duplicate
    ? `\`${earlier.op.name}\` declares the same method and path before it`
    : `\`${earlier.op.name}\` (${methods} ${earlier.path}) comes before it and matches the same requests`;
  let summary = `Move \`${later.op.name}\` above \`${earlier.op.name}\` (${at}), so the more specific path is tried first.`;
  if (duplicate) {
    summary = `Keep one of the two routes: \`${earlier.op.name}\` (${at}) already serves ${methods} ${earlier.path}.`;
  } else if (scope === "graph") {
    summary = `Include the router that declares \`${later.op.name}\` before the one that declares \`${earlier.op.name}\` (${at}), or give one of them another path.`;
  }
  return diagnostic(RULE, src, {
    span: decoratorSpan(later.op),
    message: `\`${later.op.name}\` (${methods} ${later.path}) never runs: ${reason}, and FastAPI uses the first route that matches.`,
    fix: {
      summary,
      steps: [
        duplicate
          ? "If both are needed, give this one another path or method; if it replaces the earlier one, remove the earlier one."
          : "FastAPI tries routes in the order they are declared and included: a literal path such as /users/me must come before a parameter path such as /users/{user_id}.",
      ],
    },
  });
}
