/**
 * Baseline keys: how a diagnostic matches an accepted violation. The CLI owns
 * the baseline file; the engine only receives its keys and counts as data, so
 * it can skip the confirming parse of a file whose skeleton findings the
 * baseline accepts in full (see `Engine.checkFiles`).
 */
import type { Diagnostic } from "./types.ts";

/** INW001 and INW011 end with the whole layer order, which isn't part of the violation. */
const DIRECTION = / Allowed direction: [^\n]*$/u;

/**
 * Drops the part of a message that depends on the rest of the config, so
 * adding an unrelated layer doesn't bring every accepted violation back.
 *
 * @param message - a diagnostic message.
 * @returns the message without its "Allowed direction" sentence.
 */
export function stableMessage(message: string): string {
  return message.replace(DIRECTION, "");
}

/**
 * The key a baseline entry and a diagnostic match on. Never the line, so a
 * moved import stays accepted.
 *
 * @param d - a diagnostic or baseline entry.
 * @returns rule, module and stable message joined.
 */
export function baselineKey(d: Pick<Diagnostic, "code" | "module" | "message">): string {
  return `${d.code}\u0000${d.module}\u0000${stableMessage(d.message)}`;
}

/**
 * Tells whether the baseline would hide every one of a file's findings: each
 * is an error (warnings are never baselined) and each key has enough accepted
 * copies left for all of the file's findings with that key.
 *
 * @param found - the findings.
 * @param left - accepted copies not yet used, by key.
 * @returns true when nothing among the findings would be reported.
 */
export function allAccepted(
  found: readonly Diagnostic[],
  left: ReadonlyMap<string, number>,
): boolean {
  const need = new Map<string, number>();
  for (const d of found) {
    const key = baselineKey(d);
    need.set(key, (need.get(key) ?? 0) + 1);
    if (d.severity !== "error" || (need.get(key) ?? 0) > (left.get(key) ?? 0)) {
      return false;
    }
  }
  return true;
}

/**
 * Uses up accepted copies the way the CLI's baseline does, one per matching
 * error in report order, so the engine knows how many are still left.
 *
 * @param found - findings, in report order.
 * @param left - accepted copies not yet used, by key; updated in place.
 */
export function spendAccepted(found: readonly Diagnostic[], left: Map<string, number>): void {
  for (const d of found) {
    const n = d.severity === "error" ? (left.get(baselineKey(d)) ?? 0) : 0;
    if (n > 0) {
      left.set(baselineKey(d), n - 1);
    }
  }
}
