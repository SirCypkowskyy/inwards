/**
 * @file One parsed file as INW012 reads it: its imports and qualifier, its
 * module-level functions and aliases, its endpoints and registrations, and a
 * per-file cache of measured bodies. The checked file and a handler's module
 * reached through a registration (`remote.ts`) are read the same way, and an
 * endpoint's bodies (its own and its helpers') come from here. It owns no
 * tree: the caller parses and frees it.
 */
import type { Node, Tree } from "web-tree-sitter";
import type { SourceFile } from "../../contracts/records.ts";
import { moduleFunctions } from "../../python/nodes.ts";
import { importedNames } from "../../python/parser.ts";
import { type Qualify, qualifierFor } from "../../python/qualify.ts";
import { moduleAliases, parameterTypes } from "../shared/annotations.ts";
import { moduleClasses, type ResolveBase } from "./classes.ts";
import { type Found, findEndpoints } from "./endpoints.ts";
import { isAbort } from "./frameworks.ts";
import { type Body, helpersOf } from "./helpers.ts";
import { measure } from "./metrics.ts";
import type { Recognise } from "./settings.ts";

/** One file, read for INW012. */
export interface FileView {
  readonly src: SourceFile;
  /** What each imported name refers to. */
  readonly names: ReadonlyMap<string, string>;
  readonly qualify: Qualify;
  /** The module's top-level functions by name. */
  readonly functions: ReadonlyMap<string, Node>;
  /** The module's top-level classes by name, which a view class in another module may extend. */
  readonly classes: ReadonlyMap<string, Node>;
  /** The file's endpoints and its registrations of other modules' handlers. */
  readonly found: Found;
  /** Reads an endpoint's own body first, then the same-module helpers it runs, in source order. */
  readonly bodies: (fn: Node, name: string) => Body[];
}

/**
 * Tells whether a statement ends the request with an error: any `raise`, or
 * a call of Flask's `abort`. Any exception counts, not only `HTTPException`:
 * an app-wide exception handler (FastAPI's `exception_handler`, DRF's
 * `EXCEPTION_HANDLER`) maps the project's own errors to HTTP, and one file
 * can't show which ones it maps. Polar's endpoints raise `ResourceNotFound`
 * and `NotPermitted` that way (#182 corpus run).
 *
 * @param statement - a statement node.
 * @param qualify - qualifies a name through the file's imports.
 * @returns true for `raise HTTPException(404)`, `raise ResourceNotFound() from e`, a bare `raise` and `abort(404)`.
 */
function mapsToHttp(statement: Node, qualify: Qualify): boolean {
  if (statement.type === "raise_statement") {
    return true;
  }
  const [first] = statement.namedChildren;
  if (statement.type !== "expression_statement" || first?.type !== "call") {
    return false;
  }
  const callee = first.childForFieldName("function");
  const name = callee ? qualify(callee) : null;
  return name !== null && isAbort(name);
}

/**
 * Reads a parsed file for INW012.
 *
 * @param tree - the file's tree, which the caller frees.
 * @param src - the file, with normalised text.
 * @param recognise - the configured decorators, base classes and frameworks.
 * @param resolveBase - resolves a view base class from another first-party module; undefined reads none.
 * @returns the file's view; bodies are measured on first use and cached.
 */
export function fileView(
  tree: Tree,
  src: SourceFile,
  recognise: Recognise,
  resolveBase: ResolveBase | undefined,
): FileView {
  const root = tree.rootNode;
  const names = importedNames(tree, src);
  const qualify = qualifierFor(names, src.module);
  const functions = moduleFunctions(root);
  const found = findEndpoints(root, {
    module: src.module,
    qualify,
    text: src.text,
    recognise,
    functions,
    resolveBase,
  });
  const types = { qualify, aliases: moduleAliases(root) };
  const measured = new Map<number, ReturnType<typeof measure>>();
  const scope = {
    functions,
    endpoints: new Set(found.endpoints.map(({ fn }) => fn.startIndex)),
    measure: (fn: Node): ReturnType<typeof measure> => {
      const cached = measured.get(fn.startIndex) ?? measure(fn, (r) => mapsToHttp(r, qualify));
      measured.set(fn.startIndex, cached);
      return cached;
    },
    paramsOf: (fn: Node): Map<string, readonly string[]> => parameterTypes(fn, types),
  };
  return {
    src,
    names,
    qualify,
    functions,
    classes: moduleClasses(root),
    found,
    /**
     * Reads an endpoint's own body and the same-module helpers it runs.
     *
     * @param fn - the endpoint's `function_definition` node.
     * @param name - its name.
     * @returns its own body first, then its helpers' in source order.
     */
    bodies: (fn: Node, name: string): Body[] => {
      const own = { fn, name, metrics: scope.measure(fn), params: scope.paramsOf(fn) };
      return [own, ...helpersOf(own, scope)];
    },
  };
}
