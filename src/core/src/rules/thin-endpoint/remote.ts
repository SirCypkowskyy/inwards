/**
 * @file Finds the handler a route registration names in another first-party
 * module, for INW012 (#271): `router.add_api_route("/x", views.create_order)`
 * leads through `ProjectIndex` to `create_order` in `shop/api/views.py`,
 * following re-exports (`from .views import create_order` in an
 * `__init__.py`). Reading and parsing those modules, once per run, is
 * `rules/shared/first-party.ts`'s job; this reads them
 * as INW012's file views. A handler that isn't first-party, isn't a
 * module-level function, or is an endpoint in its own module (where its own
 * check reports it) is not returned. It also tells what kind of view a base
 * class from another first-party module is (#270), through that module's own
 * bases.
 */
import type { Node } from "web-tree-sitter";
import { type ModuleTrees, ParsedModules } from "../shared/first-party.ts";
import { nameMatcher } from "../shared/name-patterns.ts";
import { viewKind } from "./classes.ts";
import { frameworksIn, type ViewKind } from "./frameworks.ts";
import type { Recognise } from "./settings.ts";
import { type FileView, fileView } from "./view.ts";

/** A handler in another module, and that module read for INW012. */
export interface RemoteHandler {
  readonly view: FileView;
  /** The handler's `function_definition` node. */
  readonly fn: Node;
  /** Its name in its own module. */
  readonly name: string;
}

/**
 * The other modules one file's registrations name, read on demand. Build
 * one per check of a file.
 */
export class RemoteModules {
  private readonly modules: ParsedModules<FileView>;
  private readonly recognise: Recognise;
  /** The base classes being resolved, which ends an inheritance cycle across modules. */
  private readonly resolving = new Set<string>();

  /**
   * Wraps the run's first-party modules. Nothing is read yet.
   *
   * @param project - the run's first-party modules, parsed once each.
   * @param recognise - the configured decorators, base classes and frameworks, so a handler module's own endpoints are known.
   */
  constructor(project: ModuleTrees, recognise: Recognise) {
    this.recognise = recognise;
    this.modules = new ParsedModules(
      project,
      (tree, src): FileView =>
        fileView(tree, src, recognise, (q: string): ViewKind | undefined => this.baseKind(q)),
    );
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
    const found = this.modules.follow(target, (module, member) => module.functions.get(member));
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
      const found = this.modules.follow(target, (module, member) => module.classes.get(member));
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
}
