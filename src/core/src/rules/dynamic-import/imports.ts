/**
 * @file INW011: dynamic imports with string-literal targets.
 *
 * `importlib.import_module("shop.infrastructure.db")` creates the same
 * dependency as `import shop.infrastructure.db`, and so does
 * `exec("import shop.infrastructure.db")`. This module finds the calls that
 * load a module named by a string literal and resolves what they load:
 *
 * - `importlib.import_module(name, package)`, with a relative name resolved
 *   against a literal `package`, `__package__` or `__name__`;
 * - `__import__(name, globals, locals, fromlist, level)`, also reached as
 *   `builtins.__import__` or `importlib.__import__`; a relative `level`
 *   resolves against the file's own package;
 * - `runpy.run_module(mod_name)` and `pkgutil.resolve_name("mod:Obj")`;
 * - `importlib.util.find_spec(name, package)`, and the file loaders
 *   `importlib.util.spec_from_file_location` and
 *   `importlib.machinery.SourceFileLoader`, which load the file at a path;
 * - `exec`, `eval` and `compile` with a literal source: the source is parsed
 *   as Python, and every import in it, static or dynamic, counts at the call;
 *   names it binds (`from importlib import import_module as im`) count in the
 *   calling module too;
 * - any of these wrapped in `functools.partial(loader, ...)` with arguments
 *   bound, read at the `partial` call.
 *
 * The calls are found in `calls.ts`, aliases resolved in `callees.ts`,
 * constants read in `python/literals.ts` (with the module's own constants from
 * `constants.ts`), and the targets of module loaders in `loader-targets.ts`.
 *
 * A target Inwards can't read (a variable that isn't a module constant, an
 * f-string field, a literal with a `\N{...}` escape, whose decoding needs the
 * Unicode name table, or a relative `import_module` whose `package` isn't
 * known) makes the call unverifiable. It
 * is reported in every layer but the outermost, which may import anything
 * first-party. `compile` is the exception: it only builds a code object, and
 * running that takes `exec` or `eval`, which are reported themselves.
 */
import type { Parser, Tree } from "web-tree-sitter";
import type { LayerSpec } from "../../config/parse.ts";
import type { Diagnostic, ImportRef, SourceFile } from "../../contracts/records.ts";
import type { ModuleLookup } from "../../lookup/module-lookup.ts";
import { diagnostic, RULES } from "../../meta/registry.ts";
import {
  allowedDirection,
  layerIndexOf,
  outwardImports,
  portHome,
  portSteps,
} from "../shared/layer-ownership.ts";
import { builtinBindings } from "./callees.ts";
import { loadingCalls, type Reader } from "./calls.ts";
import type { Unreadable } from "./loader-targets.ts";

/**
 * Treats every module as first-party: the safe default when no project index is at hand.
 *
 * @param target - a dotted module name.
 * @returns the name itself.
 */
function everyModule(target: string): string {
  return target;
}

/** An import made by a call rather than an import statement. */
export interface DynamicImportRef extends ImportRef {
  /** The loading call as written in the report, e.g. `importlib.import_module` or `exec`. */
  via: string;
  /** Why the target can't be read; `target` is then empty. Null when it was read. */
  unreadable: Unreadable | null;
}

/**
 * Every spelling a loading call must contain, before or after NFKC.
 * A call is resolved from a name that is either a builtin (`exec`, `eval`,
 * `compile`, `__import__`, `__builtins__`), bound by an import statement,
 * which spells `importlib`, `runpy`, `pkgutil` or `builtins`, or reached
 * through a builtin function's `__self__`. `sys.modules[...]` and
 * `__globals__[...]` need a key that spells one of these too. Import
 * statements can't use escapes, and identifiers are NFKC-normalised before
 * the test, so any file `extractDynamicImports` finds something in matches
 * this pattern. `re.compile` does not match: a builtin reached through a dot
 * needs `builtins` or `__self__`.
 */
const LOADER_HINT =
  /importlib|runpy|pkgutil|builtins|__import__|__self__|(?<![\w.])(?:exec|eval|compile)(?!\w)/u;
const NON_ASCII = /[^ -~\t\n\r\f]/u;

/**
 * Tells whether a file may contain a dynamic import, from its text alone.
 * The engine uses it to skip the import skeleton, which only keeps import
 * statements and would pass a file whose only dependency is dynamic.
 * False positives cost a full parse; a false negative would be a missed
 * violation, so `prescan-diff` checks that it never has one.
 *
 * @param text - normalised file text.
 * @returns true when the text names a loader or a module that holds one.
 */
export function mentionsDynamicImport(text: string): boolean {
  // NFKC only changes non-ASCII text; most files skip the (slow) call.
  return LOADER_HINT.test(NON_ASCII.test(text) ? text.normalize("NFKC") : text);
}

/**
 * Lists the dynamic imports with literal targets in a parsed file.
 * Each resolved target becomes one reference spanning the whole call.
 *
 * @param parser - parser with the Python grammar loaded, for literal `exec` sources.
 * @param tree - the parsed file.
 * @param file - the file the tree came from; its package resolves relative targets.
 * @param ownerOf - finds first-party modules; without it every module counts as first-party.
 * @returns one entry per loaded module, in source order.
 */
export function extractDynamicImports(
  parser: Parser,
  tree: Tree,
  file: SourceFile,
  ownerOf: ModuleLookup = everyModule,
): DynamicImportRef[] {
  const base = builtinBindings();
  const refs: DynamicImportRef[] = [];
  const reader: Reader = { parser, ownerOf };
  for (const { call, loads } of loadingCalls(reader, tree.rootNode, file, base)) {
    const statement = shorten(call.text);
    for (const { target, via, unreadable } of loads) {
      refs.push({
        target,
        via,
        unreadable,
        statement,
        line: call.startPosition.row + 1,
        column: call.startPosition.column + 1,
        endLine: call.endPosition.row + 1,
        endColumn: call.endPosition.column + 1,
      });
    }
  }
  return refs;
}

/**
 * Applies INW011: a dynamic import must not reach an outer layer either.
 * Same direction rule as INW001, with a fix that tells the agent the loader
 * itself is the problem. A call whose bytes source declares an encoding
 * Inwards can't read is reported in any layer, since its imports are unknown.
 * A computed target is reported in every layer but the outermost, the only
 * one where any first-party target is allowed.
 *
 * @param file - the file the imports come from.
 * @param refs - the dynamic imports found in that file.
 * @param layers - the configured layers, innermost first.
 * @returns one diagnostic per dynamic import that points outward or can't be read.
 */
export function checkDynamicImports(
  file: SourceFile,
  refs: readonly DynamicImportRef[],
  layers: readonly LayerSpec[],
): Diagnostic[] {
  const readable = refs.filter((ref) => ref.unreadable === null);
  const outward = outwardImports(file, readable, layers).map(({ ref, source, target }) => {
    const message =
      `Layer "${source.name}" imports "${ref.target}" from outer layer "${target.name}" ` +
      `through a dynamic import (${ref.via}). Allowed direction: ${allowedDirection(layers)}.`;
    return diagnostic(RULES.INW011, file, {
      span: ref,
      message,
      fix: {
        summary: `Remove the dynamic import and depend on an abstraction owned by "${source.name}" instead of "${ref.target}".`,
        steps: [
          `Delete \`${ref.statement}\`. A dynamic import is still a dependency: building the module name at runtime or moving it to another loader hides it instead of removing it.`,
          ...portSteps(file, layers, target, ref),
        ],
      },
    });
  });
  const own = layers[layerIndexOf(file.module, layers)];
  const outermost = layers.at(-1);
  if (!(own && outermost)) {
    return outward;
  }
  const inner = own !== outermost;
  const unreadable = refs.flatMap((ref) => {
    const why = ref.unreadable;
    if (why?.kind === "encoding") {
      return [unreadableSource(file, ref, why.encoding)];
    }
    return why?.kind === "computed" && inner
      ? [unverifiableTarget(file, ref, { source: own, outermost, home: portHome(file, layers) })]
      : [];
  });
  return [...outward, ...unreadable];
}

/**
 * Reports a loader call in an inner layer whose target Inwards can't read.
 *
 * @param file - the calling file.
 * @param ref - the call.
 * @param where - the layers involved and where the port goes.
 * @param where.source - the layer the file belongs to, not the outermost.
 * @param where.outermost - the outermost layer, where the loader may live.
 * @param where.home - the file's matched prefix, worded by `portHome`.
 * @returns the INW011 diagnostic.
 */
function unverifiableTarget(
  file: SourceFile,
  ref: DynamicImportRef,
  { source, outermost, home }: { source: LayerSpec; outermost: LayerSpec; home: string },
): Diagnostic {
  const message =
    `Layer "${source.name}" makes a dynamic import (${ref.via}) with an argument Inwards can't read, ` +
    "such as a variable, an f-string field or *args, so Inwards can't verify that it points toward inner layers.";
  return diagnostic(RULES.INW011, file, {
    span: ref,
    message,
    fix: {
      summary: `Name the target with string literals, or move the dynamic import to the outermost layer "${outermost.name}".`,
      steps: [
        `If the module is fixed, replace \`${ref.statement}\` with an import statement, or pass the loader only string literals (no variables, f-string fields, \\N{...} escapes or *args) so Inwards can check it.`,
        `If the module is chosen at runtime (plugins, settings), move the loader to the outermost layer "${outermost.name}" (the composition root) and pass what it loads into this module as a parameter.`,
        `Type that parameter against a typing.Protocol declared in ${home}.`,
      ],
    },
  });
}

/**
 * Reports a loader call whose bytes source Inwards can't decode.
 *
 * @param file - the calling file.
 * @param ref - the call.
 * @param encoding - the codec the source declares.
 * @returns the INW011 diagnostic.
 */
function unreadableSource(file: SourceFile, ref: DynamicImportRef, encoding: string): Diagnostic {
  const message =
    `The ${ref.via} call runs bytes that declare encoding "${encoding}", which can hide imports ` +
    "from Inwards, so the imports in that source were not checked.";
  return diagnostic(RULES.INW011, file, {
    span: ref,
    message,
    fix: {
      summary: "Replace the executed bytes with ordinary code, so its imports are checked.",
      steps: [
        `Delete \`${ref.statement}\`.`,
        "Write the code it ran as plain Python in this module or a module of the right layer.",
        "If that code needs something from an outer layer, declare a typing.Protocol in this layer and receive the implementation as a parameter.",
      ],
    },
  });
}

const LONGEST_STATEMENT = 120;

/**
 * Shortens a call's text for the fix step: whitespace runs become one space,
 * and anything past 120 characters is cut.
 *
 * @param text - the call as written.
 * @returns the text to quote.
 */
function shorten(text: string): string {
  const flat = text.replace(/\s+/gu, " ");
  return flat.length > LONGEST_STATEMENT ? `${flat.slice(0, LONGEST_STATEMENT)}...` : flat;
}
