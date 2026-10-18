/**
 * @file Words INW015's findings and fix steps: one for a runtime import of a
 * role module, and one for a call that builds a class of the role reached
 * through a module outside it. Both name the role, the modules `allowed-in`
 * lists (the composition root), and the way out: depend on the port and take
 * the adapter as a parameter or through `Depends()`. Plain text from what
 * `check.ts` and `calls.ts` found; it decides nothing.
 */
import type { Node } from "web-tree-sitter";
import type { Diagnostic, Fix, ImportRef, SourceFile, Span } from "../../contracts/records.ts";
import { diagnostic, RULES } from "../../meta/registry.ts";
import { joined } from "../shared/words.ts";

/** INW015's role and the modules that may import and build it. */
export interface Scope {
  /** `role`: the guarded modules, as written. */
  readonly role: readonly string[];
  /** `allowed-in`: the composition root, as written; empty when only the role itself may. */
  readonly allowed: readonly string[];
}

/** A call that builds a class of the role. */
export interface Construction {
  readonly call: Node;
  /** The callee as written, e.g. `SqlRepo` or `adapters.SqlRepo`. */
  readonly written: string;
  /** The class's qualified name in the module that defines it. */
  readonly defined: string;
}

/**
 * Lists names in backticks, joined with "and".
 *
 * @param names - dotted names.
 * @returns e.g. "`app.di` and `app.main`".
 */
function ticked(names: readonly string[]): string {
  return joined(names.map((name) => `\`${name}\``));
}

/**
 * Says who may import and build the role, for the message.
 *
 * @param scope - the role and `allowed-in`.
 * @param verb - "import" or "build".
 * @returns e.g. "a module of the role `app.adapters.outbound` that only `app.di` may import".
 */
function roleClause(scope: Scope, verb: "import" | "build"): string {
  const role = `the role ${ticked(scope.role)}`;
  return scope.allowed.length === 0
    ? `${role}, which no module outside it may ${verb}`
    : `${role}, which only ${ticked(scope.allowed)} may ${verb}`;
}

/** The message's closing sentence: why it matters. */
const WHY =
  "A module that uses the adapter directly is tied to it and bypasses the port it implements.";

/**
 * Says where the adapter should be built, for the fix.
 *
 * @param scope - the role and `allowed-in`.
 * @returns e.g. "`app.di` or `app.main`", or "the composition root".
 */
function root(scope: Scope): string {
  return scope.allowed.length === 0
    ? "the composition root"
    : joined(
        scope.allowed.map((name) => `\`${name}\``),
        "or",
      );
}

/**
 * Writes the fix steps both forms share, after the first one.
 *
 * @param scope - the role and `allowed-in`.
 * @returns the steps: the port, the parameter, the composition root, re-exports.
 */
function sharedSteps(scope: Scope): string[] {
  const where = root(scope);
  return [
    "Type this module against the port the adapter implements (the abstract class or Protocol the inner layer owns), not against the adapter.",
    "Receive the implementation through a constructor or function parameter; in a FastAPI route or dependency, through `Depends()` on a provider whose return type is the port.",
    `Build the adapter in ${where} and pass it in from there.`,
    "If this module needs the adapter only in annotations, use the port there too; an import under `if TYPE_CHECKING:` isn't reported, but it still ties the module to the adapter.",
    "Don't re-export the adapter from another module to get around this: Inwards follows re-exports to the class.",
  ];
}

/**
 * Names what an import brings in, for the message.
 *
 * @param ref - the import statement's entry that reaches the role, with its span.
 * @param owner - the role module the import lands in.
 * @returns e.g. "`SqlRepo` from `app.adapters.outbound.sql`", or "`app.adapters.outbound.sql`".
 */
function imported(ref: ImportRef, owner: string): string {
  if (ref.target === owner) {
    return `\`${owner}\``;
  }
  return `\`${ref.target.slice(owner.length + 1)}\` from \`${owner}\``;
}

/**
 * Reports a runtime import of a role module, on the imported name.
 *
 * @param src - the importing file.
 * @param ref - the import statement's entry that reaches the role, with its span.
 * @param owner - the role module the import lands in.
 * @param scope - the role and `allowed-in`.
 * @returns the diagnostic.
 */
export function reportImport(
  src: SourceFile,
  ref: ImportRef,
  owner: string,
  scope: Scope,
): Diagnostic {
  const fix: Fix = {
    summary: `Take the port as a parameter instead of importing \`${owner}\`, and let ${root(scope)} build the adapter.`,
    steps: [`Delete \`${ref.statement}\`.`, ...sharedSteps(scope)],
  };
  const span: Span = {
    line: ref.line,
    column: ref.column,
    endLine: ref.endLine,
    endColumn: ref.endColumn,
  };
  return diagnostic(RULES.INW015, src, {
    span,
    message: `\`${src.module}\` imports ${imported(ref, owner)}, a module of ${roleClause(scope, "import")}. ${WHY}`,
    fix,
  });
}

/**
 * Reports a call that builds a class of the role, from the call's start to
 * the end of its callee.
 *
 * @param src - the file the call is in.
 * @param found - the call and the class it builds.
 * @param scope - the role and `allowed-in`.
 * @returns the diagnostic.
 */
export function reportConstruction(src: SourceFile, found: Construction, scope: Scope): Diagnostic {
  const callee = found.call.childForFieldName("function") ?? found.call;
  const span: Span = {
    line: found.call.startPosition.row + 1,
    column: found.call.startPosition.column + 1,
    endLine: callee.endPosition.row + 1,
    endColumn: callee.endPosition.column + 1,
  };
  const fix: Fix = {
    summary: `Take the port as a parameter instead of building \`${found.defined}\` here, and let ${root(scope)} build it.`,
    steps: [
      `Remove the call \`${found.written}(...)\` and the import that brings \`${found.written.split(".")[0] ?? found.written}\` in, if nothing else uses it.`,
      ...sharedSteps(scope),
    ],
  };
  return diagnostic(RULES.INW015, src, {
    span,
    message: `\`${found.written}()\` in \`${src.module}\` builds \`${found.defined}\`, a class of ${roleClause(scope, "build")}. ${WHY}`,
    fix,
  });
}
