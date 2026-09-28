/**
 * @file Violations a file already had when the session started. The PostToolUse
 * hook and the Stop gate hand them to the agent as context instead of
 * blocking on them, so an agent isn't pushed to rewrite code its task didn't
 * need (#134). A violation the agent adds to the same file still blocks.
 *
 * Each file with an error is checked again as it was at session start
 * (`start-content.ts`), looked up by its start identity
 * (`start-identity.ts`); a file with no proven start content has no old
 * errors: when in doubt, the gate blocks.
 */
import { resolve } from "node:path";
import { type Diagnostic, type Report, stableMessage } from "@inwards/core";
import type { Check, Start } from "./contracts.ts";
import { fingerprint } from "./fingerprint.ts";
import type { StartLookups } from "./lookups.ts";

/**
 * Picks the errors a check found that the files already had at session
 * start. Each file with an error is checked again as it was then; an error
 * is old while the start check has an error with the same fingerprint (rule,
 * module, message) left to match, so a second copy of an old import is new.
 *
 * @param lookups - this invocation's start lookups.
 * @param start - the session's start record.
 * @param check - the config the diagnostics came from, their base and baseline setting.
 * @param diagnostics - what the check of the changed files found.
 * @returns the old errors, the same objects as in `diagnostics`.
 */
export async function oldErrors(
  lookups: StartLookups,
  start: Start,
  check: Check,
  diagnostics: readonly Diagnostic[],
): Promise<Diagnostic[]> {
  const errors = diagnostics.filter((d) => d.severity === "error");
  const before = await atStart(lookups, start, check, errors);
  return carried(errors, before?.diagnostics.filter((d) => d.severity === "error") ?? []);
}

/**
 * Checks the files some findings are in again, as they were at session start.
 *
 * @param lookups - this invocation's start lookups.
 * @param start - the session's start record.
 * @param check - the config the findings came from, their base and baseline setting.
 * @param found - the findings whose files to check.
 * @returns the start check, or undefined when no file has a known start content.
 */
export async function atStart(
  lookups: StartLookups,
  start: Start,
  check: Check,
  found: readonly Diagnostic[],
): Promise<Report | undefined> {
  const texts = new Map<string, string>();
  for (const d of found) {
    const rel = lookups.identity.identityOf(lookups.project, check, d.file);
    const text =
      rel === undefined ? undefined : lookups.content.startText(lookups.project, start, rel);
    if (text !== undefined) {
      texts.set(resolve(check.base, d.file), text);
    }
  }
  if (texts.size === 0) {
    return undefined;
  }
  return await lookups.check(check.configPath, [...texts.keys()], check.base, {
    baseline: check.baseline,
    texts,
    config: check.config,
    absent: check.absent,
  });
}

/**
 * Picks the findings the start check had too: a finding is carried over
 * while the same file had one with the same fingerprint (rule, module,
 * message) left to match at start, so a second copy is new. The file counts
 * because `order.py` and `order.pyi` share a module: without it, a
 * suppression moved from one into the other would still match.
 *
 * @param now - the findings now.
 * @param before - the start check's findings of the same kind.
 * @returns the findings of `now` that were there at start, the same objects.
 */
export function carried(now: readonly Diagnostic[], before: readonly Diagnostic[]): Diagnostic[] {
  const left = new Map<string, number>();
  for (const d of before) {
    left.set(inFile(d), (left.get(inFile(d)) ?? 0) + 1);
  }
  return now.filter((d) => {
    const n = left.get(inFile(d)) ?? 0;
    if (n > 0) {
      left.set(inFile(d), n - 1);
    }
    return n > 0;
  });
}

/**
 * Tells the agent which violations were already there, and that they aren't its to fix.
 *
 * @param old - the old errors, from `oldErrors`.
 * @returns one line of advice, then one line per violation.
 */
export function oldNote(old: readonly Diagnostic[]): string {
  const lines = old.map((d) => `- ${d.file}:${d.line} ${d.code} ${stableMessage(d)}`);
  return [
    "These violations were already in the file when the session started, so they don't block. Leave them unless the task needs that code, and mention them to the user:",
    ...lines,
  ].join("\n");
}

/**
 * Keys a finding by its file and fingerprint, for `carried`.
 *
 * @param d - the finding.
 * @returns the report path and the fingerprint joined.
 */
function inFile(d: Diagnostic): string {
  return `${d.file}\u0000${fingerprint(d)}`;
}
