/**
 * @file INW015 `construct-only-in` (#296, from #98): only the composition
 * root builds outbound adapters. `role` names the guarded modules (such as
 * `app.adapters.outbound`) and `allowed-in` the modules that may import and
 * build them (such as `app.di` and `app.main`). A module outside both that
 * imports a role module at runtime is reported on the import; an import in
 * an `if TYPE_CHECKING:` block is exempt, since it builds nothing. A call
 * that builds a role class reached through a module outside the role (a
 * re-export) is reported on the call (`calls.ts`). INW001 and INW015 can
 * both see an outward import; the engine passes `deferred` so INW001 keeps
 * it. Only modules a layer owns are checked: tests and scripts build
 * adapters on purpose. I/O-free: the caller supplies the parser, the file,
 * the options and the project index.
 */
import type { Node, Parser } from "web-tree-sitter";
import { stringList } from "../../config/rule-options.ts";
import type { RuleOptions } from "../../config/rule-settings.ts";
import type { Diagnostic, ImportRef, SourceFile } from "../../contracts/records.ts";
import { identifierName } from "../../python/nodes.ts";
import { extractImports, importStatements, parsePython } from "../../python/parser.ts";
import type { FirstPartySource } from "../shared/first-party.ts";
import { constructions, inEntries } from "./calls.ts";
import { reportConstruction, reportImport, type Scope } from "./wording.ts";

/** Any import statement, which both forms need: nothing else can reach a role module. */
const IMPORT = /\bimport\b/u;

/** What INW015 needs besides the file and its options. */
export interface ConstructInputs {
  /** Finds and reads first-party modules. */
  readonly project: FirstPartySource;
  /** Tells whether another rule (INW001) reports an import in INW015's place. */
  readonly deferred: (ref: ImportRef) => boolean;
}

/** Where a block of code starts and ends, as 0-based rows and columns. */
interface Range {
  readonly start: { readonly row: number; readonly column: number };
  readonly end: { readonly row: number; readonly column: number };
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
 * Tells whether a condition is `TYPE_CHECKING` or an attribute that ends in
 * it (`typing.TYPE_CHECKING`, `t.TYPE_CHECKING`).
 *
 * @param node - an `if` or `elif` condition.
 * @returns true for such a name.
 */
function isTypeChecking(node: Node | null): boolean {
  const name = node?.type === "attribute" ? node.childForFieldName("attribute") : node;
  return name?.type === "identifier" && identifierName(name) === "TYPE_CHECKING";
}

/**
 * Finds the `if TYPE_CHECKING:` (and `elif TYPE_CHECKING:`) bodies that hold
 * an import. Their `else` runs, so it isn't one.
 *
 * @param statements - the file's import statements.
 * @returns each such body's range, once per import inside it.
 */
function typeCheckingBlocks(statements: readonly Node[]): Range[] {
  const blocks: Range[] = [];
  for (const stmt of statements) {
    for (let node: Node | null = stmt; node !== null; node = node.parent) {
      const branch = node.parent;
      const guarded =
        node.type === "block" &&
        (branch?.type === "if_statement" || branch?.type === "elif_clause") &&
        branch.childForFieldName("consequence")?.equals(node) === true &&
        isTypeChecking(branch.childForFieldName("condition"));
      if (guarded) {
        blocks.push({ start: node.startPosition, end: node.endPosition });
        break;
      }
    }
  }
  return blocks;
}

/**
 * Orders two 0-based positions.
 *
 * @param a - one position.
 * @param b - the other.
 * @returns negative when `a` comes first, 0 when they are equal, positive otherwise.
 */
function compare(a: Range["start"], b: Range["start"]): number {
  return a.row - b.row || a.column - b.column;
}

/**
 * Tells whether an import sits inside one of some blocks.
 *
 * @param ref - the import, with its 1-based position.
 * @param blocks - the blocks, with 0-based positions.
 * @returns true when its start falls inside one.
 */
function inside(ref: ImportRef, blocks: readonly Range[]): boolean {
  const at = { row: ref.line - 1, column: ref.column - 1 };
  return blocks.some((block) => compare(at, block.start) >= 0 && compare(at, block.end) < 0);
}

/**
 * Checks one file against INW015. The caller decides whether the rule is on
 * for the file and that a layer owns it; this skips a module in the role or
 * in `allowed-in`, and parses only a file with an import.
 *
 * @param parser - parser with the Python grammar loaded.
 * @param src - the file, with normalised text.
 * @param options - `[tool.inwards.rules.construct-only-in]`, if set.
 * @param inputs - the project index and the imports INW001 keeps.
 * @returns the findings in source order, before suppressions and severities apply.
 */
export function checkConstructOnlyIn(
  parser: Parser,
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
  const tree = parsePython(parser, src.text);
  try {
    const blocks = typeCheckingBlocks(importStatements(tree));
    const found: Diagnostic[] = [];
    const covered: string[] = [];
    for (const ref of extractImports(tree, src)) {
      const owner = ref.target === "" ? undefined : project.ownerOf(ref.target);
      if (owner === undefined || !inEntries(scope.role, owner) || inside(ref, blocks)) {
        continue;
      }
      covered.push(ref.target);
      if (!deferred(ref)) {
        found.push(reportImport(src, ref, owner, scope));
      }
    }
    const calls = constructions(tree, src, { parser, project, scope, covered });
    found.push(...calls.map((call) => reportConstruction(src, call, scope)));
    return found.sort((a, b) => a.line - b.line || a.column - b.column);
  } finally {
    tree.delete(); // WASM memory is not garbage collected
  }
}
