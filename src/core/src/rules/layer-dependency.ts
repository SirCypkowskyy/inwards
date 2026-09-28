/**
 * @file INW001 layer-dependency: an inner layer never imports an outer one, and
 * independent siblings never import each other. Which imports point outward
 * is decided in `rules/shared/layer-ownership.ts`, shared with INW011; this
 * module words the diagnostic and its fix.
 */
import type { LayerSpec } from "../config/layers.ts";
import type { Diagnostic, ImportRef, SourceFile } from "../contracts/records.ts";
import { diagnostic, RULES } from "../meta/registry.ts";
import { allowedDirection, outwardImports, portSteps } from "./shared/layer-ownership.ts";

/**
 * Applies INW001: dependencies point inward.
 * An inner layer never imports an outer one or a sibling (see `outwardImports`).
 *
 * @param file - the file the imports come from.
 * @param imports - the imports found in that file.
 * @param layers - the configured layers, innermost first.
 * @returns one diagnostic per import that points outward or sideways.
 */
export function checkLayers(
  file: SourceFile,
  imports: readonly ImportRef[],
  layers: readonly LayerSpec[],
): Diagnostic[] {
  return outwardImports(file, imports, layers).map(({ ref, source, target, relation }) => {
    const message =
      `Layer "${source.name}" imports "${ref.target}" from ${relation} "${target.name}". ` +
      `Allowed direction: ${allowedDirection(layers)}.`;
    return diagnostic(RULES.INW001, file, {
      span: ref,
      message,
      fix: fixFor(file, layers, { source, target, ref }),
    });
  });
}

/**
 * Writes the repair advice attached to an INW001 diagnostic.
 * The steps are aimed at a coding agent: remove the import, add a Protocol in
 * the inner layer, and wire the outer implementation at the composition root.
 * E2E snapshots pin this wording.
 *
 * @param file - the importing file.
 * @param layers - the configured layers, innermost first.
 * @param outward - the offending import and the two layers.
 * @param outward.source - the inner layer that made the import.
 * @param outward.target - the outer layer it imported from.
 * @param outward.ref - the offending import.
 * @returns the summary and numbered steps of the fix.
 */
function fixFor(
  file: SourceFile,
  layers: readonly LayerSpec[],
  { source, target, ref }: { source: LayerSpec; target: LayerSpec; ref: ImportRef },
): Diagnostic["fix"] {
  return {
    summary: `Depend on an abstraction owned by "${source.name}" instead of "${ref.target}".`,
    steps: [
      `Delete \`${ref.statement}\`. Do not move the import into a function or behind TYPE_CHECKING; Inwards checks those too.`,
      ...portSteps(file, layers, target, ref),
    ],
  };
}
