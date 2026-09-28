/**
 * @file What a path operation's OpenAPI entry gets from above it: the
 * `responses=` keys, `tags=`, `include_in_schema=` and `dependencies=` of the
 * router or app it is declared on, of each `include_router` on the way to an
 * app, and of the app. Also reads a `responses=` value into the keys it
 * declares. FAPI001 and FAPI002 read these; neither reports anything here.
 *
 * Every answer is "unknown" (null) as soon as one part isn't a literal Inwards
 * can read, and the rules stay quiet then: a missed finding beats a wrong one.
 * Where several inclusions lead to one router, a code declared on any of them
 * counts, for the same reason.
 */
import type { FastApiProject } from "./project.ts";
import type { FastApiObject } from "./records.ts";
import { statusCode } from "./status.ts";
import type { Argument, CallSyntax, Value } from "./values.ts";

/** What sits above a path operation. */
export interface Placement {
  /** The response keys declared above it (`"404"`, `"4XX"`, `"DEFAULT"`), or null when some are unknown. */
  readonly responses: ReadonlySet<string> | null;
  /** True when `tags=` is given on some path above it, null when that is unknown. */
  readonly tagged: boolean | null;
  /** True when every path above it leaves it out of the schema, or one can't be read. */
  readonly hidden: boolean;
  /** The `dependencies=` entries above it, as written. */
  readonly dependencies: readonly Value[];
}

/** How many `**NAME` or `NAME` levels `responseKeys` follows. */
const MAX_NESTING = 4;

const EMPTY: ReadonlySet<string> = new Set();

/**
 * Reads the keys a `responses=` value declares: int and str keys, status
 * constants, and `**NAME` or `NAME` bound to a dict at module level.
 *
 * @param value - the value, or undefined when the keyword isn't given.
 * @param scope - resolves constants.
 * @param depth - how many names were followed to get here.
 * @returns the keys, upper-cased (`"404"`, `"4XX"`, `"DEFAULT"`), or null when unknown.
 */
function responseKeys(
  value: Value | undefined,
  scope: FastApiProject,
  depth = 0,
): ReadonlySet<string> | null {
  if (value === undefined) {
    return EMPTY;
  }
  const inner = value.kind === "name" && depth < MAX_NESTING ? scope.constant(value.name) : null;
  if (inner !== null) {
    return responseKeys(inner, scope, depth + 1);
  }
  if (value.kind !== "dict") {
    return null;
  }
  const keys = value.entries.map(([key]) => {
    const code =
      key.kind === "str" ? key.value.toUpperCase() : statusCode(key, (n) => scope.constant(n));
    return code === null ? null : new Set([String(code)]);
  });
  const spreads = value.spread.map((spread) =>
    spread.kind === "name" ? responseKeys(spread, scope, depth + 1) : null,
  );
  return union([...keys, ...spreads]);
}

/**
 * Reads the response keys a call declares itself: `responses=`, and
 * `openapi_extra={"responses": {...}}` on a path operation.
 *
 * @param call - the decorator, constructor or `include_router` call.
 * @param scope - resolves constants.
 * @returns the keys, or null when a `**kwargs` or a non-literal hides some.
 */
export function declaredBy(call: CallSyntax, scope: FastApiProject): ReadonlySet<string> | null {
  if (call.splat) {
    return null;
  }
  const own = responseKeys(call.keywords.get("responses")?.value, scope);
  const extra = call.keywords.get("openapi_extra")?.value;
  if (extra === undefined || own === null) {
    return own;
  }
  const entry =
    extra.kind === "dict" && extra.spread.length === 0
      ? extra.entries.find(([key]) => key.kind === "str" && key.value === "responses")
      : undefined;
  const more =
    extra.kind === "dict" && extra.spread.length === 0 ? responseKeys(entry?.[1], scope) : null;
  return more === null ? null : new Set([...own, ...more]);
}

/**
 * Tells whether a call leaves what it declares out of the schema.
 *
 * @param call - a decorator, constructor or `include_router` call.
 * @returns true unless `include_in_schema=` is absent or a literal `True`;
 *   also true when a `**kwargs` may set it, since that is unknown.
 */
export function hiddenBy(call: CallSyntax): boolean {
  const value = call.keywords.get("include_in_schema")?.value;
  return call.splat || (value !== undefined && !(value.kind === "bool" && value.value));
}

/**
 * Reads what sits above the path operations of an app or router: its own
 * keywords and, for a router, every inclusion that leads to it and what sits
 * above that. A router nothing includes gets its own keywords only.
 *
 * @param object - the app or router the operation is declared on.
 * @param scope - the project lookups (the inclusions come from there).
 * @param seen - the routers already on this path, which ends an inclusion cycle.
 * @returns the response keys, tags, visibility and dependencies above the operations.
 */
export function placementOf(
  object: FastApiObject,
  scope: FastApiProject,
  seen: ReadonlySet<string> = new Set(),
): Placement {
  const own = ownPlacement(object, scope);
  const edges = object.kind === "router" ? scope.edgesTo(object.name) : [];
  if (edges === null) {
    return { ...own, responses: null, tagged: own.tagged === true ? true : null };
  }
  if (edges.length === 0 || seen.has(object.name)) {
    return own;
  }
  const paths = edges.map(({ wiring, parent }): Placement => {
    const above = parent === null ? null : scope.objectOf(parent);
    const upper = above
      ? placementOf(above, scope, new Set([...seen, object.name]))
      : { responses: null, tagged: null, hidden: false, dependencies: [] };
    const edge = declaredBy(wiring, scope);
    return {
      responses: edge && upper.responses ? new Set([...edge, ...upper.responses]) : null,
      tagged: wiring.keywords.has("tags") || upper.tagged,
      hidden: hiddenBy(wiring) || upper.hidden,
      dependencies: [...dependenciesOf(wiring.keywords.get("dependencies")), ...upper.dependencies],
    };
  });
  return {
    responses: union([own.responses, ...paths.map((p) => p.responses)]),
    tagged:
      own.tagged === true || paths.some((p) => p.tagged === true)
        ? true
        : own.tagged && anyUnknown(paths),
    hidden: own.hidden || paths.every((p) => p.hidden),
    dependencies: [...own.dependencies, ...paths.flatMap((p) => p.dependencies)],
  };
}

/**
 * Reads what an app or router declares itself, without the inclusions above it.
 *
 * @param object - the app or router.
 * @param scope - resolves constants.
 * @returns its own response keys, tags, visibility and dependencies.
 */
export function ownPlacement(object: FastApiObject, scope: FastApiProject): Placement {
  return {
    responses: declaredBy(object, scope),
    tagged: object.splat ? null : object.keywords.has("tags"),
    hidden: hiddenBy(object),
    dependencies: dependenciesOf(object.keywords.get("dependencies")),
  };
}

/**
 * Joins key sets, unknown when any is.
 *
 * @param sets - key sets, null where unknown.
 * @returns their union, or null.
 */
function union(sets: readonly (ReadonlySet<string> | null)[]): ReadonlySet<string> | null {
  const all = new Set<string>();
  for (const set of sets) {
    if (set === null) {
      return null;
    }
    for (const key of set) {
      all.add(key);
    }
  }
  return all;
}

/**
 * Says whether tags are unknown on some path, once none is known to have them.
 *
 * @param paths - the inclusion paths.
 * @returns null when some path's tags are unknown, else false.
 */
function anyUnknown(paths: readonly Placement[]): false | null {
  return paths.some((p) => p.tagged === null) ? null : false;
}

/**
 * Lists the entries of a `dependencies=[...]` keyword.
 *
 * @param argument - the keyword argument, if given.
 * @returns the list's entries, none when it isn't a literal list.
 */
function dependenciesOf(argument: Argument | undefined): readonly Value[] {
  return argument?.value.kind === "list" ? argument.value.items : [];
}
