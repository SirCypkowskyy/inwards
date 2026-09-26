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
 * Start content is looked up by the path the file was checked under, never
 * where a symlink points, so an alias the agent creates has none. Each
 * lookup, failed ones included, happens once per process.
 *
 * The same start content decides which inline suppressions the hooks honour
 * under `agent-suppressions = "deny"` (#50, ADR-028): a finding suppressed now
 * that wasn't suppressed at session start goes back into the report.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, normalize, relative, resolve } from "node:path";
import {
  type AgentSuppressions,
  type Diagnostic,
  type InwardsConfig,
  parseConfig,
  type Report,
  stableMessage,
} from "@inwards/core";
import { posix, realpath } from "./paths.ts";
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
 * default, a suppression is honoured when its file is byte for byte what it
 * was at session start (the start manifest's hash), since the agent didn't
 * change it, or when the file as it was at session start had the same
 * finding (rule, module, message) suppressed too, copy for copy. So a
 * suppression the agent added, one it moved to another import or one it
 * widened to another code isn't honoured; editing only an existing
 * suppression's reason changes nothing. Without a start record every
 * suppression counts as new. The mode comes from the config as it was at
 * session start, so a Bash edit of it changes nothing here (and fails the
 * Stop gate).
 *
 * A finding whose suppression isn't honoured is treated as if the comment
 * weren't there: back in `diagnostics`, unless a baseline entry accepts it
 * (`applyBaseline` marks it `baselined`), and the #134 old-error check the
 * caller runs next applies to it like to any other.
 *
 * @param project - the real project root.
 * @param start - the session's start record, if there is one.
 * @param check - the config the report came from, its base and baseline setting.
 * @param report - the hook's check.
 * @returns the report as if the rejected comments weren't there, and the
 *   rejected findings the baseline doesn't accept.
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
  const same = start
    ? unchangedFiles(
        start,
        now.map((d) => [checkedPath(project, check.base, d.file), resolve(check.base, d.file)]),
      )
    : new Set<string>();
  const touched = now.filter((d) => !same.has(checkedPath(project, check.base, d.file)));
  const before =
    start && touched.length > 0 ? await atStart(project, start, check, touched) : undefined;
  const kept = carried(touched, before?.suppressed?.map((s) => s.diagnostic) ?? []);
  const lost = suppressed.filter(
    (s) => touched.includes(s.diagnostic) && !kept.includes(s.diagnostic),
  );
  if (lost.length === 0) {
    return { report, rejected: [] };
  }
  const rejected = lost.filter((s) => s.baselined !== true).map((s) => s.diagnostic);
  return {
    report: {
      ...report,
      diagnostics: [...report.diagnostics, ...rejected],
      suppressed: suppressed.filter((s) => !lost.includes(s)),
      baselined: (report.baselined ?? 0) + lost.length - rejected.length,
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
    "These findings have an inline suppression that wasn't in the file when the session started, or the file wasn't committed at session start, and this project doesn't let an agent add one (agent-suppressions). If you added it, fix the code instead, or remove the suppression and ask the user to add it; if it was already there, leave it and tell the user:",
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
function modeOf(project: string, start: Start | undefined, configPath: string): AgentSuppressions {
  const config = start
    ? start.configs[projectPath(project, configPath)]
    : parseConfig(readFileSync(configPath, "utf8"));
  return config?.agentSuppressions ?? "deny";
}

/**
 * Finds the files that are byte for byte what they were at session start,
 * from the start manifest's SHA-256. The same bytes mean the same
 * suppressions, committed or not, so the agent didn't add any. A file is
 * looked up by its path as checked, not where a symlink points: a new alias
 * (`ln -s order.pyi order.py`) isn't in the manifest, so it gets no
 * allowance. Each file is read and hashed once, however many findings it has.
 *
 * @param start - the session's start manifest.
 * @param files - each finding's file: its project path as checked (`checkedPath`)
 *   and its absolute path; repeats allowed.
 * @param read - reads a file's bytes; the tests count the calls.
 * @returns the project paths whose hash now is their start hash.
 */
export function unchangedFiles(
  start: Pick<Start, "manifest">,
  files: readonly (readonly [rel: string, abs: string])[],
  read: (file: string) => Uint8Array = readFileSync,
): Set<string> {
  const byPath = new Map(files);
  return new Set(
    [...byPath].flatMap(([rel, abs]) => {
      const hash = start.manifest[rel];
      try {
        const same =
          hash !== undefined && createHash("sha256").update(read(abs)).digest("hex") === hash;
        return same ? [rel] : [];
      } catch {
        return []; // gone or unreadable: not provably unchanged
      }
    }),
  );
}

/**
 * Names a finding's file the way the start manifest does: project-relative,
 * with symlinks in the report path left alone. Only the base the report
 * paths are relative to is resolved, so a cwd spelled through a link
 * (`/var` for `/private/var`) still lands inside the project.
 *
 * @param project - the real project root.
 * @param base - the directory the report paths are relative to.
 * @param file - a report path.
 * @returns the project-relative path with forward slashes.
 */
function checkedPath(project: string, base: string, file: string): string {
  return posix(normalize(join(relative(project, realpath(base) ?? base), file)));
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
    const text = startText(project, start, checkedPath(project, check.base, d.file));
    if (text !== undefined) {
      texts.set(resolve(check.base, d.file), text);
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
 * while the same file had one with the same fingerprint (rule, module,
 * message) left to match at start, so a second copy is new. The file counts
 * because `order.py` and `order.pyi` share a module: without it, a
 * suppression moved from one into the other would still match.
 *
 * @param now - the findings now.
 * @param before - the start check's findings of the same kind.
 * @returns the findings of `now` that were there at start, the same objects.
 */
function carried(now: readonly Diagnostic[], before: readonly Diagnostic[]): Diagnostic[] {
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
  const lines = old.map((d) => `- ${d.file}:${d.line} ${d.code} ${stableMessage(d.message)}`);
  return [
    "These violations were already in the file when the session started, so they don't block. Leave them unless the task needs that code, and mention them to the user:",
    ...lines,
  ].join("\n");
}

/**
 * Start contents already looked up in this process, by commit, project path
 * and start hash; null for a lookup that failed (a file dirty or untracked at
 * start). The key names the exact content, so an entry can't go stale, and
 * `agentSuppressions` and `oldErrors` share it.
 */
const startTexts = new Map<string, string | null>();

/**
 * Reads a file as it was at session start, if git still has exactly that.
 * The file is looked up by its path as checked (`checkedPath`), never where a
 * symlink points, so a new alias has no start content. Each path is read
 * from git at most once per process, whether or not that works.
 *
 * @param project - the real project root.
 * @param start - the session's start record.
 * @param rel - the file's project path as checked.
 * @param blob - reads `<commit>:./<path>` from git; the tests count the calls.
 * @returns the start content, or undefined when it can't be proven.
 */
export function startText(
  project: string,
  start: Pick<Start, "head" | "manifest">,
  rel: string,
  blob: (project: string, spec: string) => string | undefined = gitBlob,
): string | undefined {
  const hash = start.manifest[rel];
  if (start.head === null || hash === undefined) {
    return undefined;
  }
  const key = `${start.head}\u0000${rel}\u0000${hash}`;
  if (!startTexts.has(key)) {
    const raw = blob(project, `${start.head}:./${rel}`);
    const crlf = raw?.replace(/\r?\n/gu, "\r\n");
    const text = [raw, crlf].find(
      (t) => t !== undefined && createHash("sha256").update(t).digest("hex") === hash,
    );
    startTexts.set(key, text ?? null);
  }
  return startTexts.get(key) ?? undefined;
}

/**
 * Reads one blob from git without running anything the agent could have set up.
 * `./` makes the path relative to the project, which may sit below the repo
 * root. --no-lazy-fetch: a partial clone the agent set up would otherwise
 * fetch a missing blob through its remote, i.e. run its ext:: URL or
 * sshCommand. Git before 2.44 rejects the flag; the file then has no start
 * content, which is safe. Never `--filters` or `--textconv` (see the module comment).
 *
 * @param project - the real project root.
 * @param spec - `<commit>:./<path>`.
 * @returns the blob's raw content, or undefined when git can't give it.
 */
function gitBlob(project: string, spec: string): string | undefined {
  return git(project, ["--no-lazy-fetch", "cat-file", "blob", spec]);
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
