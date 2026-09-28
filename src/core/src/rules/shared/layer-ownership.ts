/**
 * @file Which layer owns a module, and which imports point outward. INW001,
 * INW005, INW006 and INW011 all ask these questions, so the answers live here
 * rather than in any one rule. The fix steps that replace an outward import
 * with a port are here too, since INW001 and INW011 give the same advice.
 *
 * Layers are ordered by rank, which is their index unless the config has
 * independent siblings (ADR-036): an import into a sibling of the same rank
 * counts as outward too.
 */
import { matchEntry, topPackageOf } from "../../config/layer-selector.ts";
import type { LayerSpec } from "../../config/layers.ts";
import type { InwardsConfig } from "../../config/parse.ts";
import type { ImportRef, SourceFile } from "../../contracts/records.ts";

/** Which layer owns a module, through which entry, and how deep it matched. */
export interface Membership {
  /** The owning layer's index, innermost first. */
  index: number;
  layer: LayerSpec;
  /** The entry of `layer.modules` that won, as written: `shop.*.domain`. */
  entry: string;
  /** The module's own matched prefix: `shop.orders.domain` for `shop.orders.domain.order`. */
  prefix: string;
  /**
   * The module's prefix up to the entry's last literal segment: `shop` for
   * `shop.**`, `shop.orders.domain` for `shop.*.domain`. The session checks
   * name a selector's slices by it.
   */
  slice: string;
}

/**
 * Finds the layer that owns a module, with the entry that won and the
 * module's matched prefix. An entry matches the module itself or any
 * submodule (`shop.domain` owns `shop.domain.order` but not
 * `shop.domainx`). When several entries match, the most specific one wins
 * (ADR-034):
 *
 * 1. the deepest last literal segment, so `shop.orders.domain` beats `shop.**`;
 * 2. then the deeper matched depth;
 * 3. then more literal segments;
 * 4. then the earlier layer, then the earlier entry.
 *
 * For literal entries alone this is the longest prefix, as it always was.
 *
 * @param module - dotted module name, e.g. `shop.orders.domain.order`.
 * @param layers - the configured layers, innermost first.
 * @returns the membership, or undefined when no layer owns the module.
 */
export function layerMembership(
  module: string,
  layers: readonly LayerSpec[],
): Membership | undefined {
  let best: { index: number; entry: string; depth: number; last: number; lit: number } | undefined;
  layers.forEach((layer, index) => {
    for (const entry of layer.modules) {
      const match = matchEntry(entry, module);
      if (match === undefined) {
        continue;
      }
      const { depth, lastLiteral: last, literals: lit } = match;
      const beats =
        best === undefined ||
        last > best.last ||
        (last === best.last && (depth > best.depth || (depth === best.depth && lit > best.lit)));
      if (beats) {
        best = { index, entry, depth, last, lit };
      }
    }
  });
  const owner = best === undefined ? undefined : layers[best.index];
  if (best === undefined || owner === undefined) {
    return undefined;
  }
  const segments = module.split(".");
  return {
    index: best.index,
    layer: owner,
    entry: best.entry,
    prefix: segments.slice(0, best.depth).join("."),
    slice: segments.slice(0, best.last).join("."),
  };
}

/**
 * Finds the layer that owns a module (see `layerMembership` for the precedence).
 *
 * @param module - dotted module name, e.g. `shop.domain.order`.
 * @param layers - the configured layers, innermost first.
 * @returns the index of the owning layer, or -1 when no layer owns it.
 */
export function layerIndexOf(module: string, layers: readonly LayerSpec[]): number {
  return layerMembership(module, layers)?.index ?? -1;
}

/**
 * Names the top-level package of every layer entry, e.g. `shop` for
 * `shop.*.domain`. The directory walks of the CLI, the session manifest and
 * the language server open these packages in full, so no skipped directory
 * name (`node_modules`, a virtualenv) can hide layer code or code moved out
 * of a layer next to it.
 *
 * @param config - the parsed config.
 * @returns the packages, each once, in config order.
 */
export function layerPackages(config: Pick<InwardsConfig, "layers">): string[] {
  return [...new Set(config.layers.flatMap((layer) => layer.modules.map(topPackageOf)))];
}

/**
 * Names where a file's layer should declare a port: the file's own matched
 * prefix (`shop.orders.domain`, never another slice's or the raw selector),
 * with `<prefix>.ports` as an example only when that prefix is a package. A
 * single-file member gets no invented child module.
 *
 * @param file - the importing file, which a layer owns.
 * @param layers - the configured layers, innermost first.
 * @returns e.g. `` `shop.orders.domain` (for example `shop.orders.domain.ports`) ``.
 */
export function portHome(file: SourceFile, layers: readonly LayerSpec[]): string {
  const own = layerMembership(file.module, layers);
  const home = own?.prefix ?? file.module;
  const isPackage = home !== file.module || file.isPackage;
  return isPackage ? `\`${home}\` (for example \`${home}.ports\`)` : `\`${home}\``;
}

/**
 * Gives a layer's place in the order: its rank when the config has siblings,
 * else its index.
 *
 * @param layers - the configured layers, innermost first.
 * @param index - the layer's index.
 * @returns the rank; layers of one rank are independent siblings.
 */
export function rankOf(layers: readonly LayerSpec[], index: number): number {
  return layers[index]?.rank ?? index;
}

/** An import that points from an inner layer to an outer one, or to a sibling. */
export interface OutwardImport<R extends ImportRef> {
  ref: R;
  /** The inner layer the importing file belongs to. */
  source: LayerSpec;
  /** The outer or sibling layer the import reaches. */
  target: LayerSpec;
  /** How the diagnostic names the target: `outer layer` or `sibling layer`. */
  relation: "outer layer" | "sibling layer";
}

/**
 * Picks the imports that point outward, the check INW001 and INW011 share.
 * Imports of the same layer, of layers of a lower rank, and of modules outside
 * every layer are allowed; an import of a sibling of the same rank is not. A
 * file that belongs to no layer is not checked at all.
 *
 * @param file - the file the imports come from.
 * @param imports - the imports found in that file.
 * @param layers - the configured layers, innermost first.
 * @returns each import that reaches an outer or sibling layer, with both layers.
 */
export function outwardImports<R extends ImportRef>(
  file: SourceFile,
  imports: readonly R[],
  layers: readonly LayerSpec[],
): OutwardImport<R>[] {
  const from = layerIndexOf(file.module, layers);
  const source = layers[from];
  if (!source) {
    return [];
  }
  const out: OutwardImport<R>[] = [];
  for (const ref of imports) {
    const to = layerIndexOf(ref.target, layers);
    const target = layers[to];
    const rank = rankOf(layers, to);
    if (target && to !== from && rank >= rankOf(layers, from)) {
      const relation = rank === rankOf(layers, from) ? "sibling layer" : "outer layer";
      out.push({ ref, source, target, relation });
    }
  }
  return out;
}

/**
 * Names the allowed dependency direction for a diagnostic message, siblings
 * joined by `|`.
 *
 * @param layers - the configured layers, innermost first.
 * @returns e.g. `domain <- application <- infrastructure`, or `a <- b | c <- d`.
 */
export function allowedDirection(layers: readonly LayerSpec[]): string {
  const ranks: string[][] = [];
  layers.forEach((layer, i) => {
    const rank = rankOf(layers, i);
    ranks[rank] = [...(ranks[rank] ?? []), layer.name];
  });
  return ranks.map((names) => names.join(" | ")).join(" <- ");
}

/**
 * Writes the fix steps that replace an outward import with a port.
 * Shared by INW001 and INW011, which differ only in what to delete.
 *
 * @param file - the importing file; its matched prefix names where the port goes.
 * @param layers - the configured layers, innermost first.
 * @param target - the outer layer it imported from.
 * @param ref - the offending import.
 * @returns three steps: declare a Protocol, type against it, wire it at the root.
 */
export function portSteps(
  file: SourceFile,
  layers: readonly LayerSpec[],
  target: LayerSpec,
  ref: ImportRef,
): string[] {
  const symbol = ref.target.split(".").at(-1) ?? ref.target;
  return [
    `Declare a typing.Protocol in ${portHome(file, layers)} that describes only what this module needs from \`${symbol}\`.`,
    "Type this module against that Protocol and receive the implementation through a constructor or function parameter.",
    `Make the class in "${target.name}" satisfy the Protocol, and wire it in the outermost layer (the composition root).`,
  ];
}
