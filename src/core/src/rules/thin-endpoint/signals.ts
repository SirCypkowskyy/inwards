/**
 * @file Works out which INW012 signals an endpoint trips (#182, #271): sums
 * the counts of its bodies (its own and the same-module helpers it runs),
 * sorts their calls into session calls, denied calls and calls into
 * `delegate-to`, each through its own body's parameters and file, and
 * returns the message parts and what the fix should say. It reads measured
 * bodies only; finding them is `view.ts`'s job and wording the finding `wording.ts`'s.
 */
import type { Node } from "web-tree-sitter";
import { matchEntry } from "../../config/layer-selector.ts";
import type { LayerSpec } from "../../config/layers.ts";
import { identifierName } from "../../python/nodes.ts";
import type { Qualify } from "../../python/qualify.ts";
import { layerMembership } from "../shared/layer-ownership.ts";
import type { Body, Params } from "./helpers.ts";
import type { Metrics } from "./metrics.ts";
import type { ThinSettings } from "./settings.ts";
import { listed, type Tripped, targetText } from "./wording.ts";

/**
 * Names what a call reaches, qualified: the name of what it calls, or, for a
 * call on a parameter (`place_order(...)`, `service.place(...)`), each of the
 * parameter's types and its dependency with the attributes after it
 * (`shop.application.OrderService.place`). An unannotated parameter reaches nothing known.
 *
 * @param callee - the call's `function` node.
 * @param params - what each parameter stands for.
 * @param qualify - qualifies a name through the file's imports.
 * @returns the qualified names the call may reach.
 */
function callNames(callee: Node, params: Params, qualify: Qualify): readonly string[] {
  const path: string[] = [];
  let root: Node | null = callee;
  while (root?.type === "attribute") {
    const attribute = root.childForFieldName("attribute");
    path.unshift(attribute ? identifierName(attribute) : "");
    root = root.childForFieldName("object");
  }
  const param = root?.type === "identifier" ? params.get(identifierName(root)) : undefined;
  if (param !== undefined) {
    return param.map((type) => [type, ...path].join("."));
  }
  const name = qualify(callee);
  return name === null ? [] : [name];
}

/**
 * Tells whether a qualified name lies in one of the `delegate-to` targets: a
 * layer (by its name) that owns it, or a module prefix or selector that matches it.
 *
 * @param name - a qualified name, e.g. `shop.application.orders.place_order`.
 * @param targets - the `delegate-to` entries.
 * @param layers - the configured layers, innermost first.
 * @returns true when the name is in a target.
 */
function delegated(
  name: string,
  targets: readonly string[],
  layers: readonly LayerSpec[],
): boolean {
  const owner = layerMembership(name, layers)?.layer.name;
  return targets.some((target) =>
    layers.some((layer) => layer.name === target)
      ? owner === target
      : matchEntry(target, name) !== undefined,
  );
}

/**
 * Lists distinct call texts, each once, in source order.
 *
 * @param calls - `call` nodes.
 * @returns their callees as written, e.g. `db.execute`.
 */
function calleeTexts(calls: readonly Node[]): string[] {
  return [...new Set(calls.map((call) => call.childForFieldName("function")?.text ?? ""))].filter(
    (text) => text !== "",
  );
}

/**
 * Describes one count against its limit, when it is over.
 *
 * @param count - how many the endpoint has.
 * @param max - the limit, or false when the signal is off.
 * @param noun - what is counted, plural, e.g. `statements`.
 * @returns e.g. `["14 statements (max 10)"]`, or nothing within the limit.
 */
function over(count: number, max: number | false, noun: string): string[] {
  return max !== false && count > max ? [`${count} ${noun} (max ${max})`] : [];
}

/** What `trip` needs besides the endpoint. */
export interface TripContext {
  readonly settings: ThinSettings;
  readonly layers: readonly LayerSpec[];
  /** Qualifies a name through the imports of the endpoint's file (its helpers share it). */
  readonly qualify: Qualify;
  /** The endpoint's own module, whose layer is never where its database work should go. */
  readonly module: string;
}

/** An endpoint's calls, sorted by what they do. */
interface SortedCalls {
  /** Method calls on a session-like parameter. */
  readonly receivers: Node[];
  /** Calls `deny-calls` names. */
  readonly denied: Node[];
  /** The types and dependencies of the session-like parameters called. */
  readonly sessions: string[];
  /** True when a call reaches a `delegate-to` target. */
  reaches: boolean;
}

/**
 * Sorts an endpoint's calls, its helpers' included, into session calls,
 * denied calls, and whether any reaches `delegate-to`. Each call reads the
 * parameters of the body it is in.
 *
 * @param bodies - the endpoint's body and its helpers'.
 * @param context - the settings, layers and qualifier.
 * @param context.settings - INW012's settings: the denied calls, types and parameters, and `delegate-to`.
 * @param context.layers - the configured layers, which own the `delegate-to` layer names.
 * @param context.qualify - qualifies a name through the file's imports.
 * @returns the sorted calls.
 */
function sortCalls(
  bodies: readonly Body[],
  { settings, layers, qualify }: TripContext,
): SortedCalls {
  const sorted: SortedCalls = { receivers: [], denied: [], sessions: [], reaches: false };
  for (const { call, params } of bodies.flatMap((b) =>
    b.metrics.calls.map((node) => ({ call: node, params: b.params })),
  )) {
    const callee = call.childForFieldName("function");
    const object = callee?.type === "attribute" ? callee.childForFieldName("object") : null;
    const receiver = object?.type === "identifier" ? identifierName(object) : "";
    const types = params.get(receiver) ?? [];
    const names = callee ? callNames(callee, params, qualify) : [];
    if (settings.denyReceiverParams.has(receiver) || types.some(settings.denyReceiverTypes)) {
      sorted.receivers.push(call);
      sorted.sessions.push(...types);
    } else if (names.some(settings.denyCalls)) {
      sorted.denied.push(call);
    }
    sorted.reaches ||= names.some((name) => delegated(name, settings.delegateTo ?? [], layers));
  }
  return sorted;
}

/**
 * Adds up the counts of an endpoint's bodies: statements, branches, loops
 * and comprehensions are summed, and nesting is the deepest of any one body.
 *
 * @param bodies - the endpoint's body and its helpers'.
 * @returns the counts the limits are checked against, for all the bodies together.
 */
function totals(bodies: readonly Body[]): Omit<Metrics, "calls" | "lines"> {
  const sum = { statements: 0, branches: 0, nesting: 0, loops: 0, comprehensions: 0 };
  for (const { metrics } of bodies) {
    sum.statements += metrics.statements;
    sum.branches += metrics.branches;
    sum.nesting = Math.max(sum.nesting, metrics.nesting);
    sum.loops += metrics.loops;
    sum.comprehensions += metrics.comprehensions;
  }
  return sum;
}

/**
 * Works out which signals one endpoint trips, its helpers counted in.
 *
 * @param bodies - the endpoint's own body first, then its helpers'.
 * @param context - the settings, layers, qualifier and the endpoint's module.
 * @returns the message parts and what the fix should say.
 */
export function trip(bodies: readonly Body[], context: TripContext): Tripped {
  const { settings, layers } = context;
  const metrics = totals(bodies);
  const loops = metrics.loops + (settings.allowComprehensions ? 0 : metrics.comprehensions);
  const sized = [
    ...over(metrics.statements, settings.maxStatements, "statements"),
    ...over(metrics.branches, settings.maxBranches, "branches"),
    ...over(metrics.nesting, settings.maxNesting, "levels of nested blocks"),
    ...(settings.allowLoops || loops === 0
      ? []
      : [`${loops} ${loops === 1 ? "loop" : "loops"} over data`]),
  ];
  const sorted = sortCalls(bodies, context);
  const direct = calleeTexts(
    [...sorted.receivers, ...sorted.denied].sort((a, b) => a.startIndex - b.startIndex),
  );
  const undelegated = settings.delegateTo !== undefined && !sorted.reaches;
  const [only] = direct;
  const calls =
    direct.length === 1 ? `a direct call to \`${only}\`` : `direct calls (${listed(direct)})`;
  const parts = [
    ...sized,
    ...(direct.length === 0 ? [] : [calls]),
    ...(undelegated
      ? [`no call into ${targetText(settings.delegateTo ?? [], layers, context.module)}`]
      : []),
  ];
  const own = layerMembership(context.module, layers)?.layer.name;
  const sessionLayer = sorted.sessions
    .map((name) => layerMembership(name, layers)?.layer.name)
    .find((name) => name !== undefined && name !== own);
  return {
    parts,
    logic: sized.length > 0,
    receivers: calleeTexts(sorted.receivers),
    sessionLayer,
    denied: calleeTexts(sorted.denied),
    undelegated,
  };
}
