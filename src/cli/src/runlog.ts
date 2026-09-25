/**
 * The run log, `.inwards/runs.jsonl`: one JSON line per hook or check run, so
 * the business hypothesis (fixed within one retry, violations per 1,000
 * agent-written lines) can be measured from real sessions. Off by default,
 * local only, and never sent anywhere. It is on when `INWARDS_RUN_LOG=1` or
 * the project's root config says `run-log = true`. At 5 MB the file is
 * rotated to `runs.1.jsonl`, replacing the previous one.
 *
 * Line schema `inwards/run@1` (documented in docs/chapters/08-Run-Log.md):
 * `{ v, at, session_id, event, tool, files, lines, fingerprints, exit, durationMs }`.
 */
import { readFileSync, renameSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";
import { type Diagnostic, parseConfig } from "@inwards/core";
import { findConfig } from "./paths.ts";
import { fingerprint } from "./session.ts";
import { projectPath } from "./snapshot.ts";
import { appendLine, stateDir } from "./state-files.ts";

/** Size at which the log is rotated: 5 MiB. */
const MAX_BYTES = 5_242_880;
const LINE_BREAK = /\r\n|\r|\n/u;

/** Lines an edit added and removed in one file, as the tool call says. */
interface LineCount {
  file: string;
  added: number;
  removed: number;
}

/** What a hook handler found, collected for the log line. */
const noted: { files: string[]; fingerprints: string[] } = { files: [], fingerprints: [] };

/**
 * Notes files and violations a handler checked, for this run's log line.
 * The CLI runs one command per process, so a module-level note is enough.
 *
 * @param project - the real project root.
 * @param files - absolute paths of the files checked.
 * @param diagnostics - what the check reported.
 */
export function noteRun(
  project: string,
  files: readonly string[],
  diagnostics: readonly Diagnostic[],
): void {
  noted.files.push(...files.map((file) => projectPath(project, file)));
  noted.fingerprints.push(...diagnostics.map(fingerprint));
}

/**
 * Tells whether the run log is on for a project.
 *
 * @param project - the project root.
 * @returns true with `INWARDS_RUN_LOG=1` (or `true`), or `run-log = true` in the root config.
 */
function runLogEnabled(project: string): boolean {
  const env = process.env["INWARDS_RUN_LOG"];
  if (env === "1" || env === "true") {
    return true;
  }
  const config = findConfig(project, project);
  try {
    return config !== undefined && parseConfig(readFileSync(config, "utf8")).runLog === true;
  } catch {
    return false;
  }
}

/**
 * Appends one run to the log, if it is on. Best effort: logging never changes
 * what the hook or check returns.
 *
 * @param project - the real project root.
 * @param run - the event, tool input, exit code and start time; `force` logs even when the log is off (`check --log`).
 */
export function logRun(
  project: string,
  run: {
    event: string;
    input?: Record<string, unknown>;
    exit: number;
    started: number;
    force?: boolean;
  },
): void {
  if (!(run.force === true || runLogEnabled(project))) {
    return;
  }
  try {
    const path = join(dirname(stateDir(project)), "runs.jsonl");
    rotate(path);
    const { input } = run;
    const line = {
      v: 1,
      at: new Date().toISOString(),
      session_id: typeof input?.["session_id"] === "string" ? input["session_id"] : null,
      event: run.event,
      tool: typeof input?.["tool_name"] === "string" ? input["tool_name"] : null,
      files: [...new Set(noted.files)],
      lines: input === undefined ? [] : lineCounts(project, input),
      fingerprints: noted.fingerprints,
      exit: run.exit,
      durationMs: Math.round((performance.now() - run.started) * 10) / 10,
    };
    appendLine(path, `${JSON.stringify(line)}\n`);
  } catch {
    // best effort, see above
  }
}

/**
 * Moves a full log aside.
 *
 * @param path - the log file.
 */
function rotate(path: string): void {
  const size = statSync(path, { throwIfNoEntry: false })?.size ?? 0;
  if (size >= MAX_BYTES) {
    renameSync(path, join(dirname(path), "runs.1.jsonl"));
  }
}

/**
 * Counts the lines an Edit, Write or MultiEdit added and removed.
 * A Write replaces the whole file, so only its added lines are known.
 *
 * @param project - the real project root.
 * @param input - the hook payload.
 * @returns one count per edited file, or none for other tools.
 */
function lineCounts(project: string, input: Record<string, unknown>): LineCount[] {
  const tool = input["tool_input"];
  if (typeof tool !== "object" || tool === null || !("file_path" in tool)) {
    return [];
  }
  const file = projectPath(project, String(tool.file_path));
  if ("content" in tool) {
    return [{ file, added: lines(tool.content), removed: 0 }];
  }
  const edits = "edits" in tool && Array.isArray(tool.edits) ? tool.edits : [tool];
  let added = 0;
  let removed = 0;
  for (const edit of edits) {
    if (typeof edit === "object" && edit !== null) {
      added += "new_string" in edit ? lines(edit.new_string) : 0;
      removed += "old_string" in edit ? lines(edit.old_string) : 0;
    }
  }
  return [{ file, added, removed }];
}

/**
 * Counts lines in a string the way an editor shows them.
 *
 * @param text - any value from the payload.
 * @returns the line count, 0 for an empty or non-string value.
 */
function lines(text: unknown): number {
  if (typeof text !== "string" || text === "") {
    return 0;
  }
  const parts = text.split(LINE_BREAK);
  return parts.at(-1) === "" ? parts.length - 1 : parts.length;
}
