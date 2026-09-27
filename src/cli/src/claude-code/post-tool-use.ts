/**
 * The PostToolUse hook: after the agent writes a Python file, check that one
 * file, split what it finds into what blocks (new errors) and what is context
 * (warnings, violations the file already had at session start, rejected
 * suppressions, errors that just reached the escalation limit), record the
 * edit in the session, and answer on stderr (blocking, exit 2) or as
 * `additionalContext` (exit 0).
 *
 * Containment is decided on real paths, and start identity follows the path
 * as the agent wrote it (see `session/old-errors.ts`), so symlinks and `..`
 * can't borrow another file's allowances.
 */
import { statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import process from "node:process";
import { ConfigError, type Diagnostic, type Report, render } from "@inwards/core";
import { print } from "../adapters/stdio.ts";
import {
  findConfig,
  isInside,
  PATH_SEPARATORS,
  physicalRealpath,
  realpath,
  shownDiagnostics,
  shownReport,
} from "../paths/lexical.ts";
import { runCheck } from "../project/check.ts";
import { projectPath } from "../project/snapshot.ts";
import { noteRun, noteSuppressions } from "../runlog/record.ts";
import {
  agentSuppressions,
  existedAtStart,
  oldErrors,
  oldNote,
  rejectedNote,
} from "../session/old-errors.ts";
import {
  fingerprint,
  isSessionId,
  readSession,
  readSessionStart,
  recordEdit,
} from "../session/record.ts";
import { askUser, DEFAULT_ESCALATE_AFTER } from "./escalation.ts";

const PYTHON_FILE = /\.pyi?$/u;

/**
 * Checks the one file the agent just wrote and records the edit in the session.
 *
 * @param input - the hook payload.
 * @returns 2 with errors or a config error on stderr, 1 for an internal error, else 0
 *   (warnings only go to stdout as `additionalContext`).
 */
export async function postToolUse(input: Record<string, unknown>): Promise<number> {
  const toolInput = input["tool_input"];
  const file = isRecord(toolInput) ? toolInput["file_path"] : undefined;
  if (typeof file !== "string" || !PYTHON_FILE.exec(file)) {
    return 0;
  }
  const target = hookTarget(input["cwd"], file);
  if (!target) {
    return 0;
  }

  // The nearest config above the file, so each package in a monorepo uses its own,
  // and only one that really lives inside the project. No config at all means this
  // project doesn't use Inwards (the hook may be user-wide).
  const id = input["session_id"];
  const start = isSessionId(id) ? readSessionStart(target.project, id) : undefined;
  const configPath = sessionConfig(dirname(target.file), target.project, start);
  if (!configPath) {
    return 0;
  }
  try {
    // Identity follows the path as written; an agent's suppression may not count (legacy.ts).
    const check = { configPath, base: target.cwd, baseline: true, written: target.written };
    const { report, rejected } = await agentSuppressions(
      target.project,
      start,
      check,
      await runCheck(configPath, [target.file], target.cwd, { required: true }),
    );
    // A shape finding on a file that predates the session, and a missing member, are context.
    const existed = existedAtStart(target.project, start, check, target.file);
    const errors = report.diagnostics.filter(
      (d) => d.severity === "error" && d.code !== "INW008" && !(existed && d.code === "INW007"),
    );
    // So is a violation the file already had at session start (see `legacy.ts`).
    const old =
      start && errors.length > 0 ? await oldErrors(target.project, start, check, errors) : [];
    const blocking = errors.filter((d) => !old.includes(d));
    // Old errors aren't the agent's, so `inwards stats` must not count them as introduced.
    noteRun(
      target.project,
      [target.file],
      report.diagnostics.filter((d) => !old.includes(d)),
    );
    noteSuppressions(report, rejected);
    const escalation = escalationOf(target.project, id, configPath, blocking);
    // Only what blocks counts toward escalation: context isn't an attempt that failed.
    rememberEdit(target.project, id, target.file, blocking);
    return report.diagnostics.length === 0
      ? 0
      : reply(report, { old, blocking, rejected }, escalation, target);
  } catch (err) {
    if (err instanceof ConfigError) {
      return print(`inwards: config error: ${err.message}`, 2);
    }
    return print(`inwards hook: ${err instanceof Error ? err.message : String(err)}`, 1);
  }
}

/**
 * Answers the agent after a check that found something: blocking errors go
 * to stderr with exit 2; warnings and context, or errors that have just
 * escalated, go back as `additionalContext`. Old errors leave the JSON and
 * are listed as a note instead. Findings whose suppression was rejected stay
 * in the JSON and get a note of their own.
 *
 * @param report - the check of the edited file.
 * @param split - the errors the file already had at session start, the ones
 *   that block, and the findings whose suppression was rejected.
 * @param escalation - the escalation limit, if this run reached it, from `escalationOf`.
 * @param where - the real project root and the report's base, to show paths from the project.
 * @returns 2 to block, 0 when everything is context.
 */
function reply(
  report: Report,
  {
    old,
    blocking,
    rejected,
  }: { old: Diagnostic[]; blocking: Diagnostic[]; rejected: Diagnostic[] },
  escalation: { limit: number; every: boolean } | undefined,
  { project, cwd }: { project: string; cwd: string },
): number {
  const left = { ...report, diagnostics: report.diagnostics.filter((d) => !old.includes(d)) };
  const shown = shownReport(project, cwd, left);
  const json = shown.diagnostics.length > 0 ? render(shown, "json", { pretty: false }) : "";
  const ask = escalation === undefined ? "" : `inwards: ${askUser(escalation.limit)}\n`;
  const note = [
    ...(rejected.length > 0
      ? [`inwards: ${rejectedNote(shownDiagnostics(project, cwd, rejected))}\n`]
      : []),
    ...(old.length > 0 ? [`inwards: ${oldNote(shownDiagnostics(project, cwd, old))}\n`] : []),
  ].join("");
  if (blocking.length > 0 && escalation?.every !== true) {
    process.stderr.write(`${ask}${note}${json}\n`); // a new violation still blocks
    return 2;
  }
  // Warnings or context only, or every error has just reached the limit: the report is context.
  const additionalContext = `${ask}${note}${json}`.trimEnd();
  const hookSpecificOutput = { hookEventName: "PostToolUse", additionalContext };
  process.stdout.write(`${JSON.stringify({ hookSpecificOutput })}\n`);
  return 0;
}

/**
 * Works out whether this run escalates: some error in it has now been reported
 * exactly `escalate-after` times this session (counted once per edit). The
 * limit comes from the config as it was at session start, so editing it
 * mid-session changes nothing. Only that run escalates; the next one with the
 * same violation blocks again.
 *
 * @param project - the real project root.
 * @param id - the payload's `session_id`.
 * @param configPath - the config the file was checked with.
 * @param diagnostics - this run's blocking errors.
 * @returns the limit, and whether every error in the run reached it; undefined when none did.
 */
function escalationOf(
  project: string,
  id: unknown,
  configPath: string,
  diagnostics: readonly Diagnostic[],
): { limit: number; every: boolean } | undefined {
  const state = isSessionId(id) ? readSession(project, id) : undefined;
  if (state === undefined) {
    return undefined;
  }
  const config = state.start.configs[projectPath(project, configPath)];
  const limit = config?.escalateAfter ?? DEFAULT_ESCALATE_AFTER;
  const errors = new Set(diagnostics.filter((d) => d.severity === "error").map(fingerprint));
  const reached = [...errors].filter((fp) => (state.seen.get(fp) ?? 0) + 1 === limit);
  return reached.length === 0 ? undefined : { limit, every: reached.length === errors.size };
}

/**
 * Finds the config for an edited file. Once a session has a start record,
 * only configs recorded there count: a pyproject.toml with a permissive
 * `[tool.inwards]` created mid-session (through Bash, past the guard) is
 * passed over for the next one up. The Stop gate reports it.
 *
 * @param dir - the edited file's directory.
 * @param project - the real project root.
 * @param start - the session's start record, if it has one.
 * @returns the config path, or undefined without one.
 */
function sessionConfig(
  dir: string,
  project: string,
  start: { configs: Record<string, unknown> } | undefined,
): string | undefined {
  const known = start?.configs;
  if (known === undefined) {
    return findConfig(dir, project);
  }
  return findConfig(dir, project, (real) => known[projectPath(project, real)] !== undefined);
}

/**
 * Appends an edit to the session log, if the payload names a session.
 * Best effort: a read-only disk must not turn a clean edit into an error. A
 * session whose log is incomplete is caught later, since the Stop gate fails
 * closed without a start record.
 *
 * @param project - the real project root.
 * @param id - the payload's `session_id`.
 * @param file - the edited file.
 * @param diagnostics - the errors the check blocked on (context-only findings are left out).
 */
function rememberEdit(
  project: string,
  id: unknown,
  file: string,
  diagnostics: readonly Diagnostic[],
): void {
  if (!isSessionId(id)) {
    return;
  }
  try {
    recordEdit(project, id, file, diagnostics);
  } catch {
    // best effort, see above
  }
}

/**
 * Resolves the file named in a hook payload and checks it may be linted.
 * The payload is agent-controlled, so containment is decided on real paths:
 * `..` and symlinks cannot reach outside the project. The boundary is
 * CLAUDE_PROJECT_DIR, else the process cwd (Claude Code runs hooks in the
 * project), never the payload's own `cwd`.
 *
 * @param payloadCwd - the payload's `cwd` field; the process cwd if not a string.
 * @param file - the payload's `tool_input.file_path`, absolute or relative to cwd.
 * @returns the file and cwd as written (Python names modules after that
 *   path), the real project root, and the file's path exactly as written
 *   (`..` applied as text) for start identity (`Check.written` in legacy.ts);
 *   undefined when the file is outside the project, missing, or not a regular file.
 */
function hookTarget(
  payloadCwd: unknown,
  file: string,
): { file: string; cwd: string; project: string; written: Map<string, string> } | undefined {
  const lexicalCwd = typeof payloadCwd === "string" ? payloadCwd : process.cwd();
  const cwd = realpath(lexicalCwd);
  const project = realpath(process.env["CLAUDE_PROJECT_DIR"] || process.cwd());
  if (!(cwd && project)) {
    return undefined;
  }
  const real = physicalRealpath(lexicalCwd, file);
  // With `..` in the path, the directory as written is not where the file is:
  // resolve it as the OS does, but keep the file's own name, so a symlinked
  // file (`cart.py -> cart.pyi`) is still checked as itself.
  const dir = PATH_SEPARATORS[Symbol.split](file).includes("..")
    ? physicalRealpath(lexicalCwd, dirname(file))
    : undefined;
  const lexical = dir === undefined ? resolve(lexicalCwd, file) : join(dir, basename(file));
  if (real && lexical && isInside(project, real) && statSync(real).isFile()) {
    // Report paths against the cwd as written: on macOS /var is a link to
    // /private/var, and mixing the two spellings gives ../../var/... paths.
    const written = new Map([[lexical, resolve(lexicalCwd, file)]]);
    return { file: lexical, cwd: resolve(lexicalCwd), project, written };
  }
  return undefined;
}

/**
 * Tells whether a parsed JSON value is an object whose fields can be read.
 *
 * @param value - any parsed JSON value.
 * @returns true when the value is a non-null object (arrays included).
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
