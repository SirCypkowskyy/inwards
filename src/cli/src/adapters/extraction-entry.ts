/**
 * @file The shape of one entry of the extraction cache on disk (#56), and
 * the checks a parsed entry must pass before it is used. Anything that fails
 * them is a miss, so a corrupt or hand-edited file can't crash a check. The
 * worker pool (#61) checks its workers' answers with the same guards.
 */
import type { CachedExtraction, ImportRef, SuppressionComment } from "@inwards/core";

/** What an entry file holds: the identity it was written for, and the components. */
export interface Entry {
  format: string;
  revision: string;
  module: string;
  isPackage: boolean;
  textHash: string;
  value: CachedExtraction;
}

/**
 * Tells whether a parsed file is a well-formed entry.
 *
 * @param value - the parsed JSON.
 * @returns true for an entry whose components have the right shapes.
 */
export function isEntry(value: unknown): value is Entry {
  return (
    isRecord(value) &&
    typeof value["format"] === "string" &&
    typeof value["revision"] === "string" &&
    typeof value["module"] === "string" &&
    typeof value["isPackage"] === "boolean" &&
    typeof value["textHash"] === "string" &&
    isExtraction(value["value"])
  );
}

/**
 * Tells whether a parsed value holds well-formed components.
 *
 * @param value - the entry's `value`, or a worker's answer.
 * @returns true when every present component has its shape.
 */
export function isExtraction(value: unknown): value is CachedExtraction {
  if (!isRecord(value)) {
    return false;
  }
  const { skeleton, full, comments } = value;
  return (
    (skeleton === undefined || skeleton === "refused" || isImportList(skeleton)) &&
    (full === undefined || isImportList(full)) &&
    (comments === undefined || (Array.isArray(comments) && comments.every(isComment)))
  );
}

/**
 * Tells whether a value is a list of import references.
 *
 * @param value - any parsed value.
 * @returns true for an array of well-formed references.
 */
function isImportList(value: unknown): value is ImportRef[] {
  return Array.isArray(value) && value.every(isImportRef);
}

/**
 * Tells whether a value is an import reference.
 *
 * @param value - any parsed value.
 * @returns true for a span with a target, a statement and an optional `from`.
 */
function isImportRef(value: unknown): value is ImportRef {
  return (
    isSpan(value) &&
    typeof value["target"] === "string" &&
    typeof value["statement"] === "string" &&
    (value["from"] === undefined || typeof value["from"] === "string")
  );
}

/**
 * Tells whether a value is a suppression comment.
 *
 * @param value - any parsed value.
 * @returns true for a span-bearing comment with codes, a reason and problems.
 */
function isComment(value: unknown): value is SuppressionComment {
  return (
    isRecord(value) &&
    isSpan(value["span"]) &&
    isStringList(value["codes"]) &&
    typeof value["reason"] === "string" &&
    isStringList(value["problems"])
  );
}

/**
 * Tells whether a value carries a 1-based span of whole numbers.
 *
 * @param value - any parsed value.
 * @returns true when line, column, endLine and endColumn are positive integers.
 */
function isSpan(value: unknown): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    ["line", "column", "endLine", "endColumn"].every(
      (key) => Number.isInteger(value[key]) && Number(value[key]) >= 1,
    )
  );
}

/**
 * Tells whether a value is a list of strings.
 *
 * @param value - any parsed value.
 * @returns true for an array of strings.
 */
function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/**
 * Tells whether a parsed value is a JSON object.
 *
 * @param value - any parsed JSON value, or a message from a worker.
 * @returns true for a non-null, non-array object.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
