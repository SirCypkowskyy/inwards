/**
 * @file Tells whether an endpoint is a health check, which INW012 leaves
 * alone (#360): its route path or its function name says `health`,
 * `healthz`, `livez`, `readyz`, `liveness` or `readiness`, the names
 * Kubernetes probes and load balancers call. A health check's job is to
 * touch the database and the cache and say whether they answer, so the
 * session calls and the branches INW012 counts are what it is for. It reads
 * names only.
 */

/** The words that make a path segment or a function name a health check's. */
const HEALTH: ReadonlySet<string> = new Set([
  "health",
  "healthz",
  "healthcheck",
  "livez",
  "readyz",
  "liveness",
  "readiness",
]);

/**
 * Splits a name or a path into its words: on `/`, `-`, `_` and `.`, lower-cased.
 *
 * @param text - a function name such as `liveness_probe`, or a path such as `/internal/readyz/`.
 * @returns the words, e.g. `liveness` and `probe`.
 */
function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[/\-_.]+/u)
    .filter((word) => word !== "");
}

/**
 * Tells whether an endpoint is a health check by its route path or its name.
 *
 * @param name - the endpoint's name; `Class.method` for a view method.
 * @param route - the literal route path, when the decorator or registration spells one.
 * @returns true when either holds one of the health-check words as a word of its own.
 */
export function isHealthCheck(name: string, route: string | undefined): boolean {
  return [...words(name), ...words(route ?? "")].some((word) => HEALTH.has(word));
}
