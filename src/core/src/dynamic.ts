/**
 * INW011: dynamic imports with string-literal targets.
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
 * - `runpy.run_module(mod_name)`;
 * - `exec`, `eval` and `compile` with a literal source: the source is parsed
 *   as Python, and every import in it, static or dynamic, counts at the call.
 *
 * Aliases are resolved in `callees.ts`, literals are read in `literals.ts`,
 * the targets of module loaders in `loader-targets.ts`.
 *
 * A target Inwards can't read (a variable, an f-string field, a literal with a
 * `\N{...}` escape, whose decoding needs the Unicode name table, or a relative
 * `import_module` whose `package` isn't known) makes the call unverifiable. It
 * is reported in every layer but the outermost, which may import anything
 * first-party. `compile` is the exception: it only builds a code object, and
 * running that takes `exec` or `eval`, which are reported themselves.
 */
import type { Node, Parser, Tree } from "web-tree-sitter";
import {
  type Bindings,
  builtinBindings,
  collectBindings,
  LOADERS,
  qualify,
  syntaxOf,
} from "./callees.ts";
import { computedSource } from "./computed-source.ts";
import type { LayerSpec } from "./config.ts";
import { unreadableEncoding } from "./encoding.ts";
import { allowedDirection, layerIndexOf, outwardImports, portSteps } from "./layers.ts";
import { argumentAt, literalSource } from "./literals.ts";
import { type Loaded, moduleTargets, type Unreadable } from "./loader-targets.ts";
import { extractImports, normalizeSource, parsePython } from "./python.ts";
import { diagnostic, RULES } from "./rules.ts";
import type { Diagnostic, ImportRef, SourceFile } from "./types.ts";
import type { ModuleLookup } from "./unassigned.ts";

/** What the loader search needs besides the tree. */
interface Reader {
  /** Parser with the Python grammar loaded, for literal `exec` sources. */
  parser: Parser;
  /** Finds the first-party module an import lands in (see `computedSource`). */
  ownerOf: ModuleLookup;
}

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
 * `compile`, `__import__`, `__builtins__`) or bound by an import statement,
 * which spells `importlib`, `runpy` or `builtins`. Import statements can't use
 * escapes, and identifiers are NFKC-normalised before the test, so any file
 * `extractDynamicImports` finds something in matches this pattern.
 * `re.compile` does not match: a builtin reached through a dot needs `builtins`.
 */
const LOADER_HINT = /importlib|runpy|builtins|__import__|(?<![\w.])(?:exec|eval|compile)(?!\w)/u;
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
          ...portSteps(source, target, ref),
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
    return why?.kind === "computed" && inner ? [unverifiableTarget(file, ref, own, outermost)] : [];
  });
  return [...outward, ...unreadable];
}

/**
 * Reports a loader call in an inner layer whose target Inwards can't read.
 *
 * @param file - the calling file.
 * @param ref - the call.
 * @param source - the layer the file belongs to, not the outermost.
 * @param outermost - the outermost layer, where the loader may live.
 * @returns the INW011 diagnostic.
 */
function unverifiableTarget(
  file: SourceFile,
  ref: DynamicImportRef,
  source: LayerSpec,
  outermost: LayerSpec,
): Diagnostic {
  const home = source.modules[0] ?? source.name;
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
        `Type that parameter against a typing.Protocol declared in \`${home}\` (for example \`${home}.ports\`).`,
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

const BUILTINS_PREFIX = /^builtins\./u;

/** A module a call loads, and the call as the report names it. */
interface Load extends Loaded {
  via: string;
}

/**
 * Finds the loading calls under a node and what each one loads.
 * Recurses into literal `exec` sources, whose loads are reported at the
 * outer call and named after it.
 *
 * @param reader - the parser and the first-party lookup.
 * @param root - the module node to search.
 * @param file - the file being checked.
 * @param outer - names bound before this code runs (the builtins, or the caller of `exec`).
 * @returns each call that loads something, with its loads.
 */
function loadingCalls(
  reader: Reader,
  root: Node,
  file: SourceFile,
  outer: Bindings,
): { call: Node; loads: Load[] }[] {
  const syntax = syntaxOf(root);
  const bindings = collectBindings(syntax, outer);
  const found: { call: Node; loads: Load[] }[] = [];
  for (const call of syntax) {
    const loads = call.type === "call" ? loadsOf(reader, call, file, bindings) : [];
    if (loads.length > 0) {
      found.push({ call, loads });
    }
  }
  return found;
}

/**
 * Lists what one call loads, if its callee is a loader.
 *
 * @param reader - the parser and the first-party lookup.
 * @param call - a `call` node.
 * @param file - the file being checked.
 * @param bindings - what names mean in the calling module.
 * @returns the loaded modules, each with the loader's name; empty for any other call.
 */
function loadsOf(reader: Reader, call: Node, file: SourceFile, bindings: Bindings): Load[] {
  const fn = call.childForFieldName("function");
  const loads: Load[] = [];
  for (const qualified of new Set(fn ? qualify(fn, bindings) : [])) {
    const kind = LOADERS.get(qualified);
    if (kind) {
      const via = qualified.replace(BUILTINS_PREFIX, "");
      const loaded =
        kind === "source"
          ? (sourceTargets(reader, call, file, bindings) ??
            computedSource(call, via, bindings, reader.ownerOf))
          : moduleTargets(kind, call, file);
      loads.push(...loaded.map((load) => ({ ...load, via })));
    }
  }
  // A name bound to two loaders would report the same load twice.
  const unique = new Map<string, Load>();
  for (const load of loads) {
    const key = `${load.target} ${load.unreadable?.kind ?? ""}`;
    unique.set(key, unique.get(key) ?? load);
  }
  return [...unique.values()];
}

/**
 * Lists the imports made by the literal source of `exec`, `eval` or `compile`.
 * The source is parsed as Python. Its import statements and its own dynamic
 * imports count; relative ones resolve against the calling file, whose globals
 * the code runs in. Names the caller bound stay bound inside. Bytes are
 * decoded as CPython does: a PEP 263 declaration counts, and a codec Inwards
 * can't read makes the whole source unreadable.
 *
 * @param reader - the parser and the first-party lookup.
 * @param call - the `call` node.
 * @param file - the calling file.
 * @param bindings - names bound in the calling file.
 * @returns the modules the source imports, or null when the source isn't a literal.
 */
function sourceTargets(
  reader: Reader,
  call: Node,
  file: SourceFile,
  bindings: Bindings,
): Loaded[] | null {
  const source = literalSource(argumentAt(call, 0, "source"));
  if (source === null) {
    return null;
  }
  const text = normalizeSource(source.text);
  const encoding = source.bytes ? unreadableEncoding(text) : null;
  if (encoding !== null) {
    return [{ target: "", unreadable: { kind: "encoding", encoding } }];
  }
  const tree = parsePython(reader.parser, text);
  try {
    const nested = loadingCalls(reader, tree.rootNode, file, bindings);
    return [
      ...extractImports(tree, file).map((ref) => ({ target: ref.target, unreadable: null })),
      ...nested.flatMap(({ loads }) =>
        loads.map(({ target, unreadable: inner }) => ({ target, unreadable: inner })),
      ),
    ];
  } finally {
    tree.delete(); // WASM memory is not garbage collected
  }
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
