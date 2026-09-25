import type { LayerSpec } from "./config.ts";
import { DOCS_BASE } from "./meta.ts";
import type { Diagnostic, ImportRef, SourceFile } from "./types.ts";

export const LAYER_RULE = {
  code: "INW001",
  name: "layer-dependency",
  docs: `${DOCS_BASE}/03-Architecture-C4/#rule-catalogue`,
} as const;

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

/**
 * Applies INW001: dependencies point inward.
 * An inner layer never imports an outer one. Imports of the same layer, of
 * inner layers, and of modules outside every layer are allowed. A file that
 * belongs to no layer is not checked at all.
 *
 * @param file - the file the imports come from.
 * @param imports - the imports found in that file.
 * @param layers - the configured layers, innermost first.
 * @returns one diagnostic per import that points outward.
 */
export function checkLayers(
  file: SourceFile,
  imports: readonly ImportRef[],
  layers: readonly LayerSpec[],
): Diagnostic[] {
  const from = layerIndexOf(file.module, layers);
  const source = layers[from];
  if (!source) {
    return [];
  }

  const out: Diagnostic[] = [];
  for (const ref of imports) {
    const to = layerIndexOf(ref.target, layers);
    const target = layers[to];
    if (!target || to <= from) {
      continue;
    }
    out.push({
      code: LAYER_RULE.code,
      rule: LAYER_RULE.name,
      severity: "error",
      file: file.path,
      module: file.module,
      line: ref.line,
      column: ref.column,
      endLine: ref.endLine,
      endColumn: ref.endColumn,
      message:
        `Layer "${source.name}" imports "${ref.target}" from outer layer "${target.name}". ` +
        `Allowed direction: ${layers.map((l) => l.name).join(" <- ")}.`,
      fix: fixFor(source, target, ref),
      docs: LAYER_RULE.docs,
    });
  }
  return out;
}

/**
 * Writes the repair advice attached to an INW001 diagnostic.
 * The steps are aimed at a coding agent: remove the import, add a Protocol in
 * the inner layer, and wire the outer implementation at the composition root.
 * E2E snapshots pin this wording.
 *
 * @param source - the inner layer that made the import.
 * @param target - the outer layer it imported from.
 * @param ref - the offending import.
 * @returns the summary and numbered steps of the fix.
 */
function fixFor(source: LayerSpec, target: LayerSpec, ref: ImportRef): Diagnostic["fix"] {
  const home = source.modules[0] ?? source.name;
  const symbol = ref.target.split(".").at(-1) ?? ref.target;
  return {
    summary: `Depend on an abstraction owned by "${source.name}" instead of "${ref.target}".`,
    steps: [
      `Delete \`${ref.statement}\`. Do not move the import into a function or behind TYPE_CHECKING; Inwards checks those too.`,
      `Declare a typing.Protocol in \`${home}\` (for example \`${home}.ports\`) that describes only what this module needs from \`${symbol}\`.`,
      "Type this module against that Protocol and receive the implementation through a constructor or function parameter.",
      `Make the class in "${target.name}" satisfy the Protocol, and wire it in the outermost layer (the composition root).`,
    ],
  };
}
