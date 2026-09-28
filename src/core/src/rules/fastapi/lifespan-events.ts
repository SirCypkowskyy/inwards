/**
 * @file FAPI006 `lifespan-events` (#225): startup and shutdown handlers
 * registered the deprecated way, with `@app.on_event(...)`,
 * `app.add_event_handler(...)` or `FastAPI(on_startup=..., on_shutdown=...)`.
 * Alone they are a warning; on an app that also sets `lifespan=` they are an
 * error, since FastAPI then runs only the lifespan and the handlers never run.
 *
 * The receiver is resolved across files through the model, so a handler in
 * `events.py` on the `app` that `main.py` builds with `lifespan=` is found. A
 * receiver Inwards can't resolve to a FastAPI app or router is left alone, and
 * a router's handlers only get the warning: whether its app has a lifespan
 * would need the inclusion graph. Ruff has no rule for this.
 */
import type { Node } from "web-tree-sitter";
import type { Diagnostic, SourceFile } from "../../contracts/records.ts";
import { diagnostic, RULES } from "../../meta/registry.ts";
import { argumentAt, literalString } from "../../python/literals.ts";
import { identifierName } from "../../python/nodes.ts";
import type { FastApiProject } from "./project.ts";
import type { FastApiFile, FastApiObject } from "./records.ts";
import { callSpan, spanOf } from "./syntax.ts";
import type { Qualify } from "./values.ts";

/** The text pre-filter: a file that spells none of these registers no event handler. */
const MENTIONS = /on_event|add_event_handler|on_startup|on_shutdown/u;

/** The constructor keywords that register event handlers. */
const KEYWORDS = ["on_startup", "on_shutdown"];

/** Where an app with `lifespan=` is built, for the message. */
interface Lifespan {
  /** The app's name as the finding's file spells it. */
  readonly app: string;
  /** `path:line` of its `FastAPI(...)` call. */
  readonly where: string;
}

/**
 * Tells whether a file may register an event handler, before any parse.
 *
 * @param text - the file's text.
 * @returns true when it spells an event registration.
 */
export function mentionsEvents(text: string): boolean {
  return MENTIONS.test(text);
}

/**
 * Reports the event handlers one file registers.
 *
 * @param src - the file.
 * @param syntax - its module node and name qualifier.
 * @param syntax.root - the module node.
 * @param syntax.qualify - qualifies names in the file.
 * @param own - its FastAPI records, if it mentions FastAPI.
 * @param scope - the project lookups.
 * @returns one FAPI006 diagnostic per registration.
 */
export function checkLifespanEvents(
  src: SourceFile,
  { root, qualify }: { root: Node; qualify: Qualify },
  own: FastApiFile | null,
  scope: FastApiProject,
): Diagnostic[] {
  const found = (own?.objects ?? []).flatMap((object) => constructorEvents(src, object, own));
  for (const call of root.descendantsOfType("call")) {
    const d = registration(src, call, qualify, scope);
    if (d) {
      found.push(d);
    }
  }
  return found;
}

/**
 * Reports `FastAPI(on_startup=..., on_shutdown=...)`.
 *
 * @param src - the file.
 * @param object - an app or router the file builds.
 * @param own - the file's records.
 * @returns one diagnostic per keyword given.
 */
function constructorEvents(
  src: SourceFile,
  object: FastApiObject,
  own: FastApiFile | null,
): Diagnostic[] {
  const lifespan = own && object.kind === "app" ? lifespanOf(object, own, object.local) : null;
  return KEYWORDS.flatMap((keyword) => {
    const arg = object.keywords.get(keyword);
    const at = arg?.node.parent;
    return arg && at ? [report(src, at, { what: `\`${keyword}=\``, lifespan })] : [];
  });
}

/**
 * Reports one `X.on_event(...)` or `X.add_event_handler(...)` call on a
 * FastAPI app or router.
 *
 * @param src - the file.
 * @param call - a `call` node.
 * @param qualify - qualifies names in the file.
 * @param scope - the project lookups.
 * @returns the diagnostic, or null for any other call.
 */
function registration(
  src: SourceFile,
  call: Node,
  qualify: Qualify,
  scope: FastApiProject,
): Diagnostic | null {
  const fn = call.childForFieldName("function");
  const receiver = fn?.type === "attribute" ? fn.childForFieldName("object") : null;
  const attribute = fn?.childForFieldName("attribute");
  const method = attribute ? identifierName(attribute) : "";
  const name =
    receiver && (method === "on_event" || method === "add_event_handler")
      ? qualify(receiver)
      : null;
  const found = name === null ? null : scope.resolve(name);
  if (!receiver || found?.kind !== "object") {
    return null;
  }
  const { object, file } = found;
  const lifespan = object.kind === "app" ? lifespanOf(object, file, receiver.text) : null;
  const event = literalString(argumentAt(call, 0, "event_type"));
  const what = `\`${receiver.text}.${method}(${event === null ? "..." : `"${event}"`})\``;
  return report(src, call, { what, lifespan });
}

/**
 * Tells where an app sets `lifespan=`.
 *
 * @param app - an app the model found.
 * @param file - the file that builds it.
 * @param spelled - the app's name as the finding's file spells it.
 * @returns where, or null when it sets none (or `lifespan=None`).
 */
function lifespanOf(app: FastApiObject, file: FastApiFile, spelled: string): Lifespan | null {
  const value = app.keywords.get("lifespan")?.value;
  if (value === undefined || value.kind === "none") {
    return null;
  }
  return { app: spelled, where: `${file.path}:${app.node.startPosition.row + 1}` };
}

/**
 * Builds the finding for one registration.
 *
 * @param src - the file.
 * @param node - the registering call, or the constructor's keyword argument.
 * @param found - what the registration is and the lifespan that overrides it.
 * @param found.what - the registration as the message quotes it.
 * @param found.lifespan - where the app sets `lifespan=`, or null when it doesn't.
 * @returns the diagnostic: an error when a lifespan overrides the handler, a warning otherwise.
 */
function report(
  src: SourceFile,
  node: Node,
  { what, lifespan }: { what: string; lifespan: Lifespan | null },
): Diagnostic {
  const move =
    "Move the handler's code into the app's lifespan function: startup code before its `yield`, shutdown code after it.";
  const ask =
    "If the project keeps the events on purpose, ask the user before suppressing this; don't edit [tool.inwards] yourself.";
  if (lifespan === null) {
    return diagnostic(RULES.FAPI006, src, {
      span: node.type === "call" ? callSpan(node) : spanOf(node),
      severity: "warning",
      message: `${what} registers a startup or shutdown handler through the deprecated events API; FastAPI replaces them with one \`lifespan=\` context manager.`,
      fix: {
        summary: "Replace the event handlers with a lifespan context manager.",
        steps: [
          "Write a lifespan function, an async context manager that takes the app, and give it to the app as `lifespan=`.",
          move,
          "Move every other event handler of the app too: FastAPI runs either the lifespan or the events, never both.",
          ask,
        ],
      },
    });
  }
  return diagnostic(RULES.FAPI006, src, {
    span: node.type === "call" ? callSpan(node) : spanOf(node),
    message: `${what} never runs: \`${lifespan.app}\` sets \`lifespan=\` (${lifespan.where}), and FastAPI then ignores startup and shutdown events.`,
    fix: {
      summary: `Move the handler into \`${lifespan.app}\`'s lifespan function.`,
      steps: [move, "Then delete the event registration.", ask],
    },
  });
}
