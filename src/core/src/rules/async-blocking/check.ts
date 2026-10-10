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
 * supplies the parser, the file, the options and the project index.
 */
import type { Node, Parser } from "web-tree-sitter";
import { stringList } from "../../config/rule-options.ts";
import type { RuleOptions } from "../../config/rule-settings.ts";
import type { Diagnostic, SourceFile } from "../../contracts/records.ts";
import { identifierName } from "../../python/nodes.ts";
import { parsePython } from "../../python/parser.ts";
import { parameterTypes } from "../shared/annotations.ts";
import type { FirstPartySource } from "../shared/first-party.ts";
import { configuredFamily, FAMILIES, type Family, LIBRARIES } from "./catalog.ts";
import { Helpers } from "./hop.ts";
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
 * Checks one file against INW013. The caller decides whether the rule is on
 * for the file; this parses only a file that may hold a finding, and reads
 * another module only when an `async def` calls a function there.
 *
 * @param parser - parser with the Python grammar loaded.
 * @param src - the file, with normalised text.
 * @param options - `[tool.inwards.rules.async-blocking]`, if set.
 * @param project - finds and reads the first-party modules a hop leads to.
 * @returns the findings in source order, before suppressions and severities apply.
 */
export function checkAsyncBlocking(
  parser: Parser,
  src: SourceFile,
  options: RuleOptions | undefined,
  project: FirstPartySource,
): Diagnostic[] {
  const settings = settingsOf(options);
  if (!mayBlock(src.text, settings)) {
    return [];
  }
  const tree = parsePython(parser, src.text);
  let helpers: Helpers | undefined;
  try {
    const walk = walkOf(tree, src, settings.families);
    const hops = new Helpers(parser, walk, { project, modules: settings.follow });
    helpers = hops;
    return functionsIn(tree.rootNode)
      .filter(isAsync)
      .flatMap((fn) => checkFunction(fn, walk, hops))
      .sort((a, b) => a.line - b.line || a.column - b.column);
  } finally {
    helpers?.dispose();
    tree.delete(); // WASM memory is not garbage collected
  }
}
