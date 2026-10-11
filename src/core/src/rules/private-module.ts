/**
 * @file INW021 private-module (ADR-046): a first-party module whose name,
 * below the top-level package, starts with one underscore is for the package
 * that holds it. Its `__init__.py`, siblings and subpackages may import it;
 * any other module imports what the package's `__init__.py` re-exports. The
 * import set is the engine's: plain, `from`, relative, star and readable
 * dynamic imports, wherever they sit. Private names in a public module
 * (`from pkg import _helper`) and third-party private modules are left to
 * Ruff. The engine decides which imports another rule already reports.
 */
import type { Diagnostic, ImportRef, SourceFile } from "../contracts/records.ts";
import type { ModuleLookup } from "../lookup/module-lookup.ts";
import { diagnostic, RULES } from "../meta/registry.ts";
import { privateTo } from "../python/private-modules.ts";

/** An import statement's names from one private module, reported once. */
interface Reach {
  ref: ImportRef;
  module: string;
  home: string;
  names: string[];
}

/**
 * Applies INW021 to a file's imports. A statement that imports several names
 * from one private module gets one finding, on its first name.
 *
 * @param file - the file the imports come from.
 * @param imports - its imports, relative ones already resolved.
 * @param ownerOf - finds the first-party module an import lands in.
 * @param deferred - true for an import another rule reports on its line (INW003).
 * @returns one diagnostic per import statement and private module of another package.
 */
export function checkPrivateModules(
  file: SourceFile,
  imports: readonly ImportRef[],
  ownerOf: ModuleLookup,
  deferred: (ref: ImportRef) => boolean,
): Diagnostic[] {
  const reaches = new Map<string, Reach>();
  for (const ref of imports) {
    // A missing module is INW010's; a third-party one is Ruff's.
    const module = ref.target === "" ? undefined : ownerOf(ref.target);
    const home = module === undefined ? undefined : privateTo(module);
    if (module === undefined || home === undefined || inside(file.module, home) || deferred(ref)) {
      continue;
    }
    const key = `${ref.line}:${ref.statement}:${module}`;
    const reach = reaches.get(key) ?? { ref, module, home, names: [] };
    const name = ref.target.startsWith(`${module}.`) ? ref.target.slice(module.length + 1) : "";
    if (name !== "") {
      reach.names.push(name);
    }
    reaches.set(key, reach);
  }
  return [...reaches.values()].map((reach) => {
    const { ref, module, home } = reach;
    const message = `\`${file.module}\` imports \`${module}\`, a private module of \`${home}\`. A module whose name starts with \`_\` is for its own package; other code imports what the package's \`__init__.py\` re-exports.`;
    return diagnostic(RULES.INW021, file, { span: ref, message, fix: fixFor(reach) });
  });
}

/**
 * Tells whether a module is a package or lies under it.
 *
 * @param module - the importing module.
 * @param pkg - a dotted package name.
 * @returns true for the package itself (its `__init__.py`) and everything under it.
 */
function inside(module: string, pkg: string): boolean {
  return module === pkg || module.startsWith(`${pkg}.`);
}

/**
 * Writes the repair advice: import from the package, re-exporting there
 * first if needed, or drop the underscore when the module is meant to be shared.
 *
 * @param reach - the import statement's names from one private module.
 * @param reach.ref - the statement's first import of the module.
 * @param reach.module - the private module.
 * @param reach.home - the package it is private to.
 * @param reach.names - the names the statement imports from it; none for the module itself.
 * @returns the summary and numbered steps of the fix.
 */
function fixFor({ ref, module, home, names }: Reach): Diagnostic["fix"] {
  const relative = `.${module.slice(home.length + 1)}`;
  const rename = `If \`${module}\` is meant for other packages, ask the user whether to rename it without the leading underscore instead.`;
  if (names.length === 0) {
    return {
      summary: `Import what you need from \`${home}\` instead of its private module \`${module}\`.`,
      steps: [
        `Replace \`${ref.statement}\` with an import of the names you use from \`${home}\`.`,
        `Re-export each of them in \`${home}\`'s \`__init__.py\` if it isn't there yet: \`from ${relative} import <name>\`.`,
        rename,
      ],
    };
  }
  const listed = names.map((n) => `\`${n}\``).join(", ");
  const plain = names.join(", ");
  return {
    summary: `Import ${listed} from \`${home}\`, not from its private module \`${module}\`.`,
    steps: [
      `In \`${ref.statement}\`, import ${listed} from \`${home}\` instead.`,
      `If \`${home}\`'s \`__init__.py\` doesn't re-export ${names.length === 1 ? "it" : "them"} yet, add \`from ${relative} import ${plain}\` there (and to \`__all__\` if the package keeps one).`,
      rename,
    ],
  };
}
