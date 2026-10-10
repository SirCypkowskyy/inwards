/**
 * @file The stages a file goes through in the engine, and the helpers that
 * join them. A scan holds what the prescan found, a confirmation what the
 * full parse found, and a check's result the findings to report. The helpers
 * put a full parse's findings in source order, add the findings of rules
 * that parse a file on their own (FAPI, INW012), and keep each
 * unassigned-package warning once across files.
 */
import type {
  Diagnostic,
  ImportRef,
  SourceFile,
  Suppressed,
  SuppressionComment,
} from "../contracts/records.ts";
import { mentionsSuppression } from "../rules/suppression-comment.ts";

/** A file after the prescan, before any full parse. */
export interface Scan {
  /** The findings so far; null when the prescan was skipped or refused the file. */
  found: Diagnostic[] | null;
  /** True when `found` is final and needs no full parse. */
  exact: boolean;
  /** True when the full parse must also look for dynamic imports (INW011). */
  dynamic: boolean;
  /** The skeleton's imports, when the prescan read the file. */
  imports?: readonly ImportRef[];
}

/** A file's findings after the full parse, if it ran, and its suppression comments. */
export interface Confirmed {
  found: Diagnostic[];
  /** Read from the full parse of a file that mentions `inwards: ignore`; absent otherwise. */
  comments?: SuppressionComment[];
  /** The full parse's imports, readable dynamic ones included, when it ran. */
  imports?: readonly ImportRef[];
}

/** What `check` returns: the findings to report, and the ones inline suppressions hid. */
export interface Checked {
  diagnostics: Diagnostic[];
  suppressed: Suppressed[];
}

/**
 * Orders a full parse's findings and attaches the comments when the file may
 * hold a suppression, as suppress() expects.
 *
 * @param file - the source file, with normalised text.
 * @param found - the findings, in any order.
 * @param comments - the file's suppression comments.
 * @returns the findings in source order, with the comments when they matter.
 */
export function ordered(
  file: SourceFile,
  found: Diagnostic[],
  comments: SuppressionComment[],
): Confirmed {
  found.sort((a, b) => a.line - b.line || a.column - b.column);
  return mentionsSuppression(file.text) ? { found, comments } : { found };
}

/**
 * Keeps each warning that names no place once across files: the INW006
 * warning for an unassigned package is kept on its first file. An
 * unused-suppression warning (INW009) is each comment's own and always kept,
 * and so is an INW012 warning, which is each endpoint's own.
 *
 * @param kept - one file's findings, after its suppressions.
 * @param warned - the warnings kept so far, by message, updated in place.
 * @returns the findings to report for the file.
 */
export function keptOnce(kept: readonly Diagnostic[], warned: Set<string>): Diagnostic[] {
  return kept.filter((found) => {
    if (found.severity !== "warning" || found.code === "INW009" || found.code === "INW012") {
      return true;
    }
    const first = !warned.has(found.message);
    warned.add(found.message);
    return first;
  });
}

/**
 * Adds findings another stage found in a file to its confirmed ones, in source order.
 *
 * @param confirmed - the file's confirmed findings.
 * @param extra - the other findings in the same file.
 * @returns the confirmed findings with the extra ones.
 */
export function withFound(confirmed: Confirmed, extra: readonly Diagnostic[]): Confirmed {
  if (extra.length === 0) {
    return confirmed;
  }
  const found = [...confirmed.found, ...extra].sort(
    (a, b) => a.line - b.line || a.column - b.column,
  );
  return { ...confirmed, found };
}
