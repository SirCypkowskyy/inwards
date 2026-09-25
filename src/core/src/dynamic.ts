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
 * Aliases are resolved in `callees.ts`, literals are read in `literals.ts`.
 *
 * Not read: targets computed at runtime, and literals that use a `\N{...}`
 * escape (decoding those needs the Unicode name table).
 */
import type { Node, Parser, Tree } from "web-tree-sitter";
import {
  type Bindings,
  builtinBindings,
  collectBindings,
  LOADERS,
  type LoaderKind,
  qualify,
  syntaxOf,
} from "./callees.ts";
import type { LayerSpec } from "./config.ts";
import { unreadableEncoding } from "./encoding.ts";
import { allowedDirection, layerIndexOf, outwardImports, portSteps } from "./layers.ts";
import {
  argumentAt,
  identifierName,
  integerLiteral,
  literalSource,
  literalString,
  namedChildren,
} from "./literals.ts";
import {
  extractImports,
  normalizeSource,
  packageOf,
  parsePython,
  resolveRelative,
} from "./python.ts";
import { diagnostic, RULES } from "./rules.ts";
import type { Diagnostic, ImportRef, SourceFile } from "./types.ts";

/** An import made by a call rather than an import statement. */
export interface DynamicImportRef extends ImportRef {
  /** The loading call as written in the report, e.g. `importlib.import_module` or `exec`. */
  via: string;
  /**
   * The codec a bytes source for `exec` or `compile` declares when Inwards
   * can't read it (PEP 263, as for files); `target` is then empty. Null otherwise.
   */
  unreadable: string | null;
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
 * @returns one entry per loaded module, in source order.
 */
export function extractDynamicImports(
  parser: Parser,
  tree: Tree,
  file: SourceFile,
): DynamicImportRef[] {
  const base = builtinBindings();
  const refs: DynamicImportRef[] = [];
  for (const { call, loads } of loadingCalls(parser, tree.rootNode, file, base)) {
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
  if (layerIndexOf(file.module, layers) === -1) {
    return outward;
  }
  const unreadable = refs.flatMap((ref) =>
    ref.unreadable === null ? [] : [unreadableSource(file, ref, ref.unreadable)],
  );
  return [...outward, ...unreadable];
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
interface Load {
  target: string;
  via: string;
  /** Set instead of `target` when the call's bytes source can't be read. */
  unreadable: string | null;
}

/** What a loader call loads, before the loader's name is attached. */
type Loaded = Omit<Load, "via">;

/**
 * Finds the loading calls under a node and what each one loads.
 * Recurses into literal `exec` sources, whose loads are reported at the
 * outer call and named after it.
 *
 * @param parser - parser with the Python grammar loaded.
 * @param root - the module node to search.
 * @param file - the file being checked.
 * @param outer - names bound before this code runs (the builtins, or the caller of `exec`).
 * @returns each call that loads something, with its loads.
 */
function loadingCalls(
  parser: Parser,
  root: Node,
  file: SourceFile,
  outer: Bindings,
): { call: Node; loads: Load[] }[] {
  const syntax = syntaxOf(root);
  const bindings = collectBindings(syntax, outer);
  const found: { call: Node; loads: Load[] }[] = [];
  for (const call of syntax) {
    const loads = call.type === "call" ? loadsOf(parser, call, file, bindings) : [];
    if (loads.length > 0) {
      found.push({ call, loads });
    }
  }
  return found;
}

/**
 * Lists what one call loads, if its callee is a loader.
 *
 * @param parser - parser with the Python grammar loaded.
 * @param call - a `call` node.
 * @param file - the file being checked.
 * @param bindings - what names mean in the calling module.
 * @returns the loaded modules, each with the loader's name; empty for any other call.
 */
function loadsOf(parser: Parser, call: Node, file: SourceFile, bindings: Bindings): Load[] {
  const fn = call.childForFieldName("function");
  const loads: Load[] = [];
  for (const qualified of new Set(fn ? qualify(fn, bindings) : [])) {
    const kind = LOADERS.get(qualified);
    if (kind) {
      const via = qualified.replace(BUILTINS_PREFIX, "");
      const loaded: Loaded[] =
        kind === "source"
          ? sourceTargets(parser, call, file, bindings)
          : moduleTargets(kind, call, file).map((target) => ({ target, unreadable: null }));
      loads.push(...loaded.map((load) => ({ ...load, via })));
    }
  }
  return loads;
}

/**
 * Resolves the module an `import_module`, `__import__` or `run_module` call loads.
 *
 * @param kind - which loader the call is.
 * @param call - the `call` node.
 * @param file - the calling file, for relative names.
 * @returns the loaded modules, empty when the target is not a literal.
 */
function moduleTargets(kind: LoaderKind, call: Node, file: SourceFile): string[] {
  switch (kind) {
    case "import_module":
      return importModuleTargets(call, file);
    case "__import__":
      return dunderImportTargets(call, file);
    case "run_module": {
      const name = literalString(argumentAt(call, 0, "mod_name"));
      return name && !name.startsWith(".") ? [name] : [];
    }
    default:
      return [];
  }
}

const LEADING_DOTS = /^\.*/u;

/**
 * Resolves `importlib.import_module(name, package)`.
 * A relative name needs its package as a literal, `__package__` or `__name__`,
 * as it does at runtime; without one the call is skipped.
 *
 * @param call - the `call` node.
 * @param file - the calling file.
 * @returns the loaded module, or nothing when it can't be resolved.
 */
function importModuleTargets(call: Node, file: SourceFile): string[] {
  const name = literalString(argumentAt(call, 0, "name"));
  if (!name) {
    return [];
  }
  const level = LEADING_DOTS.exec(name)?.[0].length ?? 0;
  if (level === 0) {
    return [name];
  }
  const pkg = packageArgument(argumentAt(call, 1, "package"), file);
  const target = pkg ? resolveRelative(pkg, level, name.slice(level) || undefined) : null;
  return target ? [target] : [];
}

/**
 * Reads the `package` argument of `import_module` as name parts.
 *
 * @param node - the argument, if given.
 * @param file - the calling file, which `__package__` and `__name__` refer to.
 * @returns the package split into parts, or null when it isn't known statically.
 */
function packageArgument(node: Node | null, file: SourceFile): string[] | null {
  if (node?.type === "identifier") {
    const name = identifierName(node);
    if (name === "__package__") {
      return packageOf(file);
    }
    return name === "__name__" ? file.module.split(".") : null;
  }
  const pkg = literalString(node);
  return pkg ? pkg.split(".") : null;
}

/** Positions of `fromlist` and `level` in `__import__(name, globals, locals, fromlist, level)`. */
const DUNDER_FROMLIST = 3;
const DUNDER_LEVEL = 4;

/**
 * Resolves `__import__(name, globals, locals, fromlist, level)`.
 * The call imports `name`, and with a literal `fromlist` also `name.x` for each
 * entry, as `from name import x` does. A positive literal `level` resolves
 * `name` against the calling file's package; a computed one skips the call.
 *
 * @param call - the `call` node.
 * @param file - the calling file.
 * @returns the loaded modules.
 */
function dunderImportTargets(call: Node, file: SourceFile): string[] {
  const name = literalString(argumentAt(call, 0, "name"));
  const levelNode = argumentAt(call, DUNDER_LEVEL, "level");
  const level = levelNode ? integerLiteral(levelNode) : 0;
  if (name === null || level === null) {
    return [];
  }
  const base = level > 0 ? resolveRelative(packageOf(file), level, name || undefined) : name;
  if (!base) {
    return [];
  }
  const fromlist = argumentAt(call, DUNDER_FROMLIST, "fromlist");
  const names =
    fromlist && ["list", "tuple"].includes(fromlist.type) ? namedChildren(fromlist) : [];
  const members = names.flatMap((n) => {
    const entry = literalString(n);
    return entry && entry !== "*" ? [`${base}.${entry}`] : [];
  });
  return [base, ...members];
}

/**
 * Lists the imports made by the literal source of `exec`, `eval` or `compile`.
 * The source is parsed as Python. Its import statements and its own dynamic
 * imports count; relative ones resolve against the calling file, whose globals
 * the code runs in. Names the caller bound stay bound inside. Bytes are
 * decoded as CPython does: a PEP 263 declaration counts, and a codec Inwards
 * can't read makes the whole source unreadable.
 *
 * @param parser - parser with the Python grammar loaded.
 * @param call - the `call` node.
 * @param file - the calling file.
 * @param bindings - names bound in the calling file.
 * @returns the modules the source imports, empty when it isn't a literal.
 */
function sourceTargets(parser: Parser, call: Node, file: SourceFile, bindings: Bindings): Loaded[] {
  const source = literalSource(argumentAt(call, 0, "source"));
  if (source === null) {
    return [];
  }
  const text = normalizeSource(source.text);
  const unreadable = source.bytes ? unreadableEncoding(text) : null;
  if (unreadable !== null) {
    return [{ target: "", unreadable }];
  }
  const tree = parsePython(parser, text);
  try {
    const nested = loadingCalls(parser, tree.rootNode, file, bindings);
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
