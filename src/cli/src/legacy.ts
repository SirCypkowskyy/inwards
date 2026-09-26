/**
 * Violations a file already had when the session started. The PostToolUse
 * hook and the Stop gate hand them to the agent as context instead of
 * blocking on them, so an agent isn't pushed to rewrite code its task didn't
 * need (#134). A violation the agent adds to the same file still blocks.
 *
 * The start content comes from git: the file at the commit the session
 * started on, with the working tree's filters (line endings) applied, and
 * only when its SHA-256 matches the start manifest. That costs nothing at
 * SessionStart, and a git call plus one more check only for a file that has
 * errors now. A file that was uncommitted, untracked or outside git at
 * session start has no known start content, so all its errors count as new,
 * as before: when in doubt, the gate blocks.
 */
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { type Diagnostic, stableMessage } from "@inwards/core";
import { runCheck } from "./project.ts";
import { fingerprint } from "./session.ts";
import { git, projectPath } from "./snapshot.ts";

/** What a session started from, as far as file content goes. */
interface Start {
  /** The commit at session start, or null outside git. */
  head: string | null;
  /** SHA-256 of every Python file at session start, by project-relative path. */
  manifest: Record<string, string>;
}

/** How a report was made: its config, the base of its paths, and whether the baseline applied. */
interface Check {
  configPath: string;
  base: string;
  baseline: boolean;
}

/**
 * Picks the errors a check found that the files already had at session
 * start. Each file with an error is checked again as it was then; an error
 * is old while the start check has an error with the same fingerprint (rule,
 * module, message) left to match, so a second copy of an old import is new.
 *
 * @param project - the real project root.
 * @param start - the session's start record.
 * @param check - the config the diagnostics came from, their base and baseline setting.
 * @param diagnostics - what the check of the changed files found.
 * @returns the old errors, the same objects as in `diagnostics`.
 */
export async function oldErrors(
  project: string,
  start: Start,
  check: Check,
  diagnostics: readonly Diagnostic[],
): Promise<Diagnostic[]> {
  const texts = new Map<string, string>();
  for (const d of diagnostics.filter((x) => x.severity === "error")) {
    const file = resolve(check.base, d.file);
    const text = texts.has(file) ? undefined : startText(project, start, file);
    if (text !== undefined) {
      texts.set(file, text);
    }
  }
  if (texts.size === 0) {
    return [];
  }
  const before = await runCheck(check.configPath, [...texts.keys()], check.base, {
    baseline: check.baseline,
    texts,
  });
  const left = new Map<string, number>();
  for (const d of before.diagnostics.filter((x) => x.severity === "error")) {
    left.set(fingerprint(d), (left.get(fingerprint(d)) ?? 0) + 1);
  }
  return diagnostics.filter((d) => {
    const n = d.severity === "error" ? (left.get(fingerprint(d)) ?? 0) : 0;
    if (n > 0) {
      left.set(fingerprint(d), n - 1);
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
  const lines = old.map((d) => `- ${d.file}:${d.line} ${d.code} ${stableMessage(d.message)}`);
  return [
    "These violations were already in the file when the session started, so they don't block. Leave them unless the task needs that code, and mention them to the user:",
    ...lines,
  ].join("\n");
}

/**
 * Reads a file as it was at session start, if git still has exactly that.
 *
 * @param project - the real project root.
 * @param start - the session's start record.
 * @param file - the file, absolute.
 * @returns the start content, or undefined when it can't be proven.
 */
function startText(project: string, start: Start, file: string): string | undefined {
  const rel = projectPath(project, file);
  const hash = start.manifest[rel];
  if (start.head === null || hash === undefined) {
    return undefined;
  }
  // `./` makes the path relative to the project, which may sit below the repo root.
  const text = git(project, ["cat-file", "--filters", `${start.head}:./${rel}`]);
  const same = text !== undefined && createHash("sha256").update(text).digest("hex") === hash;
  return same ? text : undefined;
}
