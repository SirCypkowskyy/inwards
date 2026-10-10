/**
 * @file The building blocks of the rule options parsers in
 * `rule-options.ts`: booleans, one of a few literals, lists drawn from a set
 * or matching a pattern, and INW016's column suffixes. Each checks one raw
 * TOML value and returns it as stored, or throws a `ConfigError` that names
 * the key. They know no rule and no key: `rule-options.ts` maps keys to them.
 */
import { ConfigError } from "./toml.ts";

/**
 * Tells whether a raw value is a list of strings.
 *
 * @param value - a raw TOML value.
 * @returns true for an array whose entries are all strings, empty included.
 */
export function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((e) => typeof e === "string");
}

/**
 * Parses `true` or `false`.
 *
 * @param value - the raw value.
 * @param where - the key's dotted path.
 * @returns the value, unchanged.
 * @throws {ConfigError} for anything else.
 */
export function boolean(value: unknown, where: string): boolean {
  if (typeof value !== "boolean") {
    throw new ConfigError(`${where} must be true or false.`);
  }
  return value;
}

/**
 * Makes a parser for one of a few literal values.
 *
 * @param values - the allowed values.
 * @returns the parser.
 */
export function oneOf(
  values: readonly (string | boolean)[],
): (value: unknown, where: string) => string | boolean {
  return (value: unknown, where: string): string | boolean => {
    if (!((typeof value === "string" || typeof value === "boolean") && values.includes(value))) {
      const listed = values.map((v) => JSON.stringify(v)).join(", ");
      throw new ConfigError(`${where} must be one of ${listed}.`);
    }
    return value;
  };
}

/**
 * Makes a parser for a list of distinct strings drawn from a fixed set, empty included.
 *
 * @param values - the allowed entries.
 * @returns the parser.
 */
export function listOf(values: readonly string[]): (value: unknown, where: string) => string[] {
  return (value: unknown, where: string): string[] => {
    const ok = isStringList(value) && value.every((e) => values.includes(e));
    if (!ok || new Set(value).size !== value.length) {
      const listed = values.map((v) => `"${v}"`).join(", ");
      throw new ConfigError(`${where} must be a list of distinct entries from ${listed}.`);
    }
    return value;
  };
}

/**
 * Makes a parser for a list of strings that each match a pattern, empty included.
 *
 * @param pattern - what every entry must match.
 * @param example - how the message describes a good entry.
 * @returns the parser.
 */
export function listMatching(
  pattern: RegExp,
  example: string,
): (value: unknown, where: string) => string[] {
  return (value: unknown, where: string): string[] => {
    if (!(isStringList(value) && value.every((e) => pattern.test(e)))) {
      throw new ConfigError(`${where} must be a list of ${example}.`);
    }
    return value;
  };
}

/** A column-name suffix INW016 requires: lower-case letters, digits and underscores. */
const SUFFIX = /^[a-z0-9_]+$/u;

/**
 * Parses one of INW016's suffixes: a non-empty lower_case_snake fragment such
 * as `"_at"`, or `false` to turn that check off.
 *
 * @param value - the raw value.
 * @param where - the key's dotted path.
 * @returns the suffix, or false.
 * @throws {ConfigError} for anything else.
 */
export function suffix(value: unknown, where: string): string | false {
  if (!(value === false || (typeof value === "string" && SUFFIX.test(value)))) {
    throw new ConfigError(
      `${where} must be a suffix of lower-case letters, digits and underscores, such as "_at", or false to turn the check off.`,
    );
  }
  return value;
}
