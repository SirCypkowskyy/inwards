/**
 * @file INW002 context-independence: a bounded context or slice imports another
 * context only when it declares that context in `depends-on` (ADR-030). The
 * rule says nothing when either end belongs to no context, and nothing about
 * which of the other context's modules are imported; that is INW003. It
 * applies whether or not a layer owns the file: contexts and layers add up,
 * so one import can break both INW001 and INW002.
 */
import { type ContextSpec, contextOf } from "../config/contexts.ts";
import type { Diagnostic, ImportRef, SourceFile } from "../contracts/records.ts";
import type { ModuleLookup } from "../lookup/module-lookup.ts";
import { diagnostic, RULES } from "../meta/registry.ts";

/**
 * Applies INW002 to a file's imports.
 *
 * @param file - the file the imports come from.
 * @param imports - its imports, relative ones already resolved.
 * @param contexts - the configured contexts; none means nothing to check.
 * @param ownerOf - finds the module an imported name lives in.
 * @returns one diagnostic per import of a context the file's context doesn't depend on.
 */
export function checkContextDependencies(
  file: SourceFile,
  imports: readonly ImportRef[],
  contexts: readonly ContextSpec[],
  ownerOf: ModuleLookup,
): Diagnostic[] {
  const source = contexts.length === 0 ? undefined : contextOf(file.module, contexts);
  if (source === undefined) {
    return [];
  }
  return imports.flatMap((ref) => {
    if (ref.target === "") {
      return [];
    }
    // The module the name lives in, or the name itself when no module matches (INW010's case).
    const target = contextOf(ownerOf(ref.target) ?? ref.target, contexts);
    if (target === undefined || target === source || source.dependsOn.includes(target.name)) {
      return [];
    }
    const message = `Context "${source.name}" imports "${ref.target}" from context "${target.name}", which it doesn't declare in depends-on.`;
    return [
      diagnostic(RULES.INW002, file, { span: ref, message, fix: fixFor(source, target, ref) }),
    ];
  });
}

/**
 * Writes the repair advice attached to an INW002 diagnostic. The agent may
 * not change `depends-on` (the config guard stops it), so declaring the
 * dependency is left to the user.
 *
 * @param source - the importing file's context.
 * @param target - the context it imported from.
 * @param ref - the offending import.
 * @returns the summary and numbered steps of the fix.
 */
function fixFor(source: ContextSpec, target: ContextSpec, ref: ImportRef): Diagnostic["fix"] {
  const declared =
    source.dependsOn.length === 0
      ? `"${source.name}" declares no dependencies.`
      : `"${source.name}" may import from ${source.dependsOn.map((name) => `"${name}"`).join(", ")}.`;
  return {
    summary: `Keep "${source.name}" independent of "${target.name}", or ask the user whether it should depend on it.`,
    steps: [
      `Delete \`${ref.statement}\`. Do not move the import into a function or behind TYPE_CHECKING; Inwards checks those too.`,
      `Define what "${source.name}" needs as an interface (a Protocol) inside "${source.name}", and let the composition root pass in the "${target.name}" implementation. ${declared}`,
      `If "${source.name}" should use "${target.name}" directly, ask the user to add "${target.name}" to its depends-on in [tool.inwards]. Don't edit [tool.inwards] yourself.`,
    ],
  };
}
