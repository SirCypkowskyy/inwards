/**
 * @file What every part of the `[tool.inwards]` parser shares: the error it throws
 * and the checks for walking untrusted TOML without casts. Adapters catch
 * `ConfigError` and report it as a config error, never as a crash.
 */

export class ConfigError extends Error {
  override name = "ConfigError";
}

/**
 * Tells whether a parsed value is a table (or array) whose keys can be read.
 * Used to walk untrusted TOML without casts.
 *
 * @param value - any value from the parsed document.
 * @returns true when the value is a non-null object.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Throws on the first key a table isn't allowed to have.
 *
 * @param table - a parsed TOML table.
 * @param known - the keys it may have.
 * @param where - the table's dotted path, for the message.
 * @throws {ConfigError} naming the unknown key and the known ones.
 */
export function rejectUnknownKeys(
  table: Record<string, unknown>,
  known: ReadonlySet<string>,
  where: string,
): void {
  const unknown = Object.keys(table).find((key) => !known.has(key));
  if (unknown !== undefined) {
    throw new ConfigError(`Unknown key ${where}.${unknown}. Known keys: ${[...known].join(", ")}.`);
  }
}

/** A dotted Python name: identifiers joined by dots, e.g. `http.client` or `shop.orders`. */
const DOTTED_NAME = /^[\p{XID_Start}_]\p{XID_Continue}*(?:\.[\p{XID_Start}_]\p{XID_Continue}*)*$/u;

/**
 * Tells whether a value is a dotted Python name, as a module or import name
 * in the config must be.
 *
 * @param value - any value from the parsed document.
 * @returns true for a string of identifiers joined by dots, with no wildcards.
 */
export function isDottedName(value: unknown): value is string {
  return typeof value === "string" && DOTTED_NAME.test(value);
}
