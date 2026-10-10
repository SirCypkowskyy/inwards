/**
 * @file INW013 `async-blocking` (#293, from #98): inside an `async def`, a
 * call that does synchronous database, cache or cloud I/O blocks the event
 * loop, and with it every other request the worker serves. It reports a
 * method call on a blocking receiver (`db.execute` on `db: Session`,
 * `cache.set` on a module-level `redis.Redis()`) and a call that blocks by
 * itself (`sqlite3.connect`), on the call, with fix steps that name the async
 * replacement and the `def` alternative. Calls in a nested `def`, `lambda` or
 * class body don't run on the loop when the function does, so they don't
 * count. A file whose text names no blocking library and no configured
 * pattern is never parsed. I/O-free: the caller supplies the parser, the
 * file and the options.
 */
import type { Node, Parser } from "web-tree-sitter";
import { stringList } from "../../config/rule-options.ts";
import type { RuleOptions } from "../../config/rule-settings.ts";
import type { Diagnostic, Fix, SourceFile } from "../../contracts/records.ts";
import { diagnostic, RULES } from "../../meta/registry.ts";
import { identifierName, namedChildren } from "../../python/nodes.ts";
import { importedNames, parsePython } from "../../python/parser.ts";
import { qualifierFor } from "../../python/qualify.ts";
import { moduleAliases, type TypeContext } from "../shared/annotations.ts";
import { configuredFamily, FAMILIES, type Family, LIBRARIES } from "./catalog.ts";
import {
  functionReceivers,
  moduleReceivers,
  NESTED_SCOPES,
  type Source,
  valueSource,
} from "./receivers.ts";

/** An `async def` anywhere in a file's text. */
const ASYNC_DEF = /\basync\s+def\b/u;

/** A wildcard in a pattern's first segment, which no text filter can rule out. */
const WILDCARD = /[*?]/u;

/** What INW013 knows about one file while it walks its functions. */
interface Walk {
  readonly src: SourceFile;
  readonly context: TypeContext;
  readonly families: readonly Family[];
  readonly module: ReadonlyMap<string, Source>;
}

/** One blocking call, before it becomes a finding. */
interface Blocking {
  /** The call node. */
  readonly call: Node;
  /** The call as written, e.g. `db.execute`. */
  readonly written: string;
  readonly family: Family;
  /** The qualified name the receiver or call came from. */
  readonly type: string;
  /** True for a method on a receiver, false for a call that blocks by itself. */
  readonly method: boolean;
}

/**
 * Builds the families to check: the built-in ones, then the configured extras.
 *
 * @param options - `[tool.inwards.rules.async-blocking]`, if set.
 * @returns the families, and the configured patterns for the text prefilter.
 */
function familiesFor(options: RuleOptions | undefined): {
  families: Family[];
  patterns: string[];
} {
  const calls = stringList(options?.["extend-blocking-calls"]) ?? [];
  const types = stringList(options?.["extend-blocking-types"]) ?? [];
  const patterns = [...calls, ...types];
  return {
    families: patterns.length > 0 ? [...FAMILIES, configuredFamily(calls, types)] : [...FAMILIES],
    patterns,
  };
}

/**
 * Tells whether a file's text may hold a finding: it has an `async def`, and
 * names a blocking library or the first segment of a configured pattern (a
 * pattern that starts with a wildcard always counts).
 *
 * @param text - the file's text.
 * @param patterns - the configured call and type patterns.
 * @returns false when parsing the file can't find anything.
 */
function mayBlock(text: string, patterns: readonly string[]): boolean {
  if (!ASYNC_DEF.test(text)) {
    return false;
  }
  const roots = [...LIBRARIES, ...patterns.map((p) => p.split(".")[0] ?? "")];
  return roots.some((root) => WILDCARD.test(root) || text.includes(root));
}

/**
 * Tells whether a function is `async def`.
 *
 * @param fn - a `function_definition` node.
 * @returns true when its first token is `async`.
 */
function isAsync(fn: Node): boolean {
  return fn.child(0)?.type === "async";
}

/**
 * Lists every function definition in a tree, nested ones and methods included.
 *
 * @param node - the module node, or any node below it.
 * @returns the `function_definition` nodes, in source order.
 */
function functionsIn(node: Node): Node[] {
  const own = node.type === "function_definition" ? [node] : [];
  return [...own, ...namedChildren(node).flatMap(functionsIn)];
}

/**
 * Lists the calls a function body runs when the function runs, leaving out
 * nested `def`, `lambda` and `class` bodies.
 *
 * @param node - the body, or any node below it.
 * @returns the `call` nodes, outermost first.
 */
function callsIn(node: Node): Node[] {
  return namedChildren(node).flatMap((child) => {
    if (NESTED_SCOPES.has(child.type)) {
      return [];
    }
    return child.type === "call" ? [child, ...callsIn(child)] : callsIn(child);
  });
}

/**
 * Reads one call: a method on a blocking receiver, a call that blocks by
 * itself, or neither. A method on an inline call that blocks by itself
 * (`sqlite3.connect(p).execute(q)`) is left to that call's own finding.
 *
 * @param call - a `call` node.
 * @param receivers - the blocking receivers in scope, by name.
 * @param walk - the file being walked.
 * @returns the blocking call, or undefined.
 */
function blockingCall(
  call: Node,
  receivers: ReadonlyMap<string, Source>,
  walk: Walk,
): Blocking | undefined {
  const callee = call.childForFieldName("function");
  if (!callee) {
    return undefined;
  }
  const qualified = walk.context.qualify(callee);
  const direct = qualified === null ? undefined : walk.families.find((f) => f.isCall(qualified));
  if (direct && qualified !== null) {
    return { call, written: callee.text, family: direct, type: qualified, method: false };
  }
  const object = callee.type === "attribute" ? callee.childForFieldName("object") : null;
  const attribute = callee.childForFieldName("attribute");
  if (!(object && attribute)) {
    return undefined;
  }
  let source: Source | undefined;
  if (object.type === "identifier") {
    source = receivers.get(identifierName(object));
  } else if (object.type === "call") {
    source = inlineSource(object, walk);
  }
  return source?.family.blocks(identifierName(attribute))
    ? { call, written: callee.text, family: source.family, type: source.type, method: true }
    : undefined;
}

/**
 * Reads an inline receiver, `Session(engine)` in `Session(engine).scalar(q)`,
 * unless that call blocks by itself and gets its own finding.
 *
 * @param call - the receiver's `call` node.
 * @param walk - the file being walked.
 * @returns its source, or undefined.
 */
function inlineSource(call: Node, walk: Walk): Source | undefined {
  const callee = call.childForFieldName("function");
  const qualified = callee ? walk.context.qualify(callee) : null;
  if (qualified !== null && walk.families.some((f) => f.isCall(qualified))) {
    return undefined;
  }
  return valueSource(call, walk.context, walk.families);
}

/**
 * Writes the fix for one blocking call.
 *
 * @param found - the blocking call.
 * @param fn - the `async def`'s name.
 * @returns the summary and steps: the async client, `def`, or a worker thread.
 */
function fixFor(found: Blocking, fn: string): Fix {
  const instead = found.family.instead(found.type);
  return {
    summary: `Use ${instead} and await the call, or make \`${fn}\` a plain \`def\`.`,
    steps: [
      `Replace \`${found.type}\` with ${instead}, and \`await\` the call to \`${found.written}\`.`,
      `If \`${fn}\` is a FastAPI or Starlette route or dependency, declare it with \`def\` instead: FastAPI runs a plain \`def\` in its threadpool, off the event loop.`,
      `If the call has to stay synchronous inside \`async def\`, run it in a worker thread: \`await anyio.to_thread.run_sync(...)\`, \`await asyncio.to_thread(...)\` or Starlette's \`run_in_threadpool\`.`,
    ],
  };
}

/**
 * Turns one blocking call into a finding, on the call up to the end of its callee.
 *
 * @param found - the blocking call.
 * @param fn - the `async def`'s name.
 * @param src - the checked file.
 * @returns the finding.
 */
function report(found: Blocking, fn: string, src: SourceFile): Diagnostic {
  const { call, written, family, type, method } = found;
  const end = call.childForFieldName("function") ?? call;
  const what = method ? family.method(type) : family.call(type);
  return diagnostic(RULES.INW013, src, {
    span: {
      line: call.startPosition.row + 1,
      column: call.startPosition.column + 1,
      endLine: end.endPosition.row + 1,
      endColumn: end.endPosition.column + 1,
    },
    message: `\`${written}\` ${what} inside \`async def ${fn}\`. That blocks the event loop, and every other request on this worker, until ${family.waits}.`,
    fix: fixFor(found, fn),
  });
}

/**
 * Checks one `async def`.
 *
 * @param fn - its `function_definition` node.
 * @param walk - the file being walked.
 * @returns one finding per blocking call its body runs.
 */
function checkFunction(fn: Node, walk: Walk): Diagnostic[] {
  const body = fn.childForFieldName("body");
  const nameNode = fn.childForFieldName("name");
  if (!(body && nameNode)) {
    return [];
  }
  const receivers = functionReceivers(fn, walk.module, walk.context, walk.families);
  const name = identifierName(nameNode);
  return callsIn(body).flatMap((call) => {
    const found = blockingCall(call, receivers, walk);
    return found ? [report(found, name, walk.src)] : [];
  });
}

/**
 * Checks one file against INW013. The caller decides whether the rule is on
 * for the file; this parses only a file that may hold a finding.
 *
 * @param parser - parser with the Python grammar loaded.
 * @param src - the file, with normalised text.
 * @param options - `[tool.inwards.rules.async-blocking]`, if set.
 * @returns the findings in source order, before suppressions and severities apply.
 */
export function checkAsyncBlocking(
  parser: Parser,
  src: SourceFile,
  options: RuleOptions | undefined,
): Diagnostic[] {
  const { families, patterns } = familiesFor(options);
  if (!mayBlock(src.text, patterns)) {
    return [];
  }
  const tree = parsePython(parser, src.text);
  try {
    const root = tree.rootNode;
    const context = {
      qualify: qualifierFor(importedNames(tree, src), src.module),
      aliases: moduleAliases(root),
    };
    const walk = { src, context, families, module: moduleReceivers(root, context, families) };
    return functionsIn(root)
      .filter(isAsync)
      .flatMap((fn) => checkFunction(fn, walk))
      .sort((a, b) => a.line - b.line || a.column - b.column);
  } finally {
    tree.delete(); // WASM memory is not garbage collected
  }
}
