/**
 * @file Finds the handler a route registration names in another first-party
 * module, for INW012 (#271): `router.add_api_route("/x", views.create_order)`
 * leads through `ProjectIndex` to `create_order` in `shop/api/views.py`,
 * following re-exports (`from .views import create_order` in an
 * `__init__.py`) up to `MAX_HOPS` times. A module is read and parsed only
 * when a registration names it, once per check of the registering file, and
 * every tree is freed by `dispose()`. A handler that isn't first-party, isn't
 * a module-level function, or is an endpoint in its own module (where its
 * own check reports it) is not returned. It also tells what kind of view a
 * base class from another first-party module is (#270), through that
 * module's own bases.
 */
import type { Node, Parser, Tree } from "web-tree-sitter";
import type { ProjectIndex } from "../../lookup/project-index.ts";
import { normalizeSource, parsePython } from "../../python/parser.ts";
import { viewKind } from "./classes.ts";
import { frameworksIn, type ViewKind } from "./frameworks.ts";
import { nameMatcher, type Recognise } from "./settings.ts";
import { type FileView, fileView } from "./view.ts";

/** How many re-exports a handler's name is followed through (a re-export cycle ends here). */
const MAX_HOPS = 4;

/** A handler in another module, and that module read for INW012. */
export interface RemoteHandler {
  readonly view: FileView;
  /** The handler's `function_definition` node. */
  readonly fn: Node;
  /** Its name in its own module. */
  readonly name: string;
}

/**
 * The other modules one file's registrations name, parsed on demand. Build
 * one per check of a file and call `dispose()` when done.
 */
export class RemoteModules {
  private readonly parser: Parser;
  private readonly project: ProjectIndex;
  private readonly recognise: Recognise;
  private readonly trees: Tree[] = [];
  private readonly views = new Map<string, FileView>();
  /** The base classes being resolved, which ends an inheritance cycle across modules. */
  private readonly resolving = new Set<string>();

  /**
   * Wraps the parser and the project index. Nothing is read yet.
   *
   * @param parser - parser with the Python grammar loaded.
   * @param project - the project's module index, which reads files on demand.
   * @param recognise - the configured decorators, base classes and frameworks, so a handler module's own endpoints are known.
   */
  constructor(parser: Parser, project: ProjectIndex, recognise: Recognise) {
    this.parser = parser;
    this.project = project;
    this.recognise = recognise;
  }

  /**
   * Finds the module-level function a qualified name refers to in a
   * first-party module, following re-exports.
   *
   * @param target - the handler's qualified name, e.g. `shop.api.views.create_order`.
   * @returns the handler and its module, or null when it isn't a first-party
   *   function or its own module already treats it as an endpoint.
   */
  resolve(target: string): RemoteHandler | null {
    const found = this.follow(target, (module, member) => module.functions.get(member));
    if (found === undefined) {
      return null;
    }
    const { view, node: fn, rest } = found;
    const own = view.found.endpoints.some((e) => e.fn.startIndex === fn.startIndex);
    return own ? null : { view, fn, name: rest };
  }

  /**
   * Tells what kind of view a first-party class is, from its own bases in
   * its own module, following re-exports.
   *
   * @param target - the class's qualified name, e.g. `shop.api.base.BaseView`.
   * @returns the kind, or undefined when it is no view, isn't first-party, or is already being resolved.
   */
  baseKind(target: string): ViewKind | undefined {
    if (this.resolving.has(target)) {
      return undefined;
    }
    this.resolving.add(target);
    try {
      const found = this.follow(target, (module, member) => module.classes.get(member));
      if (found === undefined) {
        return undefined;
      }
      const { view, node } = found;
      return viewKind(node, view.classes, {
        module: view.src.module,
        qualify: view.qualify,
        active: frameworksIn(view.src.text, this.recognise.frameworks),
        custom: nameMatcher(this.recognise.baseClasses),
        resolveBase: (q: string): ViewKind | undefined => this.baseKind(q),
      });
    } finally {
      this.resolving.delete(target);
    }
  }

  /**
   * Finds a module-level definition by qualified name in a first-party
   * module, following re-exports up to \`MAX_HOPS\` times.
   *
   * @param target - the qualified name.
   * @param pick - finds the definition by its name in a module.
   * @returns the module, the node and its name there, or undefined.
   */
  private follow(
    target: string,
    pick: (view: FileView, rest: string) => Node | undefined,
  ): { view: FileView; node: Node; rest: string } | undefined {
    let name = target;
    for (let hop = 0; hop < MAX_HOPS; hop += 1) {
      const owner = this.project.ownerOf(name);
      const view = owner === undefined ? undefined : this.viewOf(owner);
      const rest = owner === undefined ? "" : name.slice(owner.length + 1);
      if (view === undefined || rest === "" || rest.includes(".")) {
        return undefined;
      }
      const node = pick(view, rest);
      if (node) {
        return { view, node, rest };
      }
      const next = view.names.get(rest);
      if (next === undefined) {
        return undefined;
      }
      name = next;
    }
    return undefined;
  }

  /** Frees every tree read so far; the views and nodes handed out are invalid afterwards. */
  dispose(): void {
    for (const tree of this.trees) {
      tree.delete(); // WASM memory is not garbage collected
    }
    this.trees.length = 0;
    this.views.clear();
  }

  /**
   * Reads and parses a first-party module once.
   *
   * @param module - a dotted module name.
   * @returns its view, or undefined when no file holds it.
   */
  private viewOf(module: string): FileView | undefined {
    const cached = this.views.get(module);
    if (cached !== undefined) {
      return cached;
    }
    const src = this.project.sourceOf(module);
    if (src === undefined) {
      return undefined;
    }
    const text = normalizeSource(src.text);
    const tree = parsePython(this.parser, text);
    this.trees.push(tree);
    const view = fileView(
      tree,
      { ...src, text },
      this.recognise,
      (q: string): ViewKind | undefined => this.baseKind(q),
    );
    this.views.set(module, view);
    return view;
  }
}
