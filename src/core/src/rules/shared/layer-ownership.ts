/**
 * @file Which layer owns a module, and which imports point outward. INW001,
 * INW005, INW006 and INW011 all ask these questions, so the answers live here
 * rather than in any one rule. The fix steps that replace an outward import
 * with a port are here too, since INW001 and INW011 give the same advice.
 */
import type { LayerSpec } from "../../config/parse.ts";
import type { ImportRef, SourceFile } from "../../contracts/records.ts";

/**
 * Finds the layer that owns a module.
 * A prefix matches the module itself or any submodule (`shop.domain` owns
 * `shop.domain.order` but not `shop.domainx`). When several layers match,
 * the longest prefix wins, so a nested package can sit in a different layer
 * from its parent.
 *
 * @param module - dotted module name, e.g. `shop.domain.order`.
 * @param layers - the configured layers, innermost first.
 * @returns the index of the owning layer, or -1 when no layer owns it.
 */
export function layerIndexOf(module: string, layers: readonly LayerSpec[]): number {
  let best = -1;
  let bestLength = -1;
  layers.forEach((layer, i) => {
    for (const prefix of layer.modules) {
      const matches = module === prefix || module.startsWith(`${prefix}.`);
      if (matches && prefix.length > bestLength) {
        best = i;
        bestLength = prefix.length;
      }
    }
  });
  return best;
}

/** An import that points from an inner layer to an outer one. */
export interface OutwardImport<R extends ImportRef> {
  ref: R;
  /** The inner layer the importing file belongs to. */
  source: LayerSpec;
  /** The outer layer the import reaches. */
  target: LayerSpec;
}

/**
 * Picks the imports that point outward, the check INW001 and INW011 share.
 * Imports of the same layer, of inner layers, and of modules outside every
 * layer are allowed. A file that belongs to no layer is not checked at all.
 *
 * @param file - the file the imports come from.
 * @param imports - the imports found in that file.
 * @param layers - the configured layers, innermost first.
 * @returns each import that reaches an outer layer, with both layers.
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
    if (target && to > from) {
      out.push({ ref, source, target });
    }
  }
  return out;
}

/**
 * Names the allowed dependency direction for a diagnostic message.
 *
 * @param layers - the configured layers, innermost first.
 * @returns e.g. `domain <- application <- infrastructure`.
 */
export function allowedDirection(layers: readonly LayerSpec[]): string {
  return layers.map((l) => l.name).join(" <- ");
}

/**
 * Writes the fix steps that replace an outward import with a port.
 * Shared by INW001 and INW011, which differ only in what to delete.
 *
 * @param source - the inner layer that made the import.
 * @param target - the outer layer it imported from.
 * @param ref - the offending import.
 * @returns three steps: declare a Protocol, type against it, wire it at the root.
 */
export function portSteps(source: LayerSpec, target: LayerSpec, ref: ImportRef): string[] {
  const home = source.modules[0] ?? source.name;
  const symbol = ref.target.split(".").at(-1) ?? ref.target;
  return [
    `Declare a typing.Protocol in \`${home}\` (for example \`${home}.ports\`) that describes only what this module needs from \`${symbol}\`.`,
    "Type this module against that Protocol and receive the implementation through a constructor or function parameter.",
    `Make the class in "${target.name}" satisfy the Protocol, and wire it in the outermost layer (the composition root).`,
  ];
}
