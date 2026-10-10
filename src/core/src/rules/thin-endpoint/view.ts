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
import { type Found, findEndpoints } from "./endpoints.ts";
import { type Body, helpersOf } from "./helpers.ts";
import { measure } from "./metrics.ts";
import { moduleAliases, parameterTypes } from "./parameters.ts";

/** One file, read for INW012. */
export interface FileView {
  readonly src: SourceFile;
  /** What each imported name refers to. */
  readonly names: ReadonlyMap<string, string>;
  readonly qualify: Qualify;
  /** The module's top-level functions by name. */
  readonly functions: ReadonlyMap<string, Node>;
  /** The file's endpoints and its registrations of other modules' handlers. */
  readonly found: Found;
  /** Reads an endpoint's own body first, then the same-module helpers it runs, in source order. */
  readonly bodies: (fn: Node, name: string) => Body[];
}

/**
 * Tells whether a `raise` maps an error to HTTP: it raises `HTTPException`
 * (FastAPI's or Starlette's, by the last part of its qualified name), called or not.
 *
 * @param raise - a `raise_statement` node.
 * @param qualify - qualifies a name through the file's imports.
 * @returns true for `raise HTTPException(404)` and `raise HTTPException(...) from e`.
 */
function raisesHttp(raise: Node, qualify: Qualify): boolean {
  const [raised] = raise.namedChildren;
  const callee = raised?.type === "call" ? raised.childForFieldName("function") : raised;
  const name = callee ? qualify(callee) : null;
  return name?.split(".").at(-1) === "HTTPException";
}

/**
 * Reads a parsed file for INW012.
 *
 * @param tree - the file's tree, which the caller frees.
 * @param src - the file, with normalised text.
 * @param decorators - the configured `decorators` patterns.
 * @returns the file's view; bodies are measured on first use and cached.
 */
export function fileView(tree: Tree, src: SourceFile, decorators: readonly string[]): FileView {
  const root = tree.rootNode;
  const names = importedNames(tree, src);
  const qualify = qualifierFor(names, src.module);
  const functions = moduleFunctions(root);
  const found = findEndpoints(root, {
    module: src.module,
    qualify,
    text: src.text,
    decorators,
    functions,
  });
  const types = { qualify, aliases: moduleAliases(root) };
  const measured = new Map<number, ReturnType<typeof measure>>();
  const scope = {
    functions,
    endpoints: new Set(found.endpoints.map(({ fn }) => fn.startIndex)),
    measure: (fn: Node): ReturnType<typeof measure> => {
      const cached = measured.get(fn.startIndex) ?? measure(fn, (r) => raisesHttp(r, qualify));
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
