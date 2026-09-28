/**
 * @file The PostToolUse hook: after the agent writes a Python file, check that one
 * file, split what it finds into what blocks (new errors) and what is context
 * (warnings, violations the file already had at session start, rejected
 * suppressions, errors that just reached the escalation limit), record the
 * edit in the session, and answer on stderr (blocking, exit 2) or as
 * `additionalContext` (exit 0).
 *
 * Containment is decided on real paths, and start identity follows the path
 * as the agent wrote it (see `session/start-identity.ts`), so symlinks and `..`
 * can't borrow another file's allowances.
 */
import { basename, dirname, join, resolve } from "node:path";
import { ConfigError, type Diagnostic, type Report, render } from "@inwards/core";
import { shownDiagnostics, shownReport } from "../paths/display.ts";
import { isInside, PATH_SEPARATORS } from "../paths/lexical.ts";
import { physicalRealpath } from "../paths/physical.ts";
import type { Platform } from "../platform/contracts.ts";
import { print } from "../platform/print.ts";
import { findConfig } from "../project/config-discovery.ts";
import { projectPath } from "../project/snapshot.ts";
import { agentSuppressions, rejectedNote } from "../session/agent-suppressions.ts";
import type { Start } from "../session/contracts.ts";
import { fingerprint } from "../session/fingerprint.ts";
import { createStartLookups } from "../session/lookups.ts";
import { oldErrors, oldNote } from "../session/old-errors.ts";
import { isSessionId, readSession, readSessionStart, recordEdit } from "../session/record.ts";
import { askUser, DEFAULT_ESCALATE_AFTER } from "./escalation.ts";
import { type HookDeps, hookProject } from "./protocol.ts";

const PYTHON_FILE = /\.pyi?$/u;

/**
 * Checks the one file the agent just wrote and records the edit in the session.
 *
 * @param deps - the platform, this invocation's run log and the check runner.
 * @param input - the hook payload.
 * @returns 2 with errors or a config error on stderr, 1 for an internal error, else 0
 *   (warnings only go to stdout as `additionalContext`).
 */
export async function postToolUse(deps: HookDeps, input: Record<string, unknown>): Promise<number> {
  const { io } = deps;
  const toolInput = input["tool_input"];
  const file = isRecord(toolInput) ? toolInput["file_path"] : undefined;
  if (typeof file !== "string" || !PYTHON_FILE.exec(file)) {
    return 0;
  }
  const target = hookTarget(io, input["cwd"], file);
  if (!target) {
    return 0;
  }

  // The nearest config above the file, so each package in a monorepo uses its own,
  // and only one that really lives inside the project. No config at all means this
  // project doesn't use Inwards (the hook may be user-wide).
  const id = input["session_id"];
  const start = isSessionId(id) ? readSessionStart(io, target.project, id) : undefined;
  const configPath = sessionConfig(io, dirname(target.file), target.project, start);
  if (!configPath) {
    return 0;
  }
  try {
    const { report, rejected, old, blocking } = await checkEdit(
      deps,
      { ...target, id: isSessionId(id) ? id : undefined },
      start,
      configPath,
    );
    // Old errors aren't the agent's, so `inwards stats` must not count them as introduced.
    deps.runlog.noteRun(
      target.project,
      [target.file],
      report.diagnostics.filter((d) => !old.includes(d)),
    );
    deps.runlog.noteSuppressions(report, rejected);
    const session = { project: target.project, id };
    const escalation = escalationOf(io, session, configPath, blocking);
    // Only what blocks counts toward escalation: context isn't an attempt that failed.
    rememberEdit(io, session, target.file, blocking);
    return report.diagnostics.length === 0
      ? 0
      : reply(io, report, { old, blocking, rejected, escalation }, target);
  } catch (err) {
    if (err instanceof ConfigError) {
      return print(io.streams, `inwards: config error: ${err.message}`, 2);
    }
    return print(
      io.streams,
      `inwards hook: ${err instanceof Error ? err.message : String(err)}`,
      1,
    );
  }
}

/**
 * Checks the edited file and sorts what it found. A suppression the agent
 * added doesn't count (`session/agent-suppressions.ts`); a shape finding on
 * a file that predates the session, a missing member, and a violation the
 * file already had at session start are context, not blocking. Identity
 * follows the path as the agent wrote it, with one set of start lookups for
 * this invocation.
 *
 * @param deps - the platform and the check runner.
 * @param target - the file, the report base, the project and the path as written.
 * @param target.file - the edited file, absolute, as the agent named it.
 * @param target.cwd - the payload's cwd, which report paths are relative to.
 * @param target.project - the real project root.
 * @param target.written - each checked file's path exactly as the agent wrote it.
 * @param target.id - the session id, which names SessionStart's copies; undefined when invalid.
 * @param start - the session's start record, if it has one.
 * @param configPath - the config to check the file with.
 * @returns the report as if rejected suppressions weren't there, the rejected
 *   findings, the old errors, and the errors that block.
 * @throws {ConfigError} when the config or the baseline is invalid.
 */
async function checkEdit(
  deps: Pick<HookDeps, "io" | "check">,
  target: {
    file: string;
    cwd: string;
    project: string;
    written: Map<string, string>;
    id: string | undefined;
  },
  start: Start | undefined,
  configPath: string,
): Promise<{ report: Report; rejected: Diagnostic[]; old: Diagnostic[]; blocking: Diagnostic[] }> {
  const lookups = createStartLookups({ ...deps.io, check: deps.check }, target);
  const check = { configPath, base: target.cwd, baseline: true, written: target.written };
  const { report, rejected } = await agentSuppressions(
    lookups,
    start,
    check,
    await deps.check(configPath, [target.file], target.cwd, { required: true, edit: true }),
  );
  const existed = lookups.identity.existedAtStart(target.project, start, check, target.file);
  const errors = report.diagnostics.filter(
    (d) => d.severity === "error" && d.code !== "INW008" && !(existed && d.code === "INW007"),
  );
  const old = start && errors.length > 0 ? await oldErrors(lookups, start, check, errors) : [];
  return { report, rejected, old, blocking: errors.filter((d) => !old.includes(d)) };
}

/**
 * Answers the agent after a check that found something: blocking errors go
 * to stderr with exit 2; warnings and context, or errors that have just
 * escalated, go back as `additionalContext`. Old errors leave the JSON and
 * are listed as a note instead. Findings whose suppression was rejected stay
 * in the JSON and get a note of their own.
 *
 * @param io - resolves paths for display and writes the answer.
 * @param report - the check of the edited file.
 * @param split - the errors the file already had at session start, the ones
 *   that block, the findings whose suppression was rejected, and the escalation
 *   limit if this run reached it (`escalationOf`).
 * @param split.old - errors the file already had at session start.
 * @param split.blocking - new errors, which block.
 * @param split.rejected - findings whose inline suppression wasn't honoured.
 * @param split.escalation - the limit and whether every error reached it, if this run escalates.
 * @param where - the real project root and the report's base, to show paths from the project.
 * @param where.project - the real project root.
 * @param where.cwd - the directory the report's paths are relative to.
 * @returns 2 to block, 0 when everything is context.
 */
function reply(
  io: Pick<Platform, "probe" | "streams">,
  report: Report,
  {
    old,
    blocking,
    rejected,
    escalation,
  }: {
    old: Diagnostic[];
    blocking: Diagnostic[];
    rejected: Diagnostic[];
    escalation: { limit: number; every: boolean } | undefined;
  },
  { project, cwd }: { project: string; cwd: string },
): number {
  const left = { ...report, diagnostics: report.diagnostics.filter((d) => !old.includes(d)) };
  const shown = shownReport(io.probe, project, cwd, left);
  const json = shown.diagnostics.length > 0 ? render(shown, "json", { pretty: false }) : "";
  const ask = escalation === undefined ? "" : `inwards: ${askUser(escalation.limit)}\n`;
  const note = [
    ...(rejected.length > 0
      ? [`inwards: ${rejectedNote(shownDiagnostics(io.probe, project, cwd, rejected))}\n`]
      : []),
    ...(old.length > 0
      ? [`inwards: ${oldNote(shownDiagnostics(io.probe, project, cwd, old))}\n`]
      : []),
  ].join("");
  if (blocking.length > 0 && escalation?.every !== true) {
    io.streams.err(`${ask}${note}${json}\n`); // a new violation still blocks
    return 2;
  }
  // Warnings or context only, or every error has just reached the limit: the report is context.
  const additionalContext = `${ask}${note}${json}`.trimEnd();
  const hookSpecificOutput = { hookEventName: "PostToolUse", additionalContext };
  io.streams.out(`${JSON.stringify({ hookSpecificOutput })}\n`);
  return 0;
}

/**
 * Works out whether this run escalates: some error in it has now been reported
 * exactly `escalate-after` times this session (counted once per edit). The
 * limit comes from the config as it was at session start, so editing it
 * mid-session changes nothing. Only that run escalates; the next one with the
 * same violation blocks again.
 *
 * @param io - reads the session and resolves the config's path.
 * @param session - the real project root and the payload's `session_id`.
 * @param session.project - the real project root.
 * @param session.id - the payload's `session_id`.
 * @param configPath - the config the file was checked with.
 * @param diagnostics - this run's blocking errors.
 * @returns the limit, and whether every error in the run reached it; undefined when none did.
 */
export function escalationOf(
  io: Pick<Platform, "probe" | "read" | "state">,
  { project, id }: { project: string; id: unknown },
  configPath: string,
  diagnostics: readonly Diagnostic[],
): { limit: number; every: boolean } | undefined {
  const state = isSessionId(id) ? readSession(io, project, id) : undefined;
  if (state === undefined) {
    return undefined;
  }
  const config = state.start.configs[projectPath(io.probe, project, configPath)];
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
 * @param io - resolves real paths and reads configs.
 * @param dir - the edited file's directory.
 * @param project - the real project root.
 * @param start - the session's start record, if it has one.
 * @returns the config path, or undefined without one.
 */
export function sessionConfig(
  io: Pick<Platform, "probe" | "read">,
  dir: string,
  project: string,
  start: { configs: Record<string, unknown> } | undefined,
): string | undefined {
  const known = start?.configs;
  if (known === undefined) {
    return findConfig(io, dir, project);
  }
  return findConfig(
    io,
    dir,
    project,
    (real) => known[projectPath(io.probe, project, real)] !== undefined,
  );
}

/**
 * Appends an edit to the session log, if the payload names a session.
 * Best effort: a read-only disk must not turn a clean edit into an error. A
 * session whose log is incomplete is caught later, since the Stop gate fails
 * closed without a start record.
 *
 * @param io - resolves the file's path, tells the time and writes the log.
 * @param session - the real project root and the payload's `session_id`.
 * @param session.project - the real project root.
 * @param session.id - the payload's `session_id`.
 * @param file - the edited file.
 * @param diagnostics - the errors the check blocked on (context-only findings are left out).
 */
export function rememberEdit(
  io: Pick<Platform, "probe" | "clock" | "state">,
  { project, id }: { project: string; id: unknown },
  file: string,
  diagnostics: readonly Diagnostic[],
): void {
  if (!isSessionId(id)) {
    return;
  }
  try {
    recordEdit(io, { project, id }, file, diagnostics);
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
 * @param io - resolves real paths, tells files apart and knows the environment.
 * @param payloadCwd - the payload's `cwd` field; the process cwd if not a string.
 * @param file - the payload's `tool_input.file_path`, absolute or relative to cwd.
 * @returns the file and cwd as written (Python names modules after that
 *   path), the real project root, and the file's path exactly as written
 *   (`..` applied as text) for start identity (`Check.written`, `session/contracts.ts`);
 *   undefined when the file is outside the project, missing, or not a regular file.
 */
function hookTarget(
  io: Pick<Platform, "probe" | "runtime">,
  payloadCwd: unknown,
  file: string,
): { file: string; cwd: string; project: string; written: Map<string, string> } | undefined {
  const lexicalCwd = typeof payloadCwd === "string" ? payloadCwd : io.runtime.cwd;
  const cwd = io.probe.realpath(lexicalCwd);
  const project = hookProject(io);
  if (!(cwd && project)) {
    return undefined;
  }
  const real = physicalRealpath(io.probe, lexicalCwd, file);
  // With `..` in the path, the directory as written is not where the file is:
  // resolve it as the OS does, but keep the file's own name, so a symlinked
  // file (`cart.py -> cart.pyi`) is still checked as itself.
  const dir = PATH_SEPARATORS[Symbol.split](file).includes("..")
    ? physicalRealpath(io.probe, lexicalCwd, dirname(file))
    : undefined;
  const lexical = dir === undefined ? resolve(lexicalCwd, file) : join(dir, basename(file));
  if (real && lexical && isInside(project, real) && io.probe.kind(real) === "file") {
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
