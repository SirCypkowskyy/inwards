/**
 * Escalation: some violations need a human decision, and blocking forever only
 * teaches the agent to game the check. When the same violation survives
 * `escalate-after` attempts (default 3), the hooks stop blocking and tell the
 * agent to summarise it and ask the user:
 *
 * - PostToolUse: a run whose every error has just reached the limit exits 0
 *   with that instruction as `additionalContext`. A run that also has errors
 *   below the limit still blocks, with the instruction added. Not sticky: the
 *   next run with the violation blocks again.
 * - Stop: the last allowed block (or the first, once a violation has already
 *   escalated) says to ask the user; the Stop after it lets the turn end,
 *   lists the unresolved problems for the user in a `systemMessage`, and
 *   records them per session. The next session's SessionStart hands them to
 *   the model, unless every file involved has changed since.
 */
import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import type { Diagnostic } from "@inwards/core";
import { existingStateDir, stateDir } from "../adapters/state-files.ts";

/** Attempts before escalating, when the config doesn't say. */
export const DEFAULT_ESCALATE_AFTER = 3;
const UNRESOLVED = /\.unresolved\.json$/u;

/**
 * Words the instruction given once the limit is reached.
 *
 * @param attempts - how many attempts the violations survived.
 * @returns the instruction for the model, without the `inwards:` prefix.
 */
export function askUser(attempts: number): string {
  return `These violations survived ${attempts} attempt${attempts === 1 ? "" : "s"}. Stop editing to work around them. Summarise each one for the user (file, rule, what it reports and why) and ask how to proceed; the fix may need a decision you shouldn't make alone.`;
}

/**
 * Lists violations one per line, for people.
 *
 * @param diagnostics - the violations.
 * @returns lines like `- shop/domain/order.py:3 INW001 Layer "domain" imports ...`.
 */
function listViolations(diagnostics: readonly Diagnostic[]): string {
  return diagnostics.map((d) => `- ${d.file}:${d.line} ${d.code} ${d.message}`).join("\n");
}

/**
 * Ends the turn after the last block: tells the user what is unresolved and
 * records it for the next session, with a hash of each file involved.
 *
 * @param project - the real project root; diagnostic paths are relative to it.
 * @param id - the session id, which names the record.
 * @param found - session problems that aren't diagnostics, and the violations still there.
 * @returns 0; the message goes to stdout as the Stop hook's `systemMessage`.
 */
export function yieldTurn(
  project: string,
  id: string,
  found: { problems: readonly string[]; diagnostics: readonly Diagnostic[] },
): number {
  const lines = [...found.problems.map((p) => `- ${p}`), listViolations(found.diagnostics)];
  const summary = `Inwards: the turn ended with unresolved architecture problems:\n${lines.filter(Boolean).join("\n")}`;
  const files = Object.fromEntries(
    found.diagnostics.map((d) => [d.file, hashOf(join(project, d.file))]),
  );
  try {
    const dir = stateDir(project);
    const temp = join(dir, `.${id}.unresolved.${process.pid}.tmp`);
    writeFileSync(temp, JSON.stringify({ at: new Date().toISOString(), summary, files }), {
      flag: "wx",
    });
    renameSync(temp, join(dir, `${id}.unresolved.json`));
  } catch {
    // best effort: the user still sees the summary now
  }
  process.stdout.write(`${JSON.stringify({ systemMessage: summary })}\n`);
  return 0;
}

/**
 * Takes what earlier sessions left unresolved, once. A record whose files
 * have all changed since is dropped: someone has worked on them.
 *
 * @param project - the real project root.
 * @returns the summaries still relevant, or undefined when there are none.
 */
export function takeUnresolved(project: string): string | undefined {
  const dir = existingStateDir(project);
  if (dir === undefined) {
    return undefined;
  }
  const summaries: string[] = [];
  for (const name of readdirSync(dir).filter((n) => UNRESOLVED.test(n))) {
    const path = join(dir, name);
    const record = readRecord(path);
    rmSync(path, { force: true });
    if (record !== undefined && stillRelevant(project, record.files)) {
      summaries.push(record.summary);
    }
  }
  return summaries.length === 0 ? undefined : summaries.join("\n\n");
}

/**
 * Reads one unresolved record, refusing anything but a regular file.
 *
 * @param path - the record's path.
 * @returns the summary and file hashes, or undefined when unreadable.
 */
function readRecord(path: string): { summary: string; files: Record<string, string> } | undefined {
  try {
    if (!lstatSync(path).isFile()) {
      return undefined;
    }
    const value: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (typeof value !== "object" || value === null || !("summary" in value)) {
      return undefined;
    }
    const files =
      "files" in value && typeof value.files === "object" && value.files !== null
        ? value.files
        : {};
    return {
      summary: String(value.summary),
      files: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, String(v)])),
    };
  } catch {
    return undefined;
  }
}

/**
 * Tells whether a record still applies: it names no files, or one of them is unchanged.
 *
 * @param project - the real project root.
 * @param files - project-relative path to content hash, at the time of the record.
 * @returns true when the record should be shown.
 */
function stillRelevant(project: string, files: Record<string, string>): boolean {
  const entries = Object.entries(files);
  return (
    entries.length === 0 || entries.some(([file, hash]) => hashOf(join(project, file)) === hash)
  );
}

/**
 * Hashes a file's content.
 *
 * @param path - a file.
 * @returns its SHA-256, or "" when it can't be read.
 */
function hashOf(path: string): string {
  try {
    return createHash("sha256").update(readFileSync(path)).digest("hex");
  } catch {
    return "";
  }
}
