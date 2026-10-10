/**
 * @file Follows INW013 one hop out of an `async def` (#294): a call to a
 * first-party plain `def` runs that function's body on the event loop, so a
 * blocking call in it blocks the loop as surely as one written in the
 * `async def`. The helper is a top-level function of the checked module, or
 * of another first-party module the call's name resolves to through the
 * project index and its re-exports. Its receivers are its module's, its own
 * annotations', and the receivers the caller passes it by bare name.
 *
 * Only one hop, and nothing that doesn't run the body on the loop: an
 * awaited call, an `async def` helper (INW013 checks it itself), a decorated
 * helper (the decorator may move it off the loop), and a function handed to
 * a worker thread (`run_in_threadpool(f, x)` calls nothing). Another module
 * is read only when `follow-modules` matches it, or when it is a package
 * `__init__.py` a re-export passes through, and each once per check of the
 * file. It owns the trees it parses and frees them in `dispose()`.
 */
import type { Node, Parser } from "web-tree-sitter";
import { entryReach, matchEntry } from "../../config/layer-selector.ts";
import { identifierName } from "../../python/nodes.ts";
import { parameterTypes } from "../shared/annotations.ts";
import { passedNames } from "../shared/arguments.ts";
import { type FirstPartySource, ParsedModules } from "../shared/first-party.ts";
import type { Family } from "./catalog.ts";
import { functionReceivers, type Source } from "./receivers.ts";
import { type Blocking, blockingCall, callsIn, isAsync, type Walk, walkOf } from "./walk.ts";

/** A sync helper one hop away that holds blocking calls. */
export interface Hop {
  /** The call in the `async def`. */
  readonly call: Node;
  /** The call's callee as written, e.g. `users.create_user`. */
  readonly written: string;
  /** The helper's name in its own module. */
  readonly name: string;
  /** The helper's `function_definition` node. */
  readonly fn: Node;
  /** The helper's file, when it isn't the checked one. */
  readonly path: string | undefined;
  /** The blocking calls the helper's body runs, in source order. */
  readonly blocking: readonly Blocking[];
}

/** Which modules one hop may read. */
export interface FollowScope {
  /** The project, which finds and reads first-party modules. */
  readonly project: FirstPartySource;
  /** `follow-modules`: the modules followed into, or undefined for every first-party one. */
  readonly modules: readonly string[] | undefined;
}

/**
 * Tells whether a module may be followed into under `follow-modules`.
 *
 * @param module - a dotted module name.
 * @param entries - `follow-modules`, or undefined for every module.
 * @returns true when no list is set or an entry matches the module.
 */
function followed(module: string, entries: readonly string[] | undefined): boolean {
  return entries === undefined || entries.some((entry) => matchEntry(entry, module) !== undefined);
}

/**
 * Tells whether a module may be read on the way to a helper: one
 * `follow-modules` matches, or a package one of its entries could match
 * something below, whose `__init__.py` may re-export the helper.
 *
 * @param module - a dotted module name.
 * @param entries - `follow-modules`, or undefined for every module.
 * @returns false for a module no entry can reach.
 */
function onTheWay(module: string, entries: readonly string[] | undefined): boolean {
  const segments = module.split(".");
  return (
    followed(module, entries) ||
    (entries ?? []).some((entry) => entryReach(entry, segments) === "descend")
  );
}

/**
 * Tells whether a function's body runs on the caller's loop when it is
 * called: a plain, undecorated `def`.
 *
 * @param fn - a `function_definition` node.
 * @returns false for an `async def` or a decorated function.
 */
function runsInline(fn: Node): boolean {
  return !isAsync(fn) && fn.parent?.type !== "decorated_definition";
}

/**
 * The sync helpers the `async def`s of one checked file call, read on
 * demand. Build one per check of a file and call `dispose()` when done.
 */
export class Helpers {
  private readonly walk: Walk;
  private readonly scope: FollowScope;
  private readonly modules: ParsedModules<Walk>;

  /**
   * Wraps the checked file's walk and what following may read. Nothing is read yet.
   *
   * @param parser - parser with the Python grammar loaded.
   * @param walk - the checked file.
   * @param scope - the project and `follow-modules`.
   */
  constructor(parser: Parser, walk: Walk, scope: FollowScope) {
    this.walk = walk;
    this.scope = scope;
    const families: readonly Family[] = walk.families;
    this.modules = new ParsedModules(
      parser,
      scope.project,
      (tree, src): Walk => walkOf(tree, src, families),
      (module: string): boolean => onTheWay(module, scope.modules),
    );
  }

  /**
   * Reads one call in an `async def`: a call to a first-party sync helper
   * that holds blocking calls, or nothing.
   *
   * @param call - a `call` node the `async def`'s body runs.
   * @param receivers - the `async def`'s receivers, which it may pass to the helper.
   * @param shadowed - the `async def`'s parameter names, which hide module functions.
   * @returns the hop, or undefined.
   */
  hopAt(
    call: Node,
    receivers: ReadonlyMap<string, Source>,
    shadowed: ReadonlySet<string>,
  ): Hop | undefined {
    const callee = call.childForFieldName("function");
    if (call.parent?.type === "await" || !callee) {
      return undefined;
    }
    const target = this.helperOf(callee, shadowed);
    if (target === undefined || !runsInline(target.fn)) {
      return undefined;
    }
    const { fn, name, walk } = target;
    const body = fn.childForFieldName("body");
    const params = [...parameterTypes(fn, walk.context).keys()];
    const passed = passedNames(call, params, (arg) => receivers.get(arg));
    const own = functionReceivers(fn, walk, passed);
    const blocking = (body ? callsIn(body) : []).flatMap((inner) => {
      const found = blockingCall(inner, own, walk);
      return found ? [found] : [];
    });
    if (blocking.length === 0) {
      return undefined;
    }
    const path = walk === this.walk ? undefined : walk.src.path;
    return { call, written: callee.text, name, fn, path, blocking };
  }

  /**
   * Finds the function a callee names: a top-level function of the checked
   * module called by bare name, or one another first-party module defines.
   *
   * @param callee - the call's `function` node.
   * @param shadowed - names that hide the checked module's functions.
   * @returns the function, its name and its module, or undefined.
   */
  private helperOf(
    callee: Node,
    shadowed: ReadonlySet<string>,
  ): { fn: Node; name: string; walk: Walk } | undefined {
    const own = this.walk;
    if (callee.type === "identifier") {
      const name = identifierName(callee);
      const fn = shadowed.has(name) ? undefined : own.functions.get(name);
      if (fn) {
        return { fn, name, walk: own };
      }
    }
    const qualified = own.context.qualify(callee);
    if (
      qualified === null ||
      qualified.startsWith(`${own.src.module}.`) ||
      this.scope.modules?.length === 0
    ) {
      return undefined;
    }
    const found = this.modules.follow(qualified, (walk, rest) => walk.functions.get(rest));
    return found && followed(found.view.src.module, this.scope.modules)
      ? { fn: found.node, name: found.rest, walk: found.view }
      : undefined;
  }

  /** Frees every tree read so far; the hops handed out are invalid afterwards. */
  dispose(): void {
    this.modules.dispose();
  }
}
