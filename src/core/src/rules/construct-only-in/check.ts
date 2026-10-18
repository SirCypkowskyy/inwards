/**
 * @file INW015 `construct-only-in` (#296, from #98): only the composition
 * root builds outbound adapters. `role` names the guarded modules (such as
 * `app.adapters.outbound`) and `allowed-in` the modules that may import and
 * build them (such as `app.di` and `app.main`). A module outside both that
 * imports a role module at runtime is reported on the import; an import in
 * an `if TYPE_CHECKING:` block is exempt, since it builds nothing, and so is
 * `from <role module> import SomeError`: an exception class is caught or
 * mapped to HTTP, not built as an adapter. A call
 * that builds a role class reached through a module outside the role (a
 * re-export) is reported on the call (`calls.ts`). INW001 and INW015 can
 * both see an outward import; the engine passes `deferred` so INW001 keeps
 * it. Only modules a layer owns are checked: tests and scripts build
 * adapters on purpose. I/O-free: the caller supplies the file, the options
 * and the run's trees, which find, read and parse the modules.
 */
import { type RuleOptions, stringList } from "../../config/index.ts";
import type { Diagnostic, ImportRef, SourceFile } from "../../contracts/records.ts";
import { extractImports } from "../../python/parser.ts";
import type { ModuleTrees } from "../shared/module-trees.ts";
import { constructions, inEntries, isExceptionName } from "./calls.ts";
import { reportConstruction, reportImport, type Scope } from "./wording.ts";

/** Any import statement, which both forms need: nothing else can reach a role module. */
const IMPORT = /\bimport\b/u;

/** What INW015 needs besides the file and its options. */
export interface ConstructInputs {
  /** The run's trees and first-party modules: finds them, and parses each text once per run. */
  readonly project: ModuleTrees;
  /** Tells whether another rule (INW001) reports an import in INW015's place. */
  readonly deferred: (ref: ImportRef) => boolean;
}

/**
 * Reads INW015's role and `allowed-in`.
 *
 * @param options - `[tool.inwards.rules.construct-only-in]`, if set.
 * @returns the role (empty when unset) and the modules that may import it.
 */
function scopeOf(options: RuleOptions | undefined): Scope {
  return {
    role: stringList(options?.["role"]) ?? [],
    allowed: stringList(options?.["allowed-in"]) ?? [],
  };
}

/**
 * Checks one file against INW015. The caller decides whether the rule is on
 * for the file and that a layer owns it; this skips a module in the role or
 * in `allowed-in`, and parses only a file with an import.
 *
 * @param src - the file, with normalised text.
 * @param options - `[tool.inwards.rules.construct-only-in]`, if set.
 * @param inputs - the project index and the imports INW001 keeps.
 * @returns the findings in source order, before suppressions and severities apply.
 */
export function checkConstructOnlyIn(
  src: SourceFile,
  options: RuleOptions | undefined,
  inputs: ConstructInputs,
): Diagnostic[] {
  const scope = scopeOf(options);
  const exempt = inEntries(scope.role, src.module) || inEntries(scope.allowed, src.module);
  if (scope.role.length === 0 || exempt || !IMPORT.test(src.text)) {
    return [];
  }
  const { project, deferred } = inputs;
  const tree = project.treeOf(src);
  const found: Diagnostic[] = [];
  const covered: string[] = [];
  for (const ref of extractImports(tree, src)) {
    const owner = ref.target === "" ? undefined : project.ownerOf(ref.target);
    if (owner === undefined || !inEntries(scope.role, owner) || ref.typeChecking === true) {
      continue;
    }
    covered.push(ref.target);
    const caught = ref.from !== undefined && isExceptionName(ref.target);
    if (!(caught || deferred(ref))) {
      found.push(reportImport(src, ref, owner, scope));
    }
  }
  const calls = constructions(tree, src, { project, scope, covered });
  found.push(...calls.map((call) => reportConstruction(src, call, scope)));
  return found.sort((a, b) => a.line - b.line || a.column - b.column);
}
