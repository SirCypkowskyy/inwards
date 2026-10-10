/**
 * @file The words of an INW012 finding: how its message lists calls, where
 * it says the work should go (the `delegate-to` targets and their layers),
 * and the fix steps built from the signals an endpoint tripped. Plain
 * strings from what `check.ts` measured; it reads no syntax.
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
 * Quotes calls for a message, at most `MAX_NAMED` of them.
 *
 * @param texts - the callees as written.
 * @returns e.g. "`db.execute` and `httpx.post`", or "... and 3 more".
 */
function quoted(texts: readonly string[]): string {
  const named = texts.slice(0, MAX_NAMED).map((t) => `\`${t}\``);
  const more = texts.length - named.length;
  return joined(more > 0 ? [...named, `${more} more`] : named);
}

/**
 * Lists calls inside parentheses of a message, at most `MAX_NAMED` of them,
 * with commas only, so the sentence around them keeps its own "and".
 *
 * @param texts - the callees as written.
 * @returns e.g. "`db.execute`, `httpx.post`", or "..., 3 more".
 */
export function listed(texts: readonly string[]): string {
  const named = texts.slice(0, MAX_NAMED).map((t) => `\`${t}\``);
  const more = texts.length - named.length;
  return [...named, ...(more > 0 ? [`${more} more`] : [])].join(", ");
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
 * @param lines - the first and last line of its counted statements.
 * @returns the summary and the steps.
 */
export function fixFor(
  name: string,
  tripped: Tripped,
  where: string,
  lines: readonly [number, number],
): Fix {
  const [first, last] = lines;
  const span = first === last ? `line ${first}` : `lines ${first} to ${last}`;
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
    "Don't move the code into a helper function in the same module to get under the limits: the work would still live in the HTTP layer.",
  ];
  return {
    summary: `Move the work out of \`${name}\` into ${where}, and keep the endpoint to HTTP.`,
    steps,
  };
}
