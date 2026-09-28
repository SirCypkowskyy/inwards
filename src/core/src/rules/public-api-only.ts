/**
 * @file INW003 public-api-only: code outside a bounded context imports only
 * the context's public modules (ADR-030). A module is public when it lies at
 * or under one of the context's `public` prefixes. The rule covers callers in
 * other contexts and callers in no context, but not an import INW002 already
 * reports: when the dependency isn't declared at all, which module it goes
 * through is beside the point. The fix names the public module that already
 * exposes the imported name, when one does.
 */
import { type ContextSpec, contextOf } from "../config/contexts.ts";
import type { Diagnostic, ImportRef, SourceFile } from "../contracts/records.ts";
import type { ModuleLookup } from "../lookup/module-lookup.ts";
import { diagnostic, RULES } from "../meta/registry.ts";

/** What INW003 asks of the project: where a name lives, and what a module exposes. */
export interface PublicLookup {
  ownerOf: ModuleLookup;
  /**
   * Tells whether a module defines or imports a name at its top level.
   *
   * @param module - a dotted module name.
   * @param name - an identifier.
   * @returns true when other code can import the name from the module.
   */
  exposes: (module: string, name: string) => boolean;
}

/** An import that stops short of a context's public modules. */
interface Breach {
  ref: ImportRef;
  source: ContextSpec | undefined;
  target: ContextSpec;
  module: string;
}

/**
 * Applies INW003 to a file's imports.
 *
 * @param file - the file the imports come from.
 * @param imports - its imports, relative ones already resolved.
 * @param project - finds the module a name lives in, and what a module exposes.
 * @param rule - the configured contexts, and whether INW002 is on.
 * @param rule.contexts - the configured contexts; none means nothing to check.
 * @param rule.defer - true when INW002 is on, so an undeclared dependency is left to it.
 * @returns one diagnostic per import past another context's public modules.
 */
export function checkPublicApi(
  file: SourceFile,
  imports: readonly ImportRef[],
  project: PublicLookup,
  { contexts, defer }: { contexts: readonly ContextSpec[]; defer: boolean },
): Diagnostic[] {
  if (contexts.length === 0) {
    return [];
  }
  const source = contextOf(file.module, contexts);
  return imports.flatMap((ref) => {
    const breach = breachOf(ref, { source, contexts, defer }, project.ownerOf);
    if (breach === undefined) {
      return [];
    }
    const from = source ? `Context "${source.name}"` : `"${file.module}"`;
    const message = `${from} imports "${ref.target}" from context "${breach.target.name}", but "${breach.module}" isn't one of its public modules.`;
    return [diagnostic(RULES.INW003, file, { span: ref, message, fix: fixFor(breach, project) })];
  });
}

/**
 * Decides whether one import stops short of a context's public modules.
 *
 * @param ref - the import.
 * @param where - the importing file's context, all contexts, and whether INW002 is on.
 * @param where.source - the importing file's context, if any.
 * @param where.contexts - the configured contexts.
 * @param where.defer - true to leave an undeclared dependency to INW002.
 * @param ownerOf - finds the module an imported name lives in.
 * @returns the breach, or undefined when the import is fine or INW002's to report.
 */
function breachOf(
  ref: ImportRef,
  {
    source,
    contexts,
    defer,
  }: { source: ContextSpec | undefined; contexts: readonly ContextSpec[]; defer: boolean },
  ownerOf: ModuleLookup,
): Breach | undefined {
  if (ref.target === "") {
    return undefined;
  }
  // The module the name lives in, or the name itself when no module matches (INW010's case).
  const module = ownerOf(ref.target) ?? ref.target;
  const target = contextOf(module, contexts);
  if (target === undefined || target === source) {
    return undefined;
  }
  if (defer && source !== undefined && !source.dependsOn.includes(target.name)) {
    return undefined; // INW002: the dependency itself isn't declared
  }
  const open = target.public.some((prefix) => module === prefix || module.startsWith(`${prefix}.`));
  return open ? undefined : { ref, source, target, module };
}

/**
 * Writes the repair advice attached to an INW003 diagnostic: the public
 * module that already exposes the name, when there is one; else how to
 * expose it; else, when the context has no public modules, asking the user.
 *
 * @param breach - the import and the contexts on both ends.
 * @param project - tells what a public module exposes.
 * @returns the summary and numbered steps of the fix.
 */
function fixFor(breach: Breach, project: PublicLookup): Diagnostic["fix"] {
  const { ref, target, module } = breach;
  const name = ref.target.startsWith(`${module}.`) ? ref.target.slice(module.length + 1) : "";
  const home = name === "" ? undefined : target.public.find((p) => project.exposes(p, name));
  const keep =
    "Do not reach the module another way (through a function-level import, TYPE_CHECKING or importlib); Inwards checks those too.";
  if (home !== undefined) {
    // Only a statement that imports this one name, unrenamed, can be swapped whole.
    const single = new RegExp(`^from\\s+[\\w.]+\\s+import\\s+${name}$`, "u");
    const alone = single.test(ref.statement.trim());
    const swap = alone
      ? `Replace \`${ref.statement}\` with \`from ${home} import ${name}\`.`
      : `In \`${ref.statement}\`, import \`${name}\` from \`${home}\` instead: move it to its own \`from ${home} import ${name}\`, keeping its \`as\` name if it has one, and leave the other names where they are.`;
    return {
      summary: `Import "${name}" from "${home}", the public module of "${target.name}" that exposes it.`,
      steps: [swap, keep],
    };
  }
  if (target.public.length === 0) {
    return {
      summary: `"${target.name}" declares no public modules; ask the user which of its modules other code may import.`,
      steps: [
        `Delete \`${ref.statement}\`. ${keep}`,
        `Ask the user which modules of "${target.name}" other code may import; they list them in its public entry in [tool.inwards]. Don't edit [tool.inwards] yourself.`,
      ],
    };
  }
  const listed = target.public.map((p) => `\`${p}\``).join(", ");
  return {
    summary: `Go through a public module of "${target.name}": ${listed}.`,
    steps: [
      `Replace \`${ref.statement}\` with an import from ${listed}. ${keep}`,
      `If none of them exposes what you need, re-export it from one (for example \`from ${module} import ...\` in \`${target.public[0] ?? ""}\`), then import it from there.`,
    ],
  };
}
