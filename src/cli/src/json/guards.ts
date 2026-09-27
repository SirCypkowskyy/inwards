/**
 * Type guards for values parsed from JSON or TOML: settings files, hook
 * payloads, baselines and pyproject tables. The CLI reads all of them as
 * `unknown` and narrows them here before looking inside.
 *
 * Pure: no I/O and no dependencies, so any feature folder may import it.
 */

/**
 * Tells whether a parsed value is a plain object (a JSON object or TOML table).
 *
 * @param value - any parsed JSON or TOML value.
 * @returns true for a non-null, non-array object.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
