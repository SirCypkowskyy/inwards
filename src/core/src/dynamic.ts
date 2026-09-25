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
import { allowedDirection, outwardImports, portSteps } from "./layers.ts";
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
    for (const { target, via } of loads) {
      refs.push({
        target,
        via,
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
 * itself is the problem.
 *
 * @param file - the file the imports come from.
 * @param refs - the dynamic imports found in that file.
 * @param layers - the configured layers, innermost first.
 * @returns one diagnostic per dynamic import that points outward.
 */
export function checkDynamicImports(
  file: SourceFile,
  refs: readonly DynamicImportRef[],
  layers: readonly LayerSpec[],
): Diagnostic[] {
  return outwardImports(file, refs, layers).map(({ ref, source, target }) => {
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
}

const BUILTINS_PREFIX = /^builtins\./u;

/** A module a call loads, and the call as the report names it. */
interface Load {
  target: string;
  via: string;
}

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
 * @param bindings - names bound where the call runs.
 * @returns the loaded modules, each with the loader's name; empty for any other call.
 */
function loadsOf(parser: Parser, call: Node, file: SourceFile, bindings: Bindings): Load[] {
  const fn = call.childForFieldName("function");
  const loads: Load[] = [];
  for (const qualified of new Set(fn ? qualify(fn, bindings) : [])) {
    const kind = LOADERS.get(qualified);
    if (kind) {
      const via = qualified.replace(BUILTINS_PREFIX, "");
      const targets =
        kind === "source"
          ? sourceTargets(parser, call, file, bindings)
          : moduleTargets(kind, call, file);
      loads.push(...targets.map((target) => ({ target, via })));
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
 * the code runs in. Names the caller bound stay bound inside.
 *
 * @param parser - parser with the Python grammar loaded.
 * @param call - the `call` node.
 * @param file - the calling file.
 * @param bindings - names bound in the calling file.
 * @returns the modules the source imports, empty when it isn't a literal.
 */
function sourceTargets(parser: Parser, call: Node, file: SourceFile, bindings: Bindings): string[] {
  const source = literalSource(argumentAt(call, 0, "source"));
  if (source === null) {
    return [];
  }
  const tree = parsePython(parser, normalizeSource(source));
  try {
    const nested = loadingCalls(parser, tree.rootNode, file, bindings);
    return [
      ...extractImports(tree, file).map((ref) => ref.target),
      ...nested.flatMap(({ loads }) => loads.map((load) => load.target)),
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
