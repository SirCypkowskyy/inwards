/**
 * @file The words of an INW012 finding: how its message lists calls and
 * the helpers it counted, where it says the work should go (the
 * `delegate-to` targets and their layers), and the fix steps built from the
 * signals an endpoint tripped. Plain strings from what `check.ts` measured;
 * it reads no syntax.
 */
import { filledFrom } from "../../config/layer-selector.ts";
import type { LayerSpec } from "../../config/layers.ts";
import type { Fix } from "../../contracts/records.ts";
import { joined } from "../shared/words.ts";
import type { Kind } from "./frameworks.ts";

/** How many calls a message names before it says how many more there are. */
const MAX_NAMED = 6;

/** What one endpoint tripped. */
export interface Tripped {
  /** The message's parts, e.g. `14 statements (max 10)`. */
  readonly parts: string[];
  /** True when size, branching, nesting or loops tripped: the logic should move. */
  readonly logic: boolean;
  /** Denied method calls on a session-like parameter, as written. */
  readonly receivers: readonly string[];
  /** The layer a session-like parameter's type or dependency comes from, if a layer owns one. */
  readonly sessionLayer: string | undefined;
  /** Denied calls by qualified name, as written. */
  readonly denied: readonly string[];
  /** True when `delegate-to` is set and nothing in it is called. */
  readonly undelegated: boolean;
}

/**
 * Keeps the first `MAX_NAMED` items of a list and counts the rest.
 *
 * @param items - the words to list.
 * @returns e.g. the first six, then "3 more".
 */
function capped(items: readonly string[]): string[] {
  const named = items.slice(0, MAX_NAMED);
  const more = items.length - named.length;
  return more > 0 ? [...named, `${more} more`] : named;
}

/**
 * Quotes calls for a message, at most `MAX_NAMED` of them.
 *
 * @param texts - the callees as written.
 * @returns e.g. "`db.execute` and `httpx.post`", or "... and 3 more".
 */
function quoted(texts: readonly string[]): string {
  return joined(capped(texts.map((t) => `\`${t}\``)));
}

/**
 * Lists calls inside parentheses of a message, at most `MAX_NAMED` of them,
 * with commas only, so the sentence around them keeps its own "and".
 *
 * @param texts - the callees as written.
 * @returns e.g. "`db.execute`, `httpx.post`", or "..., 3 more".
 */
export function listed(texts: readonly string[]): string {
  return capped(texts.map((t) => `\`${t}\``)).join(", ");
}

/** Where one counted body lives, for the message and the fix. */
export interface BodySpan {
  /** The helper's name; undefined for the endpoint's own body. */
  readonly helper: string | undefined;
  /** The `def` line, 1-based. */
  readonly line: number;
  /** The first and last line of its counted statements, 1-based; 0 when there are none. */
  readonly lines: readonly [number, number];
}

/**
 * Names the helpers whose bodies a finding counted, for the end of its message.
 *
 * @param spans - the endpoint's own body first, then its helpers'.
 * @param path - the helpers' file when it isn't the finding's, else undefined.
 * @returns e.g. ", counting the same-module helper `_impl` (line 30)", or "" without helpers.
 */
export function helperText(spans: readonly BodySpan[], path: string | undefined): string {
  const helpers = spans.flatMap(({ helper, line }) =>
    helper === undefined
      ? []
      : [`\`${helper}\` (${path === undefined ? "" : `${path}, `}line ${line})`],
  );
  if (helpers.length === 0) {
    return "";
  }
  const noun = helpers.length === 1 ? "helper" : "helpers";
  return `, counting the same-module ${noun} ${joined(capped(helpers))}`;
}

/**
 * Names a range of lines.
 *
 * @param lines - the first and last line, 1-based.
 * @returns "line 4" or "lines 4 to 9".
 */
function range(lines: readonly [number, number]): string {
  const [first, last] = lines;
  return first === last ? `line ${first}` : `lines ${first} to ${last}`;
}

/**
 * Says which lines hold the logic to move: the endpoint's own, then each helper's.
 *
 * @param spans - the endpoint's own body first, then its helpers'.
 * @param path - the endpoint's file when it isn't the finding's, else undefined.
 * @returns e.g. "lines 13 to 14, and `_impl` at lines 18 to 29".
 */
function linesText(spans: readonly BodySpan[], path: string | undefined): string {
  const [own, ...helpers] = spans;
  const ownText =
    own && own.lines[0] > 0 ? [`${path === undefined ? "" : `${path}, `}${range(own.lines)}`] : [];
  const helperTexts = helpers
    .filter(({ lines }) => lines[0] > 0)
    .map(({ helper, lines }) => `\`${helper ?? ""}\` at ${range(lines)}`);
  const joinedHelpers = helperTexts.length === 0 ? [] : [joined(helperTexts)];
  return [...ownText, ...joinedHelpers].join(", and ");
}

/**
 * Names the module a selector stands for in the endpoint's package, when
 * that is another module than the endpoint's own.
 *
 * @param entry - a layer entry or \`delegate-to\` target.
 * @param module - the endpoint's module.
 * @returns e.g. \`src.posts.service\` for \`src.*.service\` and \`src.posts.router\`, else undefined.
 */
function sibling(entry: string, module: string): string | undefined {
  const filled = filledFrom(entry, module);
  return filled === module ? undefined : filled;
}

/**
 * Lists a layer's modules for a message: the ones its selectors stand for
 * next to the endpoint when any fit, else the entries as configured.
 *
 * @param layer - the target layer.
 * @param module - the endpoint's module, which fills the selectors' wildcards.
 * @returns e.g. "`src.posts.service`" for `src.*.service`, or "`shop.application`".
 */
function layerModules(layer: LayerSpec, module: string): string {
  const filled = [...new Set(layer.modules.flatMap((entry) => sibling(entry, module) ?? []))];
  return (filled.length > 0 ? filled : layer.modules).map((m) => `\`${m}\``).join(", ");
}

/**
 * Names one \`delegate-to\` target for a message or fix step: a layer with its
 * modules, or a module prefix or selector, naming the module a selector
 * stands for in the endpoint's package when the endpoint fits its shape.
 *
 * @param target - one \`delegate-to\` entry.
 * @param layers - the configured layers.
 * @param module - the endpoint's module.
 * @returns e.g. "the \`domain.service\` layer (\`src.posts.service\`)" or "\`src.posts.service\` (a module matching \`src.*.service\`)".
 */
function oneTarget(target: string, layers: readonly LayerSpec[], module: string): string {
  const layer = layers.find((l) => l.name === target);
  if (layer) {
    return `the \`${target}\` layer (${layerModules(layer, module)})`;
  }
  const filled = sibling(target, module);
  return filled === undefined
    ? `a module matching \`${target}\``
    : `\`${filled}\` (a module matching \`${target}\`)`;
}

/**
 * Names where the endpoint's work should go, for a message or fix step.
 *
 * @param targets - the \`delegate-to\` entries, or none.
 * @param layers - the configured layers.
 * @param module - the endpoint's module, whose package fills a selector's wildcards.
 * @returns e.g. "the \`application\` layer (\`shop.application\`)", or "a service or use-case module".
 */
export function targetText(
  targets: readonly string[],
  layers: readonly LayerSpec[],
  module: string,
): string {
  if (targets.length === 0) {
    return "a service or use-case module";
  }
  return joined(
    targets.map((target) => oneTarget(target, layers, module)),
    "or",
  );
}

/** How the fix words the HTTP side of an endpoint, by the framework that marked it. */
const HTTP_WORDS: Readonly<
  Record<Kind, { readonly inject: string; readonly errors: string; readonly response: string }>
> = {
  fastapi: {
    inject: " (inject it with Depends)",
    errors: "`HTTPException`",
    response: "response model",
  },
  custom: {
    inject: " (inject it with Depends)",
    errors: "`HTTPException`",
    response: "response model",
  },
  litestar: {
    inject: " (inject it with `Provide`)",
    errors: "`HTTPException`",
    response: "response",
  },
  flask: { inject: "", errors: "HTTP errors with `abort()`", response: "response" },
  django: {
    inject: "",
    errors: "HTTP errors (`Http404`, or an `APIException` in DRF)",
    response: "response",
  },
};

/**
 * Writes the fix for one endpoint from what it tripped.
 *
 * @param name - the endpoint's name, which the summary quotes.
 * @param tripped - what it tripped.
 * @param where - where the work goes, as `targetText` names it.
 * @param body - where its own body and its helpers' live.
 * @param body.spans - its own body first, then its helpers'.
 * @param body.path - the endpoint's file when it isn't the finding's, else undefined.
 * @param body.kind - the framework that marked the endpoint, which words how it injects and maps errors.
 * @returns the summary and the steps.
 */
export function fixFor(
  name: string,
  tripped: Tripped,
  where: string,
  { spans, path, kind }: { spans: readonly BodySpan[]; path: string | undefined; kind: Kind },
): Fix {
  const http = HTTP_WORDS[kind];
  const span = linesText(spans, path);
  const steps = [
    ...(tripped.logic
      ? [
          `Move the logic (${span}) into a function in ${where} that takes plain arguments and returns a domain object or a result the endpoint maps to the response.`,
        ]
      : []),
    ...(tripped.undelegated && !tripped.logic
      ? [
          `Call a use case in ${where} from the endpoint${http.inject} instead of doing its work here.`,
        ]
      : []),
    ...(tripped.receivers.length > 0
      ? [
          `Move ${quoted(tripped.receivers)} behind a repository in ${tripped.sessionLayer === undefined ? "an outer layer" : `the \`${tripped.sessionLayer}\` layer`}, and give the use case a Protocol it can call.`,
        ]
      : []),
    ...(tripped.denied.length > 0
      ? [
          `Move ${quoted(tripped.denied)} into an adapter (a repository, an API client or a background task) that the use case reaches through a Protocol.`,
        ]
      : []),
    `In the endpoint keep only: read the request, call the use case, map its errors to ${http.errors}, and return the ${http.response}.`,
    "Don't move the code into a helper function in the same module: INW012 counts a helper's body as the endpoint's, and the work would still live in the HTTP layer.",
  ];
  return {
    summary: `Move the work out of \`${name}\` into ${where}, and keep the endpoint to HTTP.`,
    steps,
  };
}
