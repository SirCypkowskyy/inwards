/**
 * Baseline keys: how a diagnostic matches an accepted violation. The CLI owns
 * the baseline file; the engine only receives its keys and counts as data, so
 * it can skip the confirming parse of a module whose skeleton findings the
 * baseline accepts in full (see `acceptedModules`).
 */
import type { Diagnostic } from "../contracts/records.ts";

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
 * Finds the modules whose findings the baseline hides in full, so the engine
 * can skip their confirming parse. Keys hold the module, so one module's
 * findings never use up another's copies. A module qualifies when every file
 * of it went through the skeleton, every finding is an error (warnings are
 * never baselined), and for each key the findings across all its files
 * (`order.py` and `order.pyi` are one module) are no more than the accepted
 * copies. The skeleton never misses an import (ADR-004), and a finding
 * depends only on the import's target, which both parses read alike, so the
 * real findings are no more than the skeleton's and the baseline hides them
 * all, exactly as it would after the full parse.
 *
 * @param files - each file's module and scan findings, null when it had no skeleton.
 * @param accepted - accepted copies by baseline key.
 * @returns the modules whose skeleton findings can go unconfirmed.
 */
export function acceptedModules(
  files: readonly { module: string; found: readonly Diagnostic[] | null }[],
  accepted: ReadonlyMap<string, number>,
): Set<string> {
  const blocked = new Set<string>();
  const hits = new Map<string, { module: string; n: number }>();
  for (const { module, found } of files) {
    if (found === null || found.some((d) => d.severity !== "error")) {
      blocked.add(module);
      continue;
    }
    for (const d of found) {
      const key = baselineKey(d);
      hits.set(key, { module, n: (hits.get(key)?.n ?? 0) + 1 });
    }
  }
  for (const [key, { module, n }] of hits) {
    if (n > (accepted.get(key) ?? 0)) {
      blocked.add(module);
    }
  }
  return new Set(files.map((f) => f.module).filter((m) => !blocked.has(m)));
}
