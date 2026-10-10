/**
 * @file INW012 `thin-endpoint` (#182): an HTTP endpoint that holds the
 * feature itself (many statements, branches, loops over data, database or
 * HTTP calls of its own, no call into the layer that should do the work)
 * gets one finding on its `def` line, listing every signal that tripped with
 * its numbers, and fix steps that name where the work goes from
 * `delegate-to` and the layers. A file that mentions no framework and no
 * configured decorator is never parsed. One-file and I/O-free: the caller
 * supplies the parser, the file and the config.
 */
import type { Node, Parser } from "web-tree-sitter";
import { matchEntry } from "../../config/layer-selector.ts";
import type { LayerSpec } from "../../config/layers.ts";
import type { RuleOptions } from "../../config/rule-settings.ts";
import type { Diagnostic, SourceFile } from "../../contracts/records.ts";
import { diagnostic, RULES } from "../../meta/registry.ts";
import { identifierName } from "../../python/nodes.ts";
import { importedNames, parsePython } from "../../python/parser.ts";
import { type Qualify, qualifierFor } from "../../python/qualify.ts";
import { layerMembership } from "../shared/layer-ownership.ts";
import { joined } from "../shared/words.ts";
import { findEndpoints, mayHoldEndpoints } from "./endpoints.ts";
import { type Metrics, measure } from "./metrics.ts";
import { moduleAliases, parameterTypes } from "./parameters.ts";
import { type ThinSettings, thinSettings } from "./settings.ts";
import { fixFor, listed, type Tripped, targetText } from "./wording.ts";

/** What INW012 needs besides the file. */
export interface ThinInputs {
  /** `[tool.inwards.rules.thin-endpoint]`, if set. */
  readonly options: RuleOptions | undefined;
  /** The configured layers, innermost first, for `delegate-to` and the fix steps. */
  readonly layers: readonly LayerSpec[];
}

/**
 * Tells whether a `raise` maps an error to HTTP: it raises `HTTPException`
 * (FastAPI's or Starlette's, by the last part of its qualified name), called or not.
 *
 * @param raise - a `raise_statement` node.
 * @param qualify - qualifies a name through the file's imports.
 * @returns true for `raise HTTPException(404)` and `raise HTTPException(...) from e`.
 */
function raisesHttp(raise: Node, qualify: Qualify): boolean {
  const [raised] = raise.namedChildren;
  const callee = raised?.type === "call" ? raised.childForFieldName("function") : raised;
  const name = callee ? qualify(callee) : null;
  return name?.split(".").at(-1) === "HTTPException";
}

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
function callNames(
  callee: Node,
  params: ReadonlyMap<string, readonly string[]>,
  qualify: Qualify,
): readonly string[] {
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
interface TripContext {
  readonly settings: ThinSettings;
  readonly layers: readonly LayerSpec[];
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
 * Sorts an endpoint's calls into session calls, denied calls, and whether any
 * reaches `delegate-to`.
 *
 * @param calls - the `call` nodes of the body.
 * @param params - what each parameter stands for.
 * @param context - the settings, layers and qualifier.
 * @param context.settings - INW012's settings: the denied calls, types and parameters, and `delegate-to`.
 * @param context.layers - the configured layers, which own the `delegate-to` layer names.
 * @param context.qualify - qualifies a name through the file's imports.
 * @returns the sorted calls.
 */
function sortCalls(
  calls: readonly Node[],
  params: ReadonlyMap<string, readonly string[]>,
  { settings, layers, qualify }: TripContext,
): SortedCalls {
  const sorted: SortedCalls = { receivers: [], denied: [], sessions: [], reaches: false };
  for (const call of calls) {
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
 * Works out which signals one endpoint trips.
 *
 * @param metrics - the endpoint's counts and calls.
 * @param params - what each parameter stands for.
 * @param context - the settings, layers and qualifier.
 * @returns the message parts and what the fix should say.
 */
function trip(
  metrics: Metrics,
  params: ReadonlyMap<string, readonly string[]>,
  context: TripContext,
): Tripped {
  const { settings, layers } = context;
  const loops = metrics.loops + (settings.allowComprehensions ? 0 : metrics.comprehensions);
  const sized = [
    ...over(metrics.statements, settings.maxStatements, "statements"),
    ...over(metrics.branches, settings.maxBranches, "branches"),
    ...over(metrics.nesting, settings.maxNesting, "levels of nested blocks"),
    ...(settings.allowLoops || loops === 0
      ? []
      : [`${loops} ${loops === 1 ? "loop" : "loops"} over data`]),
  ];
  const sorted = sortCalls(metrics.calls, params, context);
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
    ...(undelegated ? [`no call into ${targetText(settings.delegateTo ?? [], layers)}`] : []),
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

/**
 * Checks one file's endpoints against INW012. The caller decides whether the
 * rule is on for the file; this parses only a file that may hold an endpoint.
 *
 * @param parser - parser with the Python grammar loaded.
 * @param src - the file, with normalised text.
 * @param inputs - the rule's options and the layers.
 * @returns one finding per endpoint that trips a signal, before suppressions and severities apply.
 */
export function checkThinEndpoints(
  parser: Parser,
  src: SourceFile,
  inputs: ThinInputs,
): Diagnostic[] {
  const settings = thinSettings(inputs.options);
  if (!mayHoldEndpoints(src.text, settings.decorators)) {
    return [];
  }
  const tree = parsePython(parser, src.text);
  try {
    const root = tree.rootNode;
    const qualify = qualifierFor(importedNames(tree, src), src.module);
    const context = {
      module: src.module,
      qualify,
      text: src.text,
      decorators: settings.decorators,
    };
    const types = { qualify, aliases: moduleAliases(root) };
    const where = targetText(settings.delegateTo ?? [], inputs.layers);
    return findEndpoints(root, context).flatMap((endpoint) => {
      const metrics = measure(endpoint.fn, (raise) => raisesHttp(raise, qualify));
      const params = parameterTypes(endpoint.fn, types);
      const tripped = trip(metrics, params, {
        settings,
        layers: inputs.layers,
        qualify,
        module: src.module,
      });
      if (tripped.parts.length === 0) {
        return [];
      }
      const name = endpoint.fn.childForFieldName("name") ?? endpoint.fn;
      return [
        diagnostic(RULES.INW012, src, {
          span: {
            line: endpoint.fn.startPosition.row + 1,
            column: endpoint.fn.startPosition.column + 1,
            endLine: name.endPosition.row + 1,
            endColumn: name.endPosition.column + 1,
          },
          message: `\`${endpoint.name}\` is an HTTP endpoint with ${joined(tripped.parts)}. Endpoints parse the request, call one use case, and shape the response.`,
          fix: fixFor(endpoint.name, tripped, where, metrics.lines),
        }),
      ];
    });
  } finally {
    tree.delete(); // WASM memory is not garbage collected
  }
}
