import type { LayerSpec } from "./config.ts";
import { DOCS_BASE } from "./meta.ts";
import type { Diagnostic, ImportRef, SourceFile } from "./types.ts";

export const LAYER_RULE = {
  code: "INW001",
  name: "layer-dependency",
  docs: `${DOCS_BASE}/03-Architecture-C4/#rule-catalogue`,
} as const;

/** Index of the layer that owns `module`, or -1. The longest matching prefix wins. */
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

/** INW001: dependencies point inward. An inner layer never imports an outer one. */
export function checkLayers(
  file: SourceFile,
  imports: readonly ImportRef[],
  layers: readonly LayerSpec[],
): Diagnostic[] {
  const from = layerIndexOf(file.module, layers);
  const source = layers[from];
  if (!source) return [];

  const out: Diagnostic[] = [];
  for (const ref of imports) {
    const to = layerIndexOf(ref.target, layers);
    const target = layers[to];
    if (!target || to <= from) continue;
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

function fixFor(source: LayerSpec, target: LayerSpec, ref: ImportRef): Diagnostic["fix"] {
  const home = source.modules[0] ?? source.name;
  const symbol = ref.target.split(".").at(-1) ?? ref.target;
  return {
    summary: `Depend on an abstraction owned by "${source.name}" instead of "${ref.target}".`,
    steps: [
      `Delete \`${ref.statement}\`. Do not move the import into a function or behind TYPE_CHECKING; Inwards checks those too.`,
      `Declare a typing.Protocol in \`${home}\` (for example \`${home}.ports\`) that describes only what this module needs from \`${symbol}\`.`,
      `Type this module against that Protocol and receive the implementation through a constructor or function parameter.`,
      `Make the class in "${target.name}" satisfy the Protocol, and wire it in the outermost layer (the composition root).`,
    ],
  };
}
