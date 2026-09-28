/**
 * @file Baseline keys: how a diagnostic matches an accepted violation. The CLI owns
 * the baseline file; the engine only receives its keys and counts as data, so
 * it can skip the confirming parse of a module whose skeleton findings the
 * baseline accepts in full (see `acceptedModules`).
 */
import type { Diagnostic } from "../contracts/records.ts";

/** INW001 and INW011 end with the whole layer order, which isn't part of the violation. */
const DIRECTION = / Allowed direction: [^\n]*$/u;
/**
 * INW006's messages end with what being outside every layer means for the
 * package, worded differently before INW002 ("nothing checks", "are not
 * checked"). Dropping that clause keeps older baselines matching, including
 * a package warning promoted to an error.
 */
const UNCHECKED =
  /, so (?:(?:nothing|no layer rule) checks what "[^"]*" imports|its imports are not checked|no layer rule checks its imports)\.$/u;

/**
 * INW005 calls a uv workspace member a "workspace package" since #203, where
 * it said "library" before; both spellings share one key, so older baselines
 * keep matching. A prefix deny's message (`Module "..." imports`, #219) is
 * read the same way.
 */
const WORKSPACE_PACKAGE =
  /^(?<head>(?:Layer|Module) "[^"]*" imports "[^"]*" from )workspace package "/u;

/** The rules whose messages end with the layer order. */
const WITH_DIRECTION: ReadonlySet<string> = new Set(["INW001", "INW011"]);

/**
 * Drops the part of a message that depends on the rest of the config, so
 * adding an unrelated layer doesn't bring every accepted violation back.
 * Only the rules that write those clauses lose them: another rule's message
 * may quote a name the user chose, such as a context called "billing Allowed
 * direction: EU", and must stay whole.
 *
 * @param d - a diagnostic or baseline entry: its rule code and message.
 * @param d.code - which rule wrote it, which decides what is dropped.
 * @param d.message - the text to normalise.
 * @returns the message without INW001's and INW011's "Allowed direction" sentence or INW006's closing clause, and with INW005's "workspace package" read as "library".
 */
export function stableMessage({ code, message }: Pick<Diagnostic, "code" | "message">): string {
  if (WITH_DIRECTION.has(code)) {
    return message.replace(DIRECTION, "");
  }
  if (code === "INW005") {
    return message.replace(WORKSPACE_PACKAGE, '$<head>library "');
  }
  return code === "INW006" ? message.replace(UNCHECKED, ".") : message;
}

/**
 * The key a baseline entry and a diagnostic match on. Never the line, so a
 * moved import stays accepted.
 *
 * @param d - a diagnostic or baseline entry.
 * @returns rule, module and stable message joined.
 */
export function baselineKey(d: Pick<Diagnostic, "code" | "module" | "message">): string {
  return `${d.code}\u0000${d.module}\u0000${stableMessage(d)}`;
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
