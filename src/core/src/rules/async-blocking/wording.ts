/**
 * @file Words INW013's findings and fix steps: one for a blocking call
 * written in an `async def`, and one for a call to a sync helper that makes
 * the blocking call one hop away (#294), which names both functions and
 * where the blocking call lives. Both sit on the call in the `async def`, up
 * to the end of its callee. Plain text from the records `walk.ts` and
 * `hop.ts` build; it decides nothing.
 */
import type { Node } from "web-tree-sitter";
import type { Diagnostic, Fix, SourceFile, Span } from "../../contracts/records.ts";
import { diagnostic, RULES } from "../../meta/registry.ts";
import type { Hop } from "./hop.ts";
import type { Blocking } from "./walk.ts";

/** The comma a configured family's wording ends with, which a hop's sentence doesn't need. */
const TRAILING_COMMA = /,$/u;

/**
 * Writes the fix step that applies to any `async def` FastAPI or Starlette runs.
 *
 * @param fn - the `async def`'s name.
 * @returns the step: declare it with `def`.
 */
function defStep(fn: string): string {
  return `If \`${fn}\` is a FastAPI or Starlette route or dependency, declare it with \`def\` instead: FastAPI runs a plain \`def\` in its threadpool, off the event loop.`;
}

/**
 * Spans a call from its start to the end of its callee.
 *
 * @param call - the `call` node.
 * @returns the 1-based span.
 */
function spanOf(call: Node): Span {
  const end = call.childForFieldName("function") ?? call;
  return {
    line: call.startPosition.row + 1,
    column: call.startPosition.column + 1,
    endLine: end.endPosition.row + 1,
    endColumn: end.endPosition.column + 1,
  };
}

/**
 * Says what a blocking call does, from its family.
 *
 * @param found - the blocking call.
 * @returns e.g. `talks to the database through a synchronous SQLAlchemy \`Session\``.
 */
function doing(found: Blocking): string {
  return found.method ? found.family.method(found.type) : found.family.call(found.type);
}

/**
 * Says what the event loop waits for, as the message's closing sentence.
 *
 * @param found - the blocking call.
 * @returns the sentence.
 */
function blocksUntil(found: Blocking): string {
  return `That blocks the event loop, and every other request on this worker, until ${found.family.waits}.`;
}

/**
 * Writes the fix for one blocking call in an `async def`.
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
      defStep(fn),
      `If the call has to stay synchronous inside \`async def\`, run it in a worker thread: \`await anyio.to_thread.run_sync(...)\`, \`await asyncio.to_thread(...)\` or Starlette's \`run_in_threadpool\`.`,
    ],
  };
}

/**
 * Turns one blocking call in an `async def` into a finding.
 *
 * @param found - the blocking call.
 * @param fn - the `async def`'s name.
 * @param src - the checked file.
 * @returns the finding.
 */
export function report(found: Blocking, fn: string, src: SourceFile): Diagnostic {
  return diagnostic(RULES.INW013, src, {
    span: spanOf(found.call),
    message: `\`${found.written}\` ${doing(found)} inside \`async def ${fn}\`. ${blocksUntil(found)}`,
    fix: fixFor(found, fn),
  });
}

/**
 * Turns a call to a sync helper that blocks into a finding: what the call
 * runs, where, and its first blocking call.
 *
 * @param hop - the helper call and the blocking calls in the helper.
 * @param fn - the `async def`'s name.
 * @param src - the checked file.
 * @returns the finding, or none when the helper holds no blocking call.
 */
export function reportHop(hop: Hop, fn: string, src: SourceFile): Diagnostic[] {
  const [first] = hop.blocking;
  if (first === undefined) {
    return [];
  }
  const line = hop.fn.startPosition.row + 1;
  const where = hop.path === undefined ? `line ${line}` : `${hop.path}, line ${line}`;
  const count = hop.blocking.length;
  const which = count === 1 ? "" : `, the first of ${count} blocking calls,`;
  const what = doing(first).replace(TRAILING_COMMA, "");
  const instead = first.family.instead(first.type);
  return [
    diagnostic(RULES.INW013, src, {
      span: spanOf(hop.call),
      message: `\`${hop.written}\` runs the plain \`def ${hop.name}\` (${where}) on the event loop inside \`async def ${fn}\`, and \`${first.written}\` on line ${first.call.startPosition.row + 1} of it${which} ${what}. ${blocksUntil(first)}`,
      fix: {
        summary: `Run \`${hop.name}\` in a worker thread, make it \`async def\` with ${instead}, or make \`${fn}\` a plain \`def\`.`,
        steps: [
          `Hand the function to a worker thread instead of calling it: \`await run_in_threadpool(${hop.written}, ...)\` from Starlette, \`await anyio.to_thread.run_sync(${hop.written}, ...)\` or \`await asyncio.to_thread(${hop.written}, ...)\`.`,
          `Or make \`${hop.name}\` an \`async def\` that uses ${instead}, and \`await\` the call to it.`,
          defStep(fn),
        ],
      },
    }),
  ];
}
