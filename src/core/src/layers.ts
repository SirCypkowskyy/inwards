import type { LayerSpec } from "./config.ts";
import { allowedDirection, outwardImports, portSteps } from "./layer-ownership.ts";
import { diagnostic, RULES } from "./rules.ts";
import type { Diagnostic, ImportRef, SourceFile } from "./types.ts";

/**
 * Applies INW001: dependencies point inward.
 * An inner layer never imports an outer one (see `outwardImports`).
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
  return outwardImports(file, imports, layers).map(({ ref, source, target }) => {
    const message =
      `Layer "${source.name}" imports "${ref.target}" from outer layer "${target.name}". ` +
      `Allowed direction: ${allowedDirection(layers)}.`;
    return diagnostic(RULES.INW001, file, {
      span: ref,
      message,
      fix: fixFor(source, target, ref),
    });
  });
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
  return {
    summary: `Depend on an abstraction owned by "${source.name}" instead of "${ref.target}".`,
    steps: [
      `Delete \`${ref.statement}\`. Do not move the import into a function or behind TYPE_CHECKING; Inwards checks those too.`,
      ...portSteps(source, target, ref),
    ],
  };
}
