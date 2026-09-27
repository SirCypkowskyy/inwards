/**
 * @file Reading timestamps, the one pure use of `Date` that policy code needs.
 * The policy folders may not name the `Date` global at all (see biome.jsonc),
 * because most of its uses read the clock; the time itself comes from the
 * Clock contract. Parsing a recorded timestamp reads no clock, so it lives
 * here, behind a single, explained exception.
 */

/**
 * Reads an ISO 8601 timestamp, as the run log and session records store them.
 *
 * @param text - the timestamp, e.g. `2026-09-27T12:00:00.000Z`.
 * @returns milliseconds since the epoch, or NaN when the text isn't a timestamp.
 */
export function parseTime(text: string): number {
  // biome-ignore lint/style/noRestrictedGlobals: Date.parse is pure, and this is the one place policy code names Date.
  return Date.parse(text);
}
