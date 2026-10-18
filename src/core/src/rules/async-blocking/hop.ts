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
 * `__init__.py` a re-export passes through. Each module is parsed and read
 * as INW013's view once per run, whichever file reaches it first (#359): the
 * view depends only on the options. The run owns the trees.
 */
import type { Node } from "web-tree-sitter";
import { entryReach, matchEntry } from "../../config/index.ts";
import { identifierName } from "../../python/nodes.ts";
import { parameterTypes } from "../shared/annotations.ts";
import { passedNames } from "../shared/arguments.ts";
import { ParsedModules } from "../shared/first-party.ts";
import type { ModuleTrees } from "../shared/module-trees.ts";
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

/** Which modules one hop may read, and INW013's view of them for the whole run. */
export interface FollowScope {
  /** The run's first-party modules as INW013 reads them (`followModules`). */
  readonly views: ParsedModules<Walk>;
  /** `follow-modules`: the modules followed into, or undefined for every first-party one. */
  readonly modules: readonly string[] | undefined;
  /**
   * The run's prefilter's helper names and aliases (`prefilter.ts`), when it
   * has one: a call that passes no receiver is followed only when its
   * qualified name ends in one of them.
   */
  readonly helpers?: ReadonlySet<string> | undefined;
}

/**
 * Makes INW013's view of the run's first-party modules, shared by every
 * checked file of the run: a module's walk depends only on the families.
 *
 * @param trees - the run's first-party modules, parsed once each.
 * @param families - the blocking families to look for.
 * @param follow - `follow-modules`, or undefined for every first-party module.
 * @returns the views, read on demand.
 */
export function followModules(
  trees: ModuleTrees,
  families: readonly Family[],
  follow: readonly string[] | undefined,
): ParsedModules<Walk> {
  return new ParsedModules(
    trees,
    (tree, src): Walk => walkOf(tree, src, families),
    (module: string): boolean => onTheWay(module, follow),
  );
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
 * Lists the blocking calls a helper's body runs, with the receivers its
 * module, its annotations and its body give it, plus those the call passes.
 *
 * @param fn - the helper's `function_definition` node.
 * @param walk - the helper's module.
 * @param passed - the receivers the call passes, by parameter name.
 * @returns the blocking calls, in source order; empty when it blocks nothing.
 */
function helperBlocking(
  fn: Node,
  walk: Walk,
  passed: ReadonlyMap<string, Source>,
): readonly Blocking[] {
  const body = fn.childForFieldName("body");
  const own = functionReceivers(fn, walk, passed);
  return (body ? callsIn(body) : []).flatMap((inner) => {
    const found = blockingCall(inner, own, walk);
    return found ? [found] : [];
  });
}

/**
 * Lists the names of a module's helpers that block when a caller passes them
 * no receiver: its top-level plain `def`s whose bodies make a blocking call
 * with the receivers their module and annotations give them. A hop from a
 * file that names no blocking type can only reach one of these
 * (`prefilter.ts`).
 *
 * @param walk - the module.
 * @returns the helpers' names in the module.
 */
export function blockingHelpers(walk: Walk): string[] {
  return [...walk.functions]
    .filter(([, fn]) => runsInline(fn) && helperBlocking(fn, walk, new Map()).length > 0)
    .map(([name]) => name);
}

/**
 * The sync helpers the `async def`s of one checked file call, read on
 * demand. Build one per check of a file.
 */
export class Helpers {
  private readonly walk: Walk;
  private readonly scope: FollowScope;

  /**
   * Wraps the checked file's walk and what following may read. Nothing is read yet.
   *
   * @param walk - the checked file.
   * @param scope - the run's views and `follow-modules`.
   */
  constructor(walk: Walk, scope: FollowScope) {
    this.walk = walk;
    this.scope = scope;
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
    const target = this.helperOf(callee, shadowed, receivers.size === 0);
    if (target === undefined || !runsInline(target.fn)) {
      return undefined;
    }
    const { fn, name, walk } = target;
    const params = [...parameterTypes(fn, walk.context).keys()];
    const passed = passedNames(call, params, (arg) => receivers.get(arg));
    const blocking = helperBlocking(fn, walk, passed);
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
   * A call from a function with no receivers passes none, so the helper's
   * body blocks only through its own module's names: another module is then
   * read only when the run's prefilter lists the name the call ends in.
   *
   * @param callee - the call's `function` node.
   * @param shadowed - names that hide the checked module's functions.
   * @param bare - true when the calling function has no receivers to pass.
   * @returns the function, its name and its module, or undefined.
   */
  private helperOf(
    callee: Node,
    shadowed: ReadonlySet<string>,
    bare: boolean,
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
    const { helpers, modules } = this.scope;
    if (
      qualified === null ||
      qualified.startsWith(`${own.src.module}.`) ||
      modules?.length === 0 ||
      (bare && helpers !== undefined && !helpers.has(qualified.split(".").at(-1) ?? qualified))
    ) {
      return undefined;
    }
    const found = this.scope.views.follow(qualified, (walk, rest) => walk.functions.get(rest));
    return found && followed(found.view.src.module, modules)
      ? { fn: found.node, name: found.rest, walk: found.view }
      : undefined;
  }
}
