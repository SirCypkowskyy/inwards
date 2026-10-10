/**
 * @file Mapping import-linter `layers` contracts onto the Inwards layer list.
 * import-linter lists layers high to low and Inwards innermost first, so the
 * order is reversed; `:` siblings share a layer, `|` siblings become a group of
 * sibling layers (a nested array, ADR-036), and `containers`
 * repeat every layer in each container.
 *
 * Inwards has one layer order per config, so the first layers contract sets it
 * and a later one joins only when it has the same layers in other containers
 * or agrees with the order already set. Pure: no I/O.
 */
import {
  type DraftLayer,
  flag,
  MODULE,
  type Outcome,
  outcome,
  type State,
  sharedReasons,
  wildcardReason,
} from "./model.ts";
import type { LinterContract } from "./read.ts";
import { optionList } from "./read.ts";

/** What one layers contract expands to. */
interface LayerPlan {
  /** The places in the order, innermost first; a `|` line gives one layer per sibling. */
  places: DraftLayer[][];
  /** The layer lines as written, without containers: two contracts with the same shape can share layers. */
  shape: string;
  /** `exhaustive_ignores`, as module names under each container. */
  ignore: string[];
}

/** One layer line, parsed. */
interface LayerLine {
  /** The module names relative to the container, optional parentheses removed. */
  tails: string[];
  /** True for `|` siblings, which may not import each other. */
  independent: boolean;
}

const OPTIONAL = /\([^)]*\)/gu;

/**
 * Converts a `layers` contract, adding its layers, pairs and ignores to the state.
 *
 * @param state - what the conversion has so far; changed in place.
 * @param contract - a contract of type `layers`.
 * @returns its verdict.
 */
export function layersContract(state: State, contract: LinterContract): Outcome {
  const plan = layerPlan(contract);
  if (typeof plan === "string") {
    return outcome(contract, [plan], false);
  }
  const merged = mergeLayers(state, plan);
  if (merged !== undefined) {
    return outcome(contract, [merged], false);
  }
  state.ignore.push(...plan.ignore.filter((m) => !state.ignore.includes(m)));
  return outcome(contract, [...sharedReasons(contract), ...layerReasons(contract)], true);
}

/**
 * Lists what a layers contract loses in Inwards: containers checked against
 * each other, optional layers, and exhaustiveness as a warning.
 *
 * @param contract - a contract of type `layers`.
 * @returns the reasons, possibly none.
 */
function layerReasons(contract: LinterContract): string[] {
  const reasons: string[] = [];
  if ((optionList(contract.options, "containers") ?? []).length > 1) {
    reasons.push(
      "containers: Inwards keeps one layer order for the whole project, so it also reports a lower layer in one container importing a higher layer in another, which import-linter allows.",
    );
  }
  const optional = (optionList(contract.options, "layers") ?? []).join(" ").match(OPTIONAL);
  if (optional !== null) {
    reasons.push(
      `${optional.join(", ")}: Inwards has no optional layers, and a layer prefix that matches no module gets an INW006 warning; delete the prefixes of the containers that lack the layer.`,
    );
  }
  if (flag(contract, "exhaustive")) {
    reasons.push(
      'exhaustive: a module outside every layer gets the INW006 warning rather than failing; set `severity = { INW006 = "error" }` in [tool.inwards.rules] to fail on it.',
    );
  }
  return reasons;
}

/**
 * Adds a layers contract's groups to the layer list.
 *
 * @param state - the layer list so far; changed in place.
 * @param plan - the contract's groups, innermost first.
 * @returns undefined once merged, or why the groups can't join the list.
 */
function mergeLayers(state: State, plan: LayerPlan): string | undefined {
  const groups = plan.places.map((place) => place.flatMap((layer) => layer.modules));
  const seen = groups.flat();
  if (new Set(seen).size !== seen.length) {
    return "a module appears in two of its layers.";
  }
  if (state.layers.length === 0) {
    state.layers.push(...plan.places);
    state.shape = plan.shape;
    return undefined;
  }
  const index = new Map(
    state.layers.flatMap((place, i) => place.flatMap((layer) => layer.modules.map((m) => [m, i]))),
  );
  if (plan.shape === state.shape && seen.every((module) => !index.has(module))) {
    for (const [i, place] of plan.places.entries()) {
      for (const [j, layer] of place.entries()) {
        state.layers[i]?.[j]?.modules.push(...layer.modules);
      }
    }
    return undefined;
  }
  const ordered = groups.every((group, i) => {
    const later = groups.slice(i + 1).flat();
    return group.every((m) => later.every((n) => (index.get(m) ?? -1) < (index.get(n) ?? -1)));
  });
  return ordered && seen.every((module) => index.has(module))
    ? undefined
    : "Inwards keeps one layer order per config, and this contract's layers don't fit the order an earlier layers contract set; combine them by hand, or check each part with its own config.";
}

/**
 * Expands a layers contract into module groups, innermost first.
 *
 * @param contract - a contract of type `layers`.
 * @returns the plan, or why the contract can't be mapped.
 */
function layerPlan(contract: LinterContract): LayerPlan | string {
  const lines = optionList(contract.options, "layers") ?? [];
  if (lines.length === 0) {
    return "it lists no layers.";
  }
  const containers = optionList(contract.options, "containers") ?? [];
  const bad = containers.find((c) => !MODULE.test(c));
  if (bad !== undefined) {
    return wildcardReason("containers", bad);
  }
  const parsed: LayerLine[] = [];
  for (const line of lines) {
    const layer = layerLine(line);
    if (typeof layer === "string") {
      return layer;
    }
    parsed.push(layer);
  }
  const prefixes = containers.length === 0 ? [""] : containers.map((c) => `${c}.`);
  const ignores = optionList(contract.options, "exhaustive_ignores") ?? [];
  const parts = parsed.map((layer) =>
    layer.independent
      ? layer.tails.map((tail) => ({
          name: lastSegment(tail),
          modules: prefixed([tail], prefixes),
        }))
      : [{ name: layerName(layer), modules: prefixed(layer.tails, prefixes) }],
  );
  const names = uniqueNames(parts.flat().map((part) => part.name));
  const places = parts.map((place, i) => {
    const before = parts.slice(0, i).reduce((count, earlier) => count + earlier.length, 0);
    return place.map(
      ({ modules }, j): DraftLayer => ({ name: names[before + j] ?? "", modules, deny: [] }),
    );
  });
  return {
    places: places.reverse(),
    shape: lines.map((line) => line.replaceAll(/[\s()]/gu, "")).join("\n"),
    ignore: containers.flatMap((c) => ignores.map((tail) => `${c}.${tail}`)),
  };
}

/**
 * Takes the last segment of a dotted module name.
 *
 * @param module - such as `mypackage.blue`.
 * @returns such as `blue`.
 */
function lastSegment(module: string): string {
  return module.split(".").at(-1) ?? module;
}

/**
 * Puts module names under each container.
 *
 * @param tails - names relative to the container.
 * @param prefixes - each container with a trailing dot, or [""] for none.
 * @returns the full module names, container by container.
 */
function prefixed(tails: readonly string[], prefixes: readonly string[]): string[] {
  return prefixes.flatMap((prefix) => tails.map((tail) => `${prefix}${tail}`));
}

/**
 * Parses one layer line: a module, or siblings separated by `|` or `:`.
 *
 * @param line - the line as written, such as `mypackage.blue | mypackage.green`.
 * @returns the siblings, or why the line can't be mapped.
 */
function layerLine(line: string): LayerLine | string {
  if (line.includes("|") && line.includes(":")) {
    return `the layer "${line}" mixes | and :, which import-linter rejects too.`;
  }
  const independent = line.includes("|");
  const tails = line.split(independent ? "|" : ":").map(optionalName);
  const wrong = tails.find((tail) => !MODULE.test(tail));
  return wrong === undefined ? { tails, independent } : wildcardReason("layers", wrong);
}

/**
 * Names an Inwards layer after its line: the last segment of each module.
 *
 * @param layer - the parsed line, not `|` siblings (those are a layer each).
 * @returns such as `high`, or `yellow : purple` for `:` siblings.
 */
function layerName(layer: LayerLine): string {
  return layer.tails.map(lastSegment).join(" : ");
}

/**
 * Strips the parentheses of an optional layer (`(medium)`); Inwards never
 * requires a layer to exist.
 *
 * @param item - one item of a layer line, possibly in parentheses.
 * @returns the module name alone.
 */
function optionalName(item: string): string {
  const name = item.trim();
  return name.startsWith("(") && name.endsWith(")") ? name.slice(1, -1).trim() : name;
}

/**
 * Makes layer names unique by numbering repeats.
 *
 * @param names - the names, innermost first.
 * @returns the names, a repeat becoming `name-2`, `name-3`...
 */
function uniqueNames(names: readonly string[]): string[] {
  const used = new Set<string>();
  return names.map((name) => {
    let unique = name;
    for (let n = 2; used.has(unique); n += 1) {
      unique = `${name}-${n}`;
    }
    used.add(unique);
    return unique;
  });
}
