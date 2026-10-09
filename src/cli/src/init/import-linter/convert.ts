/**
 * @file Maps import-linter contracts onto a `[tool.inwards]` draft and says, per
 * contract, what was carried over and what wasn't. `layers` contracts go
 * through `layers.ts` (`|` siblings become sibling layers); `independence` and internal `forbidden` contracts
 * become bounded contexts whose `depends-on` leaves out exactly
 * the forbidden pairs (INW002); forbidden external packages become
 * `extend-deny-libraries` on the layers that are exactly the source modules
 * (INW005).
 *
 * What has no equivalent is reported with the reason, never dropped silently:
 * `ignore_imports`, wildcards (Inwards takes literal module names),
 * `as_packages = false`, `protected` and `acyclic_siblings` contracts, custom
 * contract types. Pure: the caller reads the file and prints or writes the result.
 */
import { layersContract } from "./layers.ts";
import {
  type Draft,
  type DraftContext,
  type DraftLayer,
  everyPair,
  flag,
  MODULE,
  type Outcome,
  outcome,
  overlaps,
  type Pair,
  type State,
  sharedReasons,
  wildcardReason,
  within,
} from "./model.ts";
import type { LinterConfig, LinterContract } from "./read.ts";
import { optionList } from "./read.ts";

/** The conversion: the draft table and a verdict per contract, in file order. */
export interface Conversion {
  draft: Draft;
  outcomes: Outcome[];
}

/** Contract types with no equivalent, and why. */
const UNMAPPABLE: Readonly<Record<string, string>> = {
  protected:
    "protected contracts have no equivalent: Inwards limits what a context exposes (`public`), not who may import it.",
  acyclic_siblings:
    'acyclic_siblings contracts have no equivalent: INW004 reports cycles between modules or contexts; set `cycles = ["modules", "contexts"]` by hand if that is close enough.',
};

/**
 * Converts an import-linter configuration. Layers contracts go first, since
 * the other contracts' deny lists attach to layers; without one, a single
 * layer holds the root packages.
 *
 * @param config - the root packages and contracts.
 * @returns the draft and a verdict per contract, or an error message when
 *   there is nothing to build a layer list from.
 */
export function convert(config: LinterConfig): Conversion | string {
  const state: State = { config, layers: [], shape: undefined, pairs: [], ignore: [] };
  const verdicts = new Map<LinterContract, Outcome>();
  for (const contract of config.contracts.filter((c) => c.type === "layers")) {
    verdicts.set(contract, layersContract(state, contract));
  }
  if (state.layers.length === 0) {
    if (config.rootPackages.length === 0) {
      return "the import-linter config names no root_package and no layers contract could be mapped, so there is no layer to build [tool.inwards] from.";
    }
    const name = config.rootPackages.length === 1 ? (config.rootPackages[0] ?? "") : "project";
    state.layers.push([{ name, modules: [...config.rootPackages], deny: [] }]);
  }
  const outcomes = config.contracts.map(
    (contract) => verdicts.get(contract) ?? otherContract(state, contract),
  );
  return {
    draft: { layers: state.layers, contexts: contexts(state.pairs), ignore: state.ignore },
    outcomes,
  };
}

/**
 * Converts a contract other than `layers`.
 *
 * @param state - what the conversion has so far; gains pairs and deny lists.
 * @param contract - a contract of any type but `layers`.
 * @returns its verdict.
 */
function otherContract(state: State, contract: LinterContract): Outcome {
  if (contract.type === "forbidden") {
    return forbiddenContract(state, contract);
  }
  if (contract.type === "independence") {
    const modules = optionList(contract.options, "modules") ?? [];
    const unusable = modulesProblem(contract, { modules });
    if (unusable !== undefined) {
      return outcome(contract, [unusable], false);
    }
    state.pairs.push(...everyPair(modules));
    return outcome(contract, sharedReasons(contract), true);
  }
  const reason =
    UNMAPPABLE[contract.type] ??
    `contract type "${contract.type}" is custom or unknown, so there is nothing to map it to.`;
  return outcome(contract, [reason], false);
}

/**
 * Converts a `forbidden` contract: internal targets become pairs, external
 * ones deny lists.
 *
 * @param state - the layers, and the pairs so far; gains pairs and deny lists.
 * @param contract - a contract of type `forbidden`.
 * @returns its verdict.
 */
function forbiddenContract(state: State, contract: LinterContract): Outcome {
  const sources = optionList(contract.options, "source_modules") ?? [];
  const targets = optionList(contract.options, "forbidden_modules") ?? [];
  const unusable = modulesProblem(contract, {
    source_modules: sources,
    forbidden_modules: targets,
  });
  if (unusable !== undefined) {
    return outcome(contract, [unusable], false);
  }
  const reasons = sharedReasons(contract);
  const roots = state.config.rootPackages;
  const internal = targets.filter((t) => roots.some((root) => within(t, root)));
  const external = targets.filter((t) => !internal.includes(t));
  const pairs = sources.flatMap((s) =>
    internal.filter((t) => !overlaps(s, t)).map((t): Pair => [s, t]),
  );
  state.pairs.push(...pairs);
  if (external.length === 0) {
    if (pairs.length === 0) {
      reasons.push(
        "every forbidden module contains a source module or sits inside one, so the contract forbids nothing (import-linter skips such overlaps too).",
      );
    }
    return outcome(contract, reasons, pairs.length > 0);
  }
  const layers = layersOf(state.layers.flat(), sources);
  if (typeof layers === "string") {
    reasons.push(
      `forbidden_modules ${external.join(", ")}: INW005 keeps libraries out of whole layers, and ${layers} Put the source modules in their own layer and add these to its extend-deny-libraries by hand.`,
    );
    return outcome(contract, reasons, pairs.length > 0);
  }
  for (const layer of layers) {
    layer.deny.push(...external.filter((lib) => !layer.deny.includes(lib)));
  }
  return outcome(contract, reasons, true);
}

/**
 * Finds why a contract's module lists can't be mapped: an empty list,
 * wildcards, a name that isn't a module, or `as_packages = false`.
 *
 * @param contract - the contract, for `as_packages`.
 * @param lists - the module lists to check, by option name.
 * @returns the reason, or undefined when they can be mapped.
 */
function modulesProblem(
  contract: LinterContract,
  lists: Record<string, readonly string[]>,
): string | undefined {
  for (const [key, list] of Object.entries(lists)) {
    if (list.length === 0) {
      return `${key} is empty.`;
    }
    const bad = list.find((m) => !MODULE.test(m));
    if (bad !== undefined) {
      return wildcardReason(key, bad);
    }
  }
  if (contract.options.has("as_packages") && !flag(contract, "as_packages")) {
    return "as_packages = false has no equivalent: an Inwards module name always covers everything below it.";
  }
  return undefined;
}

/**
 * Finds the layers that hold exactly the given modules, so a deny list on
 * them applies to those modules and nothing else.
 *
 * @param layers - the layer list.
 * @param sources - the modules a forbidden contract restricts.
 * @returns the layers, or the end of a sentence saying why they don't line up.
 */
function layersOf(layers: DraftLayer[], sources: readonly string[]): DraftLayer[] | string {
  const touched = layers.filter((layer) =>
    layer.modules.some((m) => sources.some((s) => within(m, s))),
  );
  const loose = sources.find((s) => !touched.some((layer) => layer.modules.includes(s)));
  if (loose !== undefined) {
    return `"${loose}" is not a module of a layer.`;
  }
  const shared = touched.find((layer) =>
    layer.modules.some((m) => !sources.some((s) => within(m, s))),
  );
  return shared === undefined
    ? touched
    : `layer "${shared.name}" also holds modules outside source_modules.`;
}

/**
 * Builds one context per module a forbidden pair names. Each may depend on
 * every other context except those a pair forbids: a pair covers the
 * contexts at or below each of its ends, as import-linter's packages do.
 *
 * @param pairs - the forbidden directions.
 * @returns the contexts, sorted by module.
 */
function contexts(pairs: readonly Pair[]): DraftContext[] {
  const modules = [...new Set(pairs.flat())].sort();
  return modules.map((module) => ({
    module,
    dependsOn: modules.filter(
      (other) =>
        other !== module && !pairs.some(([from, to]) => within(module, from) && within(other, to)),
    ),
  }));
}
