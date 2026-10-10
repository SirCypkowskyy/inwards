/**
 * @file Typed reads of a FAPI rule's options table, with the rule's default
 * when a key is absent. `config/rule-options.ts` has already checked each
 * value, so these only narrow the type; they never report a bad value.
 */
import { stringList } from "../../config/rule-options.ts";
import type { RuleOptions } from "../../config/rule-settings.ts";

/**
 * Reads a boolean option.
 *
 * @param raw - the rule's options table, if any.
 * @param key - the TOML key.
 * @param fallback - the default.
 * @returns the value, or the default when the key is absent.
 */
export function flag(raw: RuleOptions | undefined, key: string, fallback: boolean): boolean {
  const value = raw?.[key];
  return typeof value === "boolean" ? value : fallback;
}

/**
 * Reads a list option.
 *
 * @param raw - the rule's options table, if any.
 * @param key - the TOML key.
 * @param fallback - the default.
 * @returns the value, or the default when the key is absent.
 */
export function list(
  raw: RuleOptions | undefined,
  key: string,
  fallback: readonly string[],
): readonly string[] {
  return stringList(raw?.[key]) ?? fallback;
}

/**
 * Reads a list option that has no default value.
 *
 * @param raw - the rule's options table, if any.
 * @param key - the TOML key.
 * @returns the value, or undefined when the key is absent.
 */
export function optionalList(
  raw: RuleOptions | undefined,
  key: string,
): readonly string[] | undefined {
  return stringList(raw?.[key]);
}
