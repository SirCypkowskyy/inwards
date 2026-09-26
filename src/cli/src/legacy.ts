/**
 * Violations a file already had when the session started. The PostToolUse
 * hook and the Stop gate hand them to the agent as context instead of
 * blocking on them, so an agent isn't pushed to rewrite code its task didn't
 * need (#134). A violation the agent adds to the same file still blocks.
 *
 * The start content comes from git: the raw blob of the file at the commit
 * the session started on, or that blob with CRLF line endings (what
 * `core.autocrlf` checks out), whichever matches the start manifest's
 * SHA-256. Never `cat-file --filters` or `git show --textconv`: they run
 * filter drivers from .gitattributes and .git/config, which the agent can
 * write, so they would run the agent's commands outside its permissions.
 * For the same reason the read never fetches a missing object (`--no-lazy-fetch`). That costs nothing at
 * SessionStart, and a git call plus one more check only for a file that has
 * errors now. A file that was uncommitted, untracked or outside git at
 * session start has no known start content, so all its errors count as new,
 * as before: when in doubt, the gate blocks.
 *
 * The same start content decides which inline suppressions the hooks honour
 * under `agent-suppressions = "deny"` (#50, ADR-028): a finding suppressed now
 * that wasn't suppressed at session start goes back into the report.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  type Diagnostic,
  type InwardsConfig,
  parseConfig,
  type Report,
  type Suppressed,
  stableMessage,
} from "@inwards/core";
import { runCheck } from "./project.ts";
import { fingerprint } from "./session.ts";
import { git, projectPath } from "./snapshot.ts";

/** What a session started from, as far as file content and configs go. */
interface Start {
  /** The commit at session start, or null outside git. */
  head: string | null;
  /** SHA-256 of every Python file at session start, by project-relative path. */
  manifest: Record<string, string>;
  /** The valid configs at session start, by project-relative path. */
  configs: Record<string, InwardsConfig>;
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
  const errors = diagnostics.filter((d) => d.severity === "error");
  const before = await atStart(project, start, check, errors);
  return carried(errors, before?.diagnostics.filter((d) => d.severity === "error") ?? []);
}

/**
 * Applies `agent-suppressions` to a hook's report. Under `"deny"`, the
 * default, a finding is suppressed only if the file, as it was at session
 * start, had the same finding (rule, module, message) suppressed too, copy
 * for copy. So a suppression the agent added, one it moved to another import
 * or one it widened to another code puts its finding back into the report;
 * editing only an existing suppression's reason changes nothing. Without a
 * start record every suppression counts as new. The mode comes from the
 * config as it was at session start, so a Bash edit of it changes nothing
 * here (and fails the Stop gate).
 *
 * @param project - the real project root.
 * @param start - the session's start record, if there is one.
 * @param check - the config the report came from, its base and baseline setting.
 * @param report - the hook's check.
 * @returns the report with the rejected findings back in `diagnostics`, and those findings.
 */
export async function agentSuppressions(
  project: string,
  start: Start | undefined,
  check: Check,
  report: Report,
): Promise<{ report: Report; rejected: Diagnostic[] }> {
  const suppressed = report.suppressed ?? [];
  if (suppressed.length === 0 || modeOf(project, start, check.configPath) === "allow") {
    return { report, rejected: [] };
  }
  const now = suppressed.map((s) => s.diagnostic);
  const before = start ? await atStart(project, start, check, now) : undefined;
  const kept = carried(now, before?.suppressed?.map((s) => s.diagnostic) ?? []);
  const rejected = now.filter((d) => !kept.includes(d));
  if (rejected.length === 0) {
    return { report, rejected };
  }
  const honoured: Suppressed[] = suppressed.filter((s) => kept.includes(s.diagnostic));
  return {
    report: {
      ...report,
      diagnostics: [...report.diagnostics, ...rejected],
      suppressed: honoured,
    },
    rejected,
  };
}

/**
 * Tells the agent which suppressions weren't honoured, and what to do instead.
 *
 * @param rejected - the findings whose suppression was rejected, from `agentSuppressions`.
 * @returns one line of advice, then one line per finding.
 */
export function rejectedNote(rejected: readonly Diagnostic[]): string {
  const lines = rejected.map((d) => `- ${d.file}:${d.line} ${d.code} ${stableMessage(d.message)}`);
  return [
    "These findings have an inline suppression that wasn't in the file when the session started, and this project doesn't let an agent add one (agent-suppressions). Fix the code instead; if the suppression is really needed, remove it and ask the user to add it:",
    ...lines,
  ].join("\n");
}

/**
 * Reads `agent-suppressions` for a config: from the session start record
 * when there is one, else from the file now.
 *
 * @param project - the real project root.
 * @param start - the session's start record, if there is one.
 * @param configPath - the config's absolute path.
 * @returns the mode; "deny" when the key isn't set.
 */
function modeOf(project: string, start: Start | undefined, configPath: string): string {
  const config = start
    ? start.configs[projectPath(project, configPath)]
    : parseConfig(readFileSync(configPath, "utf8"));
  return config?.agentSuppressions ?? "deny";
}

/**
 * Checks the files some findings are in again, as they were at session start.
 *
 * @param project - the real project root.
 * @param start - the session's start record.
 * @param check - the config the findings came from, their base and baseline setting.
 * @param found - the findings whose files to check.
 * @returns the start check, or undefined when no file has a known start content.
 */
async function atStart(
  project: string,
  start: Start,
  check: Check,
  found: readonly Diagnostic[],
): Promise<Report | undefined> {
  const texts = new Map<string, string>();
  for (const d of found) {
    const file = resolve(check.base, d.file);
    const text = texts.has(file) ? undefined : startText(project, start, file);
    if (text !== undefined) {
      texts.set(file, text);
    }
  }
  if (texts.size === 0) {
    return undefined;
  }
  return await runCheck(check.configPath, [...texts.keys()], check.base, {
    baseline: check.baseline,
    texts,
  });
}

/**
 * Picks the findings the start check had too: a finding is carried over
 * while the start has one with the same fingerprint (rule, module, message)
 * left to match, so a second copy is new.
 *
 * @param now - the findings now.
 * @param before - the start check's findings of the same kind.
 * @returns the findings of `now` that were there at start, the same objects.
 */
function carried(now: readonly Diagnostic[], before: readonly Diagnostic[]): Diagnostic[] {
  const left = new Map<string, number>();
  for (const d of before) {
    left.set(fingerprint(d), (left.get(fingerprint(d)) ?? 0) + 1);
  }
  return now.filter((d) => {
    const n = left.get(fingerprint(d)) ?? 0;
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
  // --no-lazy-fetch: a partial clone the agent set up would otherwise fetch a
  // missing blob through its remote, i.e. run its ext:: URL or sshCommand. Git
  // before 2.44 rejects the flag; the file then has no start content, which is safe.
  const raw = git(project, ["--no-lazy-fetch", "cat-file", "blob", `${start.head}:./${rel}`]);
  const crlf = raw?.replace(/\r?\n/gu, "\r\n");
  return [raw, crlf].find(
    (text) => text !== undefined && createHash("sha256").update(text).digest("hex") === hash,
  );
}
