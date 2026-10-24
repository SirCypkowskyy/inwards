/**
 * @file Reading an `inwards-baseline.json`: the JSON, the schema, and each
 * entry with its optional hand-written `reason`. It owns what counts as a
 * readable baseline and which read errors `inwards baseline` may regenerate
 * over. It does no I/O of its own (the caller passes the file reader) and
 * knows nothing about rules, matching or writing; `_file.ts` does that.
 */
import { ConfigError } from "@inwards/core";
import { isRecord } from "../../shared/json/guards.ts";
import type { FileReader, PathProbe } from "../../shared/platform/contracts.ts";

/** What reading a baseline needs. */
export interface BaselineReads {
  probe: Pick<PathProbe, "exists">;
  read: Pick<FileReader, "text">;
}

export const SCHEMA = "inwards/baseline@1";
/** The byte order mark Windows PowerShell 5 puts before UTF-8 text. */
const BOM = /^\uFEFF/u;
const REGENERATE = "Ask the user to regenerate it with `inwards baseline`.";

/**
 * One accepted violation, with how many times the module has it, and why it
 * is accepted when someone wrote that down.
 */
export interface Entry {
  code: string;
  module: string;
  message: string;
  count: number;
  reason?: string;
}

/**
 * Reads the entries of the baseline `inwards baseline` is about to replace.
 * A baseline this version can't read (not JSON, another schema, a malformed
 * entry) has none: it is being replaced. A reason that isn't a string is the
 * exception, because replacing the file would silently drop every other
 * entry's reason, so the user fixes that one by hand first.
 *
 * @param io - reads the baseline.
 * @param path - the baseline file.
 * @returns the old entries, or none when there is no readable baseline.
 * @throws {ConfigError} when an entry has a `reason` that isn't a string; the
 *   file is left as it is.
 */
export function previousEntries(io: BaselineReads, path: string): Entry[] {
  let violations: unknown[] | undefined;
  try {
    violations = readViolations(io, path);
  } catch {
    return [];
  }
  if (violations === undefined) {
    return [];
  }
  checkReasons(path, violations);
  return entriesOf(violations) ?? [];
}

/**
 * Reads a baseline's entries.
 *
 * @param io - tells whether the file exists and reads it.
 * @param path - the baseline file.
 * @returns the entries, or undefined when there is no baseline.
 * @throws {ConfigError} when the file isn't a baseline this version understands.
 */
export function readEntries(io: BaselineReads, path: string): Entry[] | undefined {
  const violations = readViolations(io, path);
  if (violations === undefined) {
    return undefined;
  }
  checkReasons(path, violations);
  const entries = entriesOf(violations);
  if (entries === undefined) {
    throw new ConfigError(`${path} has a malformed entry. ${REGENERATE}`);
  }
  return entries;
}

/**
 * Reads a baseline's `violations` array, without checking its elements. A
 * leading byte order mark is skipped: Windows PowerShell 5 writes one when it
 * saves a file as UTF-8.
 *
 * @param io - tells whether the file exists and reads it.
 * @param path - the baseline file.
 * @returns the raw `violations` elements, or undefined when there is no baseline.
 * @throws {ConfigError} when the file isn't JSON or isn't an `inwards/baseline@1` file.
 */
function readViolations(io: BaselineReads, path: string): unknown[] | undefined {
  if (!io.probe.exists(path)) {
    return undefined;
  }
  const text = io.read.text(path);
  let value: unknown;
  try {
    value = JSON.parse(text.replace(BOM, ""));
  } catch (err) {
    throw new ConfigError(`${path} is not valid JSON. ${REGENERATE}`, {
      cause: err,
    });
  }
  const violations = isRecord(value) ? value["violations"] : undefined;
  if (!(isRecord(value) && value["schema"] === SCHEMA && Array.isArray(violations))) {
    throw new ConfigError(`${path} is not an ${SCHEMA} file. ${REGENERATE}`);
  }
  return violations;
}

/**
 * Refuses a `reason` that isn't a string, naming the first entry that has
 * one (1-based).
 *
 * @param path - the baseline file, for the message.
 * @param violations - the raw `violations` elements.
 * @throws {ConfigError} when an entry's `reason` isn't a string.
 */
function checkReasons(path: string, violations: readonly unknown[]): void {
  const index = violations.findIndex(
    (v) => isRecord(v) && "reason" in v && typeof v["reason"] !== "string",
  );
  if (index !== -1) {
    throw new ConfigError(
      `${path}: violation ${index + 1} has a "reason" that is not a string. A reason is text, such as "Moves into bootstrap in #123"; fix it or remove it.`,
    );
  }
}

/**
 * Turns the raw `violations` elements into entries, all or nothing.
 *
 * @param violations - the raw elements.
 * @returns the entries, or undefined when any element isn't an entry.
 */
function entriesOf(violations: readonly unknown[]): Entry[] | undefined {
  const entries = violations.filter(isEntry);
  return entries.length === violations.length ? entries : undefined;
}

/**
 * Tells whether a parsed value is a baseline entry.
 *
 * @param value - one element of `violations`.
 * @returns true for `{code, module, message, count}` with a positive integer
 *   count, and a `reason` that is a string when there is one; other keys are allowed.
 */
function isEntry(value: unknown): value is Entry {
  return (
    isRecord(value) &&
    typeof value["code"] === "string" &&
    typeof value["module"] === "string" &&
    typeof value["message"] === "string" &&
    typeof value["count"] === "number" &&
    Number.isInteger(value["count"]) &&
    value["count"] > 0 &&
    (!("reason" in value) || typeof value["reason"] === "string")
  );
}
