/**
 * @file The words of an INW012 finding: how its message lists calls and
 * the helpers it counted, where it says the work should go (the
 * `delegate-to` targets and their layers), and the fix steps built from the
 * signals an endpoint tripped. Plain strings from what `check.ts` measured;
 * it reads no syntax.
 */
import type { LayerSpec } from "../../config/layers.ts";
import type { Fix } from "../../contracts/records.ts";
import { joined } from "../shared/words.ts";

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
 * Names where the endpoint's work should go, for a message or fix step.
 *
 * @param targets - the `delegate-to` entries, or none.
 * @param layers - the configured layers.
 * @returns e.g. "the `application` layer (`shop.application`)", or "a service or use-case module".
 */
export function targetText(targets: readonly string[], layers: readonly LayerSpec[]): string {
  if (targets.length === 0) {
    return "a service or use-case module";
  }
  return joined(
    targets.map((target) => {
      const layer = layers.find((l) => l.name === target);
      const modules = layer ? ` (${layer.modules.map((m) => `\`${m}\``).join(", ")})` : "";
      return layer ? `the \`${target}\` layer${modules}` : `a module matching \`${target}\``;
    }),
    "or",
  );
}

/**
 * Writes the fix for one endpoint from what it tripped.
 *
 * @param name - the endpoint's name, which the summary quotes.
 * @param tripped - what it tripped.
 * @param where - where the work goes, as `targetText` names it.
 * @param body - where its own body and its helpers' live.
 * @param body.spans - its own body first, then its helpers'.
 * @param body.path - the endpoint's file when it isn't the finding's, else undefined.
 * @returns the summary and the steps.
 */
export function fixFor(
  name: string,
  tripped: Tripped,
  where: string,
  { spans, path }: { spans: readonly BodySpan[]; path: string | undefined },
): Fix {
  const span = linesText(spans, path);
  const steps = [
    ...(tripped.logic
      ? [
          `Move the logic (${span}) into a function in ${where} that takes plain arguments and returns a domain object or a result the endpoint maps to the response.`,
        ]
      : []),
    ...(tripped.undelegated && !tripped.logic
      ? [
          `Call a use case in ${where} from the endpoint (inject it with Depends) instead of doing its work here.`,
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
    "In the endpoint keep only: read the request, call the use case, map its errors to `HTTPException`, and return the response model.",
    "Don't move the code into a helper function in the same module: INW012 counts a helper's body as the endpoint's, and the work would still live in the HTTP layer.",
  ];
  return {
    summary: `Move the work out of \`${name}\` into ${where}, and keep the endpoint to HTTP.`,
    steps,
  };
}
