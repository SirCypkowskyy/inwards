/**
 * @file Finds the loading calls in a module and what each one loads, for INW011.
 * It resolves each callee through the bindings (`callees.ts`, plus names bound
 * inside literal `exec` sources), unwraps `functools.partial(loader, ...)`,
 * and reads the targets with `loader-targets.ts`, or parses a constant
 * `exec`, `eval` or `compile` source and searches it the same way. Reporting
 * is `imports.ts`'s job.
 */
import type { Node, Parser } from "web-tree-sitter";
import type { SourceFile } from "../../contracts/records.ts";
import type { ModuleLookup } from "../../lookup/module-lookup.ts";
import { unreadableEncoding } from "../../python/encoding.ts";
import { argumentAt, type Constants, literalSource } from "../../python/literals.ts";
import { namedChildren } from "../../python/nodes.ts";
import { extractImports, normalizeSource, parsePython } from "../../python/parser.ts";
import { type Bindings, collectBindings, qualify, syntaxOf } from "./callees.ts";
import { computedSource } from "./computed-source.ts";
import { moduleConstants } from "./constants.ts";
import { type Loaded, type LoaderCall, loaderArgument, moduleTargets } from "./loader-targets.ts";
import { LOADERS, PARTIAL } from "./loaders.ts";

/** What the loader search needs besides the tree. */
export interface Reader {
  /** Parser with the Python grammar loaded, for literal `exec` sources. */
  parser: Parser;
  /** Finds the first-party module an import lands in (see `computedSource`). */
  ownerOf: ModuleLookup;
}

const BUILTINS_PREFIX = /^builtins\./u;

/** A module a call loads, and the call as the report names it. */
export interface Load extends Loaded {
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
export function loadingCalls(
  reader: Reader,
  root: Node,
  file: SourceFile,
  outer: Bindings,
): { call: Node; loads: Load[] }[] {
  const syntax = syntaxOf(root);
  const bindings = bindingsIn(reader, syntax, outer);
  let known: Constants | undefined;
  /**
   * Lists the module's constants the first time a call needs them.
   *
   * @returns the constants of the module under `root`.
   */
  function constants(): Constants {
    known ??= moduleConstants(root, syntax, bindings);
    return known;
  }
  const scope: Scope = { reader, file, bindings, constants };
  const found: { call: Node; loads: Load[] }[] = [];
  for (const call of syntax) {
    const loads = call.type === "call" ? loadsOf(scope, call) : [];
    if (loads.length > 0) {
      found.push({ call, loads });
    }
  }
  return found;
}

/**
 * Collects the names a module binds, including those bound by the literal
 * source of an `exec` or `eval` call, which runs in the module's namespace:
 * after `exec("from importlib import import_module as im")`, `im` is a loader.
 *
 * @param reader - the parser and the first-party lookup.
 * @param syntax - the module's nodes, as `syntaxOf` returns them.
 * @param outer - names bound before this code runs.
 * @returns the module's bindings.
 */
function bindingsIn(reader: Reader, syntax: readonly Node[], outer: Bindings): Bindings {
  const own = collectBindings(syntax, outer);
  let learned = own;
  for (const call of syntax) {
    const fn = call.type === "call" ? call.childForFieldName("function") : null;
    const runs = fn
      ? qualify(fn, own).some((q) => q === "builtins.exec" || q === "builtins.eval")
      : false;
    const source = runs ? literalSource(argumentAt(call, 0, "source")) : null;
    const text = source ? normalizeSource(source.text) : null;
    if (source && text !== null && !(source.bytes && unreadableEncoding(text) !== null)) {
      const tree = parsePython(reader.parser, text);
      try {
        learned = bindingsIn(reader, syntaxOf(tree.rootNode), learned);
      } finally {
        tree.delete(); // WASM memory is not garbage collected
      }
    }
  }
  return learned === own ? own : collectBindings(syntax, learned);
}

/** What reading a loading call needs to know about the module it sits in. */
interface Scope {
  /** The parser and the first-party lookup. */
  reader: Reader;
  /** The file being checked. */
  file: SourceFile;
  /** What names mean in the module. */
  bindings: Bindings;
  /** The module's constants, worked out on first use. */
  constants: () => Constants;
}

/**
 * Lists what one call loads, if its callee is a loader or a `functools.partial`
 * that binds a loader's arguments.
 *
 * @param scope - the module the call sits in.
 * @param call - a `call` node.
 * @returns the loaded modules, each with the loader's name; empty for any other call.
 */
function loadsOf(scope: Scope, call: Node): Load[] {
  const loads: Load[] = [];
  const seen = new Set<string>();
  for (const { qualified, skip } of loadersOf(call, scope.bindings)) {
    const kind = LOADERS.get(qualified);
    if (kind && !seen.has(qualified)) {
      seen.add(qualified);
      const via = qualified.replace(BUILTINS_PREFIX, "");
      const loader: LoaderCall = { node: call, skip, constants: scope.constants };
      const loaded =
        kind === "source"
          ? (sourceTargets(scope, loader) ??
            computedSource(loader, via, scope.bindings, scope.reader.ownerOf))
          : moduleTargets(kind, loader, scope.file);
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
 * Lists what a call's callee may be, and for `functools.partial(f, ...)` with
 * arguments bound, what `f` may be, read one argument further along.
 *
 * @param call - a `call` node.
 * @param bindings - what names mean in the module.
 * @returns each possible callee with the number of arguments ahead of its own.
 */
function loadersOf(call: Node, bindings: Bindings): { qualified: string; skip: number }[] {
  const fn = call.childForFieldName("function");
  const list = call.childForFieldName("arguments");
  // `partial(loader)` alone is the loader itself (see `qualify`); with arguments it is a call
  const bound = list !== null && namedChildren(list).length > 1;
  return (fn ? qualify(fn, bindings) : []).flatMap((qualified) => {
    const wrapped = qualified === PARTIAL && bound ? argumentAt(call, 0, "") : null;
    const inner = wrapped ? qualify(wrapped, bindings).map((q) => ({ qualified: q, skip: 1 })) : [];
    return [{ qualified, skip: 0 }, ...inner];
  });
}

/**
 * Lists the imports made by the constant source of `exec`, `eval` or `compile`.
 * The source is parsed as Python. Its import statements and its own dynamic
 * imports count; relative ones resolve against the calling file, whose globals
 * the code runs in. Names the caller bound stay bound inside. Bytes are
 * decoded as CPython does: a PEP 263 declaration counts, and a codec Inwards
 * can't read makes the whole source unreadable.
 *
 * @param scope - the calling module.
 * @param call - the loading call.
 * @returns the modules the source imports, or null when the source isn't a constant.
 */
function sourceTargets(scope: Scope, call: LoaderCall): Loaded[] | null {
  const { reader, file, bindings } = scope;
  const node = loaderArgument(call, 0, "source");
  const source = literalSource(node) ?? (node ? literalSource(node, call.constants()) : null);
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
