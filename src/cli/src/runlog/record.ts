/**
 * @file The run log, `.inwards/runs.jsonl`: one JSON line per hook or check run, so
 * the business hypothesis (fixed within one retry, violations per 1,000
 * agent-written lines) can be measured from real sessions. Off by default,
 * local only, and never sent anywhere. It is on when `INWARDS_RUN_LOG=1` or
 * the project's root config says `run-log = true` (`INWARDS_RUN_LOG=0` wins
 * over the config), and only in a project that uses Inwards. At 5 MiB the
 * file is rotated to `runs.1.jsonl`, replacing the previous one.
 *
 * Line schema `inwards/run@1` (documented in docs/chapters/08-Run-Log.md):
 * `{ v, at, session_id, event, tool, files, lines, fingerprints, codes, severities, suppressed, rejected, exit, durationMs }`.
 * `inwards stats` (`runlog/stats.ts`) turns it into the hypothesis numbers.
 *
 * `createRunLog` holds what one invocation's handlers noted; `main.ts` makes
 * one per invocation and writes the line at the end.
 */
import { dirname, join, resolve } from "node:path";
import { CONFIG_DEFAULTS, type Diagnostic, parseConfig, type Report } from "@inwards/core";
import type { Platform } from "../platform/contracts.ts";
import { findConfig } from "../project/config-discovery.ts";
import { projectPath } from "../project/snapshot.ts";
import { fingerprint } from "../session/fingerprint.ts";

/** Size at which the log is rotated: 5 MiB. */
const MAX_BYTES = 5_242_880;
const LINE_BREAK = /\r\n|\r|\n/u;

/** What the run log touches. */
export type RunLogIo = Pick<Platform, "probe" | "read" | "clock" | "runtime" | "state">;

/** Lines an edit added and removed in one file, from the tool call. */
interface LineCount {
  file: string;
  added: number;
  removed: number;
}

/** One invocation's run log: what its handlers noted, and the line it writes. */
export interface RunLog {
  /**
   * Notes files and violations a handler checked, for this run's log line.
   *
   * @param project - the real project root.
   * @param files - absolute paths of the files or directories checked.
   * @param diagnostics - what the check reported.
   */
  noteRun: (project: string, files: readonly string[], diagnostics: readonly Diagnostic[]) => void;
  /**
   * Notes what inline suppressions did in this run, for its log line.
   *
   * @param report - the check, whose `suppressed` findings a comment hid.
   * @param rejected - findings whose suppression the hooks didn't honour (`agent-suppressions`).
   */
  noteSuppressions: (report: Pick<Report, "suppressed">, rejected: readonly Diagnostic[]) => void;
  /**
   * Appends one run to the log, if it is on, and forgets what was noted, so
   * the next line (another config of the same `check`, #57) starts empty.
   * Best effort: nothing in here, not even deciding whether the log is on,
   * can change what the hook or check returns.
   *
   * @param project - the real project root.
   * @param run - the event, the hook payload, the exit code; `force` for `check --log`.
   * @param run.event - the hook event, or `check`.
   * @param run.input - the hook payload, if there is one.
   * @param run.exit - the exit code the run returns.
   * @param run.force - `check --log`: log even when the run log is off.
   * @param run.durationMs - how long this run took; the whole invocation's time by default.
   */
  logRun: (
    project: string,
    run: {
      event: string;
      input?: Record<string, unknown>;
      exit: number;
      force?: boolean;
      durationMs?: number;
    },
  ) => void;
}

/**
 * Creates the run log for one invocation.
 *
 * @param io - reads configs, tells the time and the environment, and writes the log.
 * @returns a run log with nothing noted yet.
 */
export function createRunLog(io: RunLogIo): RunLog {
  const noted: {
    files: string[];
    diagnostics: Diagnostic[];
    suppressed: number;
    rejected: Diagnostic[];
  } = { files: [], diagnostics: [], suppressed: 0, rejected: [] };
  return {
    noteRun(project: string, files: readonly string[], diagnostics: readonly Diagnostic[]): void {
      noted.files.push(...files.map((file) => projectPath(io.probe, project, file) || "."));
      noted.diagnostics.push(...diagnostics);
    },
    noteSuppressions(report: Pick<Report, "suppressed">, rejected: readonly Diagnostic[]): void {
      noted.suppressed += report.suppressed?.length ?? 0;
      noted.rejected.push(...rejected);
    },
    logRun(
      project: string,
      run: {
        event: string;
        input?: Record<string, unknown>;
        exit: number;
        force?: boolean;
        durationMs?: number;
      },
    ): void {
      try {
        if (!runLogEnabled(io, project, run.force === true)) {
          return;
        }
        const path = join(dirname(io.state.stateDir(project)), "runs.jsonl");
        io.state.rotate(path, MAX_BYTES, join(dirname(path), "runs.1.jsonl"));
        const { input } = run;
        const files = [...new Set(noted.files)];
        const line = {
          v: 1,
          at: io.clock.now(),
          session_id: typeof input?.["session_id"] === "string" ? input["session_id"] : null,
          event: run.event,
          tool: typeof input?.["tool_name"] === "string" ? input["tool_name"] : null,
          files,
          lines: run.event === "PostToolUse" && input ? lineCounts(io, project, input, files) : [],
          fingerprints: noted.diagnostics.map(fingerprint),
          codes: noted.diagnostics.map((d) => d.code),
          severities: noted.diagnostics.map((d) => d.severity),
          suppressed: noted.suppressed,
          rejected: noted.rejected.map(fingerprint),
          exit: run.exit,
          durationMs: Math.round((run.durationMs ?? io.clock.elapsed()) * 10) / 10,
        };
        io.state.appendLine(path, `${JSON.stringify(line)}\n`);
      } catch {
        // best effort, see above
      } finally {
        Object.assign(noted, { files: [], diagnostics: [], suppressed: 0, rejected: [] });
      }
    },
  };
}

/**
 * Tells whether the run log is on for a project.
 *
 * @param io - reads the config, the environment and the state directory.
 * @param project - the project root.
 * @param force - `check --log`: on regardless of the switches.
 * @returns true when switched on and the project uses Inwards (a root config or session state).
 * @throws {ConfigError} when the root config is invalid (the caller treats that as off).
 */
function runLogEnabled(io: RunLogIo, project: string, force: boolean): boolean {
  const env = io.runtime.runLog;
  const config = findConfig(io, project, project);
  const usesInwards = config !== undefined || io.state.existingStateDir(project) !== undefined;
  if (!usesInwards || (!force && (env === "0" || env === "false"))) {
    return false;
  }
  if (force || env === "1" || env === "true") {
    return true;
  }
  return (
    config !== undefined && (parseConfig(io.read.text(config)).runLog ?? CONFIG_DEFAULTS.runLog)
  );
}

/**
 * Counts the lines an Edit, Write or MultiEdit changed in the file the hook
 * checked. Lines an edit repeats unchanged around its change (context) don't
 * count. A Write replaces the whole file, so every line counts as added;
 * `replace_all` counts one occurrence.
 *
 * @param io - resolves real paths and knows the process cwd.
 * @param project - the real project root.
 * @param input - the hook payload.
 * @param checked - project-relative files the run checked.
 * @returns one count for the edited file, or none when it wasn't checked.
 */
function lineCounts(
  io: Pick<RunLogIo, "probe" | "runtime">,
  project: string,
  input: Record<string, unknown>,
  checked: readonly string[],
): LineCount[] {
  const tool = input["tool_input"];
  if (typeof tool !== "object" || tool === null || !("file_path" in tool)) {
    return [];
  }
  if (typeof tool.file_path !== "string") {
    return [];
  }
  // Relative to the payload's cwd, as the hook resolves it.
  const cwd = typeof input["cwd"] === "string" ? input["cwd"] : io.runtime.cwd;
  const file = projectPath(io.probe, project, resolve(cwd, tool.file_path));
  if (!checked.includes(file)) {
    return [];
  }
  if ("content" in tool) {
    return [{ file, added: lines(tool.content).length, removed: 0 }];
  }
  const edits = "edits" in tool && Array.isArray(tool.edits) ? tool.edits : [tool];
  const counts = edits.map(editCount);
  return [
    {
      file,
      added: counts.reduce((n, c) => n + c.added, 0),
      removed: counts.reduce((n, c) => n + c.removed, 0),
    },
  ];
}

/**
 * Counts the lines one `old_string` → `new_string` edit changes.
 *
 * @param edit - one edit from an Edit or MultiEdit call.
 * @returns lines added and removed, zero for anything that isn't an edit.
 */
function editCount(edit: unknown): { added: number; removed: number } {
  if (typeof edit !== "object" || edit === null) {
    return { added: 0, removed: 0 };
  }
  const before = lines("old_string" in edit ? edit.old_string : "");
  return diffLines(before, lines("new_string" in edit ? edit.new_string : ""));
}

/**
 * Counts changed lines between two versions of a snippet, leaving out the
 * lines they share at the start and at the end.
 *
 * @param before - the old lines.
 * @param after - the new lines.
 * @returns lines added and removed.
 */
function diffLines(before: string[], after: string[]): { added: number; removed: number } {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) {
    start += 1;
  }
  let end = 0;
  while (
    end < before.length - start &&
    end < after.length - start &&
    before.at(-1 - end) === after.at(-1 - end)
  ) {
    end += 1;
  }
  return { added: after.length - start - end, removed: before.length - start - end };
}

/**
 * Splits text into lines the way an editor shows them.
 *
 * @param text - any value from the payload.
 * @returns the lines, none for an empty or non-string value.
 */
function lines(text: unknown): string[] {
  if (typeof text !== "string" || text === "") {
    return [];
  }
  const parts = text.split(LINE_BREAK);
  return parts.at(-1) === "" ? parts.slice(0, -1) : parts;
}
