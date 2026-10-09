/**
 * @file The vocabulary of `inwards import-config`: the draft `[tool.inwards]`
 * table, the verdict on each import-linter contract, and the small helpers
 * every contract type's mapping shares (module prefixes, forbidden pairs,
 * boolean options, the reasons all contract types can give).
 *
 * Kept apart so `layers.ts` and `convert.ts` depend on it rather than on each
 * other. Pure: no I/O.
 */
import type { LinterConfig, LinterContract } from "./read.ts";
import { optionList } from "./read.ts";

/** One layer of the draft, innermost first like `[tool.inwards]`. */
export interface DraftLayer {
  name: string;
  modules: string[];
  /** Libraries a `forbidden` contract keeps out of the layer (INW005). */
  deny: string[];
}

/** One bounded context of the draft: a single module, public in full. */
export interface DraftContext {
  module: string;
  dependsOn: string[];
}

/** The `[tool.inwards]` table the conversion arrived at. */
export interface Draft {
  /** The places in the order, innermost first; a place of two or more layers is a sibling group. */
  layers: DraftLayer[][];
  contexts: DraftContext[];
  /** Modules left out of INW006's warning (`exhaustive_ignores`). */
  ignore: string[];
}

/** What happened to one contract. */
export interface Outcome {
  /** The contract as a person would name it: its id and name. */
  contract: string;
  /** mapped: in full; partial: some of it; skipped: none of it. */
  status: "mapped" | "partial" | "skipped";
  /** Why something wasn't carried over, one sentence each. */
  reasons: string[];
}

/** A forbidden direction between two literal module prefixes: `from` may not import `to`. */
export type Pair = readonly [from: string, to: string];

/** Everything the contracts add up to while they are converted. */
export interface State {
  config: LinterConfig;
  /** The places in the order, innermost first; a place of two or more layers is a sibling group. */
  layers: DraftLayer[][];
  /** The shape of the layers contract the layers came from. */
  shape: string | undefined;
  pairs: Pair[];
  ignore: string[];
}

/** A dotted Python module name, with no wildcards. */
export const MODULE: RegExp = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/u;

/**
 * Tells whether a module is one a prefix owns: the prefix itself or below it.
 *
 * @param module - the dotted module name.
 * @param prefix - the dotted prefix that may own it.
 * @returns true for `shop.a` in `shop` or in `shop.a`, false for `shop.ab` in `shop.a`.
 */
export function within(module: string, prefix: string): boolean {
  return module === prefix || module.startsWith(`${prefix}.`);
}

/**
 * Tells whether one of two modules contains the other.
 *
 * @param a - one dotted module name.
 * @param b - another dotted module name.
 * @returns true when they are the same, or one is below the other.
 */
export function overlaps(a: string, b: string): boolean {
  return within(a, b) || within(b, a);
}

/**
 * Lists both directions between every two of the modules that don't overlap,
 * as an independence contract forbids them.
 *
 * @param modules - modules that may not import each other.
 * @returns the forbidden pairs.
 */
export function everyPair(modules: readonly string[]): Pair[] {
  return modules.flatMap((a) => modules.filter((b) => !overlaps(a, b)).map((b): Pair => [a, b]));
}

/**
 * Reads a boolean option the way import-linter does.
 *
 * @param contract - the contract whose options are read.
 * @param key - the option's lower-case name.
 * @returns true for "true" in any case, false otherwise or when unset.
 */
export function flag(contract: LinterContract, key: string): boolean {
  const value = contract.options.get(key);
  return typeof value === "string" && value.toLowerCase() === "true";
}

/**
 * Builds a verdict.
 *
 * @param contract - the contract judged, for its id and name.
 * @param reasons - what wasn't carried over.
 * @param mapped - whether any of it was.
 * @returns mapped with no reasons, partial with some, skipped when nothing was.
 */
export function outcome(contract: LinterContract, reasons: string[], mapped: boolean): Outcome {
  const label =
    contract.id === undefined || contract.id === contract.name
      ? `"${contract.name}"`
      : `${contract.id} ("${contract.name}")`;
  let status: Outcome["status"] = "skipped";
  if (mapped) {
    status = reasons.length > 0 ? "partial" : "mapped";
  }
  return { contract: label, status, reasons };
}

/**
 * Explains why a module expression can't be mapped.
 *
 * @param key - the option it was found in, such as `forbidden_modules`.
 * @param expression - the expression as written.
 * @returns the reason, naming the wildcard when there is one.
 */
export function wildcardReason(key: string, expression: string): string {
  return expression.includes("*")
    ? `${key} uses the wildcard "${expression}", and Inwards takes literal module names; list the modules it matches by hand.`
    : `${key} holds "${expression}", which is not a module name.`;
}

/**
 * The reasons every contract type shares: `ignore_imports`, which has no
 * equivalent, and `broken_contract_guidance`, which Inwards replaces.
 *
 * @param contract - the contract whose options are read.
 * @returns the reasons, possibly none.
 */
export function sharedReasons(contract: LinterContract): string[] {
  const reasons: string[] = [];
  const ignored = optionList(contract.options, "ignore_imports") ?? [];
  if (ignored.length > 0) {
    reasons.push(
      `ignore_imports (${ignored.join("; ")}) has no equivalent: add an inline suppression with a reason at each import, or run \`inwards baseline\` once the config is in place.`,
    );
  }
  if (contract.options.has("broken_contract_guidance")) {
    reasons.push(
      "broken_contract_guidance: Inwards writes its own fix steps for each violation, so this message isn't carried over.",
    );
  }
  return reasons;
}
