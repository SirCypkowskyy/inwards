/**
 * @file FAPI006 `lifespan-events` (#225): `@app.on_event("startup")`,
 * `app.add_event_handler(...)` and `FastAPI(on_startup=..., on_shutdown=...)`
 * are deprecated in favour of `lifespan=`, and an app that sets `lifespan=`
 * runs only that: its event handlers silently never run (FastAPI docs: "It's
 * all lifespan or all events, not both"). A registration is a warning on its
 * own and an error when the app, or an app that includes its router, has a
 * lifespan.
 *
 * The receiver is resolved through the model, so a handler in one file and
 * the app in another still meet. A per-edit check does not walk up the
 * router graph: a router's handler is then a warning, and the Stop gate
 * upgrades it when an app above it has a lifespan. Unknown means silent: a
 * `**kwargs` that may hide `lifespan=`, or an inclusion Inwards can't follow,
 * keeps a handler at a warning.
 */
import type { Diagnostic, SourceFile } from "../../contracts/records.ts";
import { diagnostic, RULES } from "../../meta/registry.ts";
import type { FastApiProject } from "./project.ts";
import type { EventHandlerUse, FastApiFile, FastApiObject } from "./records.ts";
import { decoratorSpan, spanOf } from "./syntax.ts";
import type { Value } from "./values.ts";

/** An app or router and the file that builds it. */
interface Located {
  readonly object: FastApiObject;
  readonly file: FastApiFile;
}

/** The keywords that register event handlers on a constructor. */
const HANDLER_KEYWORDS = ["on_startup", "on_shutdown"] as const;

/** The advice every finding carries. */
interface Advice {
  readonly summary: string;
  readonly steps: string[];
}

/**
 * Tells whether a keyword value is an actual value: not `None` and not an
 * empty list.
 *
 * @param value - the keyword's value.
 * @returns true when it can hold a lifespan or a handler.
 */
function given(value: Value): boolean {
  return value.kind !== "none" && !(value.kind === "list" && value.items.length === 0);
}

/**
 * Tells whether an app or router sets `lifespan=`.
 *
 * @param object - the app or router, as the model read it.
 * @returns true when its constructor passes a `lifespan` other than `None`.
 */
function hasLifespan(object: FastApiObject): boolean {
  const lifespan = object.keywords.get("lifespan");
  return lifespan !== undefined && given(lifespan.value);
}

/**
 * Resolves a qualified name to an app or router and its file.
 *
 * @param name - a record's `receiver` or an edge's `parent`.
 * @param scope - this check's FastAPI lookups.
 * @returns the object and its file, or null when the name isn't one.
 */
function locate(name: string, scope: FastApiProject): Located | null {
  const found = scope.resolve(name);
  return found?.kind === "object" ? { object: found.object, file: found.file } : null;
}

/**
 * Finds the objects whose lifespan replaces an object's event handlers: the
 * object itself, and for a router the apps and routers above it, when the
 * check may read the graph.
 *
 * @param start - the app or router the handler is registered on.
 * @param scope - this check's FastAPI lookups.
 * @returns the objects with a `lifespan=`, nearest first.
 */
function lifespansAbove(start: Located, scope: FastApiProject): Located[] {
  const found: Located[] = [];
  const seen = new Set<string>();
  const queue: Located[] = [start];
  for (let at = queue.shift(); at !== undefined; at = queue.shift()) {
    if (seen.has(at.object.name)) {
      continue;
    }
    seen.add(at.object.name);
    if (hasLifespan(at.object)) {
      found.push(at);
    } else {
      queue.push(...parentsOf(at, scope));
    }
  }
  return found;
}

/**
 * Lists the apps and routers that include a router, when the check may read
 * the graph and every inclusion in the project is known.
 *
 * @param at - the app or router.
 * @param scope - this check's FastAPI lookups.
 * @returns its parents; none for an app, in a per-edit check, or when an inclusion can't be followed.
 */
function parentsOf(at: Located, scope: FastApiProject): Located[] {
  if (at.object.kind !== "router" || scope.lazy) {
    return [];
  }
  return (scope.edgesTo(at.object.name) ?? []).flatMap((edge) => {
    const parent = edge.parent === null ? null : locate(edge.parent, scope);
    return parent === null ? [] : [parent];
  });
}

/**
 * Quotes a registration as written: `@app.on_event("startup")` or
 * `app.add_event_handler("startup", on_start)`.
 *
 * @param use - the `on_event` or `add_event_handler` call.
 * @returns the callee and its arguments.
 */
function quote(use: EventHandlerUse): string {
  const callee = use.node.childForFieldName("function")?.text ?? use.via;
  const args = use.node.childForFieldName("arguments")?.text ?? "()";
  return use.via === "on_event" ? `@${callee}${args}` : `${callee}${args}`;
}

/**
 * Describes where a lifespan is set, for a message.
 *
 * @param above - the app or router with the `lifespan=`.
 * @param above.object - the app or router.
 * @param above.file - the file that builds it.
 * @returns its name and the line of its constructor call.
 */
function whereSet({ object, file }: Located): string {
  return `\`${object.local}\` (${file.path}:${object.node.startPosition.row + 1})`;
}

/**
 * Writes the repair advice every finding carries.
 *
 * @param summary - the one-line fix for the diagnostic.
 * @param first - the first step, which says what to move where.
 * @returns the fix: a summary and the steps to take.
 */
function advice(summary: string, first: string): Advice {
  return {
    summary,
    steps: [
      first,
      "Write one async lifespan function that takes the app, with the startup code before its `yield` and the shutdown code after it, wrap it with `contextlib.asynccontextmanager`, and pass it as `lifespan=`.",
      "Delete the old handler only after its body has moved: don't remove it to make this finding go away, as its startup or shutdown work would be lost.",
    ],
  };
}

/**
 * Builds the finding for a registration on an app or router.
 *
 * @param use - the `on_event` or `add_event_handler` call.
 * @param src - the file holding the registration.
 * @param above - the objects whose `lifespan=` replaces it; empty when none is known.
 * @returns a warning (deprecated) or an error (never runs).
 */
function registration(
  use: EventHandlerUse,
  src: SourceFile,
  above: readonly Located[],
): Diagnostic {
  const what = quote(use);
  const span = decoratorSpan(use);
  const [first] = above;
  if (first === undefined) {
    return diagnostic(RULES.FAPI006, src, {
      span,
      severity: "warning",
      message: `\`${what}\` is deprecated: FastAPI replaces startup and shutdown events with a \`lifespan=\` context manager.`,
      fix: advice(
        "Move the handler into a lifespan context manager.",
        "Move what this handler does into a lifespan context manager.",
      ),
    });
  }
  return diagnostic(RULES.FAPI006, src, {
    span,
    message: `\`${what}\` never runs: ${whereSet(first)} sets \`lifespan=\`, and FastAPI then ignores event handlers. It's all lifespan or all events, not both.`,
    fix: advice(
      "Move the handler into the lifespan context manager.",
      "Move what this handler does into the lifespan function that is already set.",
    ),
  });
}

/**
 * Builds the finding for an `on_startup=` or `on_shutdown=` keyword.
 *
 * @param object - the app or router whose constructor passes it.
 * @param keyword - `on_startup` or `on_shutdown`.
 * @param src - the file.
 * @returns a warning (deprecated) or an error when the same call sets `lifespan=`; none when the keyword is empty.
 */
function keywordFinding(
  object: FastApiObject,
  keyword: (typeof HANDLER_KEYWORDS)[number],
  src: SourceFile,
): Diagnostic[] {
  const arg = object.keywords.get(keyword);
  if (arg === undefined || !given(arg.value)) {
    return [];
  }
  const never = hasLifespan(object);
  const message = never
    ? `\`${keyword}=\` never runs: \`${object.local}\` also sets \`lifespan=\`, and FastAPI then ignores event handlers. It's all lifespan or all events, not both.`
    : `\`${keyword}=\` is deprecated: FastAPI replaces startup and shutdown events with a \`lifespan=\` context manager.`;
  return [
    diagnostic(RULES.FAPI006, src, {
      span: spanOf(arg.node.parent ?? arg.node),
      ...(never ? {} : { severity: "warning" as const }),
      message,
      fix: advice(
        "Move the handlers into a lifespan context manager.",
        `Move the functions passed as \`${keyword}=\` into a lifespan context manager.`,
      ),
    }),
  ];
}

/**
 * Checks one file's event registrations and constructor keywords.
 *
 * @param file - the file's FastAPI records.
 * @param src - the file, for the diagnostics.
 * @param scope - this check's FastAPI lookups.
 * @returns the findings: registrations first, then constructor keywords.
 */
export function checkLifespan(
  file: FastApiFile,
  src: SourceFile,
  scope: FastApiProject,
): Diagnostic[] {
  const registered = file.events.flatMap((use) => {
    const target = locate(use.receiver, scope);
    return target === null ? [] : [registration(use, src, lifespansAbove(target, scope))];
  });
  const keywords = file.objects.flatMap((object) =>
    HANDLER_KEYWORDS.flatMap((keyword) => keywordFinding(object, keyword, src)),
  );
  return [...registered, ...keywords];
}
