/**
 * @file INW013 `async-blocking` (#293, from #98): inside an `async def`, a
 * call that does synchronous database, cache or cloud I/O blocks the event
 * loop, and with it every other request the worker serves. It reports a
 * method call on a blocking receiver (`db.execute` on `db: Session`,
 * `cache.set` on a module-level `redis.Redis()`) and a call that blocks by
 * itself (`sqlite3.connect`), on the call, with fix steps that name the async
 * replacement and the `def` alternative. It also follows one hop (#294): a
 * call to a first-party plain `def` whose body makes such a call is reported
 * on the call, naming both functions (`hop.ts`). Calls in a nested `def`,
 * `lambda` or class body don't run on the loop when the function does, so
 * they don't count. A file with no `async def` is never parsed, and neither
 * is one that names no blocking library and no configured pattern when
 * `follow-modules = []` keeps the check to the file. I/O-free: the caller
 * supplies the parser, the file, the options and the run's first-party
 * modules, each parsed and read once per run (#359).
 */
import type { Node, Parser } from "web-tree-sitter";
import { stringList } from "../../config/rule-options.ts";
import type { RuleOptions } from "../../config/rule-settings.ts";
import type { Diagnostic, SourceFile } from "../../contracts/records.ts";
import { identifierName } from "../../python/nodes.ts";
import { parsePython } from "../../python/parser.ts";
import { parameterTypes } from "../shared/annotations.ts";
import type { ParsedModules } from "../shared/first-party.ts";
import type { ModuleTrees } from "../shared/module-trees.ts";
import { BUILT_IN_NAMES, configuredFamily, FAMILIES, type Family, LIBRARIES } from "./catalog.ts";
import { followModules, Helpers } from "./hop.ts";
import { BlockingReach, blockingSegments } from "./prefilter.ts";
import { functionReceivers } from "./receivers.ts";
import { blockingCall, callsIn, functionsIn, isAsync, type Walk, walkOf } from "./walk.ts";
import { report, reportHop } from "./wording.ts";

/** An `async def` anywhere in a file's text. */
const ASYNC_DEF = /\basync\s+def\b/u;

/** A wildcard in a pattern's first segment, which no text filter can rule out. */
const WILDCARD = /[*?]/u;

/** What INW013 reads from its options. */
interface Settings {
  readonly families: readonly Family[];
  /** The configured call and type patterns, for the text prefilter. */
  readonly patterns: readonly string[];
  /** `follow-modules`, or undefined to follow every first-party module. */
  readonly follow: readonly string[] | undefined;
}

/**
 * Reads INW013's options: the built-in families, then the configured extras,
 * and which modules a hop may follow into.
 *
 * @param options - `[tool.inwards.rules.async-blocking]`, if set.
 * @returns the families to look for, the patterns for the text prefilter, and `follow-modules`.
 */
function settingsOf(options: RuleOptions | undefined): Settings {
  const calls = stringList(options?.["extend-blocking-calls"]) ?? [];
  const types = stringList(options?.["extend-blocking-types"]) ?? [];
  const patterns = [...calls, ...types];
  return {
    families: patterns.length > 0 ? [...FAMILIES, configuredFamily(calls, types)] : [...FAMILIES],
    patterns,
    follow: stringList(options?.["follow-modules"]),
  };
}

/**
 * Tells whether a file's text may hold a finding: it has an `async def`, and
 * either a hop may leave the file, or it names a blocking library or the
 * first segment of a configured pattern (a pattern that starts with a
 * wildcard always counts).
 *
 * @param text - the file's text.
 * @param settings - the patterns and `follow-modules`.
 * @returns false when parsing the file can't find anything.
 */
function mayBlock(text: string, settings: Settings): boolean {
  if (!ASYNC_DEF.test(text)) {
    return false;
  }
  if (settings.follow?.length !== 0) {
    return true; // a helper in another module may block whatever this file names
  }
  const roots = [...LIBRARIES, ...settings.patterns.map((p) => p.split(".")[0] ?? "")];
  return roots.some((root) => WILDCARD.test(root) || text.includes(root));
}

/**
 * Checks one `async def`: its own blocking calls, and the sync helpers it calls.
 *
 * @param fn - its `function_definition` node.
 * @param walk - the checked file.
 * @param helpers - finds the helpers one hop away.
 * @returns one finding per blocking call its body runs, and one per call to a helper that blocks.
 */
function checkFunction(fn: Node, walk: Walk, helpers: Helpers): Diagnostic[] {
  const body = fn.childForFieldName("body");
  const nameNode = fn.childForFieldName("name");
  if (!(body && nameNode)) {
    return [];
  }
  const receivers = functionReceivers(fn, walk);
  const shadowed = new Set(parameterTypes(fn, walk.context).keys());
  const name = identifierName(nameNode);
  return callsIn(body).flatMap((call) => {
    const found = blockingCall(call, receivers, walk);
    if (found) {
      return [report(found, name, walk.src)];
    }
    const hop = helpers.hopAt(call, receivers, shadowed);
    return hop ? reportHop(hop, name, walk.src) : [];
  });
}

/**
 * INW013 for one run: its options read once, and its view of the other
 * first-party modules, which every checked file of the run shares (#359).
 * The engine builds one per run, after the run's `ModuleTrees`.
 */
export class AsyncBlockingRun {
  readonly settings: Settings;
  readonly views: ParsedModules<Walk>;
  /** The run's trees, which may already hold the checked file. */
  readonly trees: ModuleTrees;
  /** True when the run may read every listed module to skip files (`prefilter.ts`). */
  private readonly prefilter: boolean;
  /** The prefilter once built; null when it can't apply to this run. */
  private reach: BlockingReach | null | undefined;

  /**
   * Reads the options and wraps the run's trees. Nothing is parsed yet.
   *
   * @param options - `[tool.inwards.rules.async-blocking]`, if set.
   * @param trees - the run's first-party modules, which a hop reads.
   * @param prefilter - true for a run over many files, where reading every
   *   listed module once costs less than parsing every file with an `async def`.
   */
  constructor(options: RuleOptions | undefined, trees: ModuleTrees, prefilter = false) {
    this.settings = settingsOf(options);
    this.trees = trees;
    this.views = followModules(trees, this.settings.families, this.settings.follow);
    this.prefilter = prefilter;
  }

  /**
   * Tells whether a checked file may hold a finding, by the run's prefilter
   * (`prefilter.ts`), built on the first call. Without one, every file may.
   *
   * @param src - the checked file, with normalised text.
   * @returns false only when parsing the file can't find anything.
   */
  mayFind(src: SourceFile): boolean {
    const reach: BlockingReach | undefined = this.reachOf();
    return reach === undefined || reach.mayFind(src);
  }

  /**
   * The names a call that passes no receiver must end in to reach a helper
   * that blocks, by the run's prefilter.
   *
   * @returns the helpers' names and aliases, or undefined without a prefilter.
   */
  helpers(): ReadonlySet<string> | undefined {
    return this.reachOf()?.helpers;
  }

  /**
   * Builds the run's prefilter on first use, when the run asked for one and
   * hops may leave the file.
   *
   * @returns the prefilter, or undefined when it doesn't apply.
   */
  private reachOf(): BlockingReach | undefined {
    if (this.reach === undefined) {
      const { follow, patterns } = this.settings;
      // With `follow-modules = []` no hop leaves the file, and `mayBlock` has already decided.
      const segments =
        this.prefilter && follow?.length !== 0
          ? blockingSegments([...BUILT_IN_NAMES, ...patterns])
          : undefined;
      this.reach = (segments && BlockingReach.of(this.trees, this.views, segments)) ?? null;
    }
    return this.reach ?? undefined;
  }
}

/**
 * Checks one file against INW013. The caller decides whether the rule is on
 * for the file; this parses only a file that may hold a finding, and reads
 * another module only when an `async def` calls a function there.
 *
 * @param parser - parser with the Python grammar loaded.
 * @param src - the file, with normalised text.
 * @param run - the options and the run's view of the modules a hop reads.
 * @returns the findings in source order, before suppressions and severities apply.
 */
export function checkAsyncBlocking(
  parser: Parser,
  src: SourceFile,
  run: AsyncBlockingRun,
): Diagnostic[] {
  const { settings, views } = run;
  if (!(mayBlock(src.text, settings) && run.mayFind(src))) {
    return [];
  }
  // A file an earlier file's hop led to is parsed already; the run frees that tree.
  const shared = run.trees.parsedAs(src);
  const tree = shared ?? parsePython(parser, src.text);
  try {
    const walk = walkOf(tree, src, settings.families);
    const hops = new Helpers(walk, { views, modules: settings.follow, helpers: run.helpers() });
    return functionsIn(tree.rootNode)
      .filter(isAsync)
      .flatMap((fn) => checkFunction(fn, walk, hops))
      .sort((a, b) => a.line - b.line || a.column - b.column);
  } finally {
    if (shared === undefined) {
      tree.delete(); // WASM memory is not garbage collected
    }
  }
}
