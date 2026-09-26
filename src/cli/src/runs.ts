/**
 * Reading the run logs (`inwards/run@1`, docs/chapters/08-Run-Log.md) for
 * `inwards stats`: every `.inwards/runs.1.jsonl` and `.inwards/runs.jsonl`
 * in the project, since the hooks log at the project root and `check` next
 * to its config.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const LINE_BREAK = /\r?\n/u;

/** The fields of an `inwards/run@1` line that stats reads. */
export interface RunLine {
  at: string;
  session_id: string | null;
  event: string;
  files: string[];
  lines: { file: string; added: number; removed: number }[];
  fingerprints: string[];
  /** The rule code of each fingerprint, in the same order; absent in older lines. */
  codes?: string[];
  /** `error` or `warning` for each fingerprint; absent in older lines, read as errors. */
  severities?: string[];
  durationMs: number;
}

/**
 * Reads the run logs of a project and its packages, merged in time order.
 * Each directory's rotated file comes first, so its lines stay in order.
 *
 * @param dirs - directories that may hold `.inwards/` (the project root and each config's).
 * @returns the readable lines, and how many weren't.
 */
export function readRunLogs(dirs: readonly string[]): { lines: RunLine[]; skipped: number } {
  const lines: RunLine[] = [];
  let skipped = 0;
  for (const dir of new Set(dirs)) {
    for (const name of ["runs.1.jsonl", "runs.jsonl"]) {
      for (const raw of readLines(join(dir, ".inwards", name))) {
        const line = parseLine(raw);
        if (line === undefined) {
          skipped += 1;
        } else {
          lines.push(line);
        }
      }
    }
  }
  // Stable sort: lines with the same time keep their file order.
  lines.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return { lines, skipped };
}
/**
 * Reads a log file's non-empty lines.
 *
 * @param path - the log file.
 * @returns its lines, or none when it doesn't exist.
 */
function readLines(path: string): string[] {
  try {
    return readFileSync(path, "utf8")
      .split(LINE_BREAK)
      .filter((raw) => raw.trim() !== "");
  } catch {
    return []; // no such file: nothing logged there
  }
}

/**
 * The directories whose `.inwards/` may hold a log: the project root, where
 * the hooks write, and the directory of each config, where `check` writes.
 *
 * @param project - the project root.
 * @param configs - project-relative pyproject.toml paths.
 * @returns absolute directories.
 */
export function logDirs(project: string, configs: readonly string[]): string[] {
  return [project, ...configs.map((rel) => join(project, dirname(rel)))];
}
/**
 * Collects each session's Stop runs, with what each reported.
 *
 * @param lines - the log, in time order.
 * @returns the Stop runs by session, in time order.
 */
export function stopRuns(
  lines: readonly RunLine[],
): Map<string, { at: number; prints: string[] }[]> {
  const bySession = new Map<string, { at: number; prints: string[] }[]>();
  for (const line of lines) {
    if (line.event === "Stop" && line.session_id !== null) {
      const runs = bySession.get(line.session_id) ?? [];
      runs.push({ at: Date.parse(line.at), prints: line.fingerprints });
      bySession.set(line.session_id, runs);
    }
  }
  return bySession;
}
/**
 * The distinct error fingerprints of one run.
 *
 * @param run - a log line.
 * @returns fingerprints whose severity is error, or unknown (older lines).
 */
export function errorsOf(run: RunLine): string[] {
  return [
    ...new Set(run.fingerprints.filter((_, i) => (run.severities?.[i] ?? "error") === "error")),
  ];
}
/**
 * Maps each fingerprint to its rule code, from lines that carry `codes`.
 *
 * @param lines - the log.
 * @returns fingerprint to rule code.
 */
export function ruleCodes(lines: readonly RunLine[]): Map<string, string> {
  const codeOf = new Map<string, string>();
  for (const line of lines) {
    line.fingerprints.forEach((print, i) => {
      const code = line.codes?.[i];
      if (code !== undefined) {
        codeOf.set(print, code);
      }
    });
  }
  return codeOf;
}
/**
 * Collects, for each session, what `check` runs reported before the
 * session's first edit, so violations that were already there don't count.
 * One sweep over the checks and the sessions, both in time order.
 *
 * @param lines - the log, in time order.
 * @param hooks - the hook runs, in time order.
 * @returns fingerprints by session.
 */
export function preexisting(
  lines: readonly RunLine[],
  hooks: readonly RunLine[],
): Map<string, Set<string>> {
  const firstEdit = new Map<string, number>();
  for (const run of hooks) {
    const session = run.session_id ?? "";
    if (!firstEdit.has(session)) {
      firstEdit.set(session, Date.parse(run.at));
    }
  }
  const checks = lines.filter((l) => l.event === "check");
  const seen = new Set<string>();
  const old = new Map<string, Set<string>>();
  let next = 0;
  for (const [session, at] of firstEdit) {
    for (; next < checks.length && Date.parse(checks[next]?.at ?? "") < at; next += 1) {
      for (const print of checks[next]?.fingerprints ?? []) {
        seen.add(print);
      }
    }
    old.set(session, new Set(seen));
  }
  return old;
}
/**
 * Parses one log line.
 *
 * @param raw - the line's text.
 * @returns the line, or undefined when it isn't an `inwards/run@1` object.
 */
export function parseLine(raw: string): RunLine | undefined {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (
    !isRecord(value) ||
    value["v"] !== 1 ||
    typeof value["at"] !== "string" ||
    Number.isNaN(Date.parse(value["at"])) ||
    typeof value["event"] !== "string" ||
    !isStrings(value["files"]) ||
    !isStrings(value["fingerprints"]) ||
    !Array.isArray(value["lines"]) ||
    !isDuration(value["durationMs"])
  ) {
    return undefined;
  }
  const session = value["session_id"];
  const prints = value["fingerprints"];
  const codes = value["codes"];
  const severities = value["severities"];
  return {
    at: value["at"],
    session_id: typeof session === "string" ? session : null,
    event: value["event"],
    files: value["files"],
    lines: value["lines"].filter(isLineCount),
    fingerprints: prints,
    ...(isAligned(codes, prints) ? { codes } : {}),
    ...(isAligned(severities, prints) ? { severities } : {}),
    durationMs: value["durationMs"],
  };
}
/**
 * Tells whether a parsed value is an object.
 *
 * @param value - the value.
 * @returns true for a non-null, non-array object.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
/**
 * Tells whether a value is an array of strings.
 *
 * @param value - the value.
 * @returns true for string[].
 */
function isStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}
/**
 * Tells whether a value is a string array parallel to the fingerprints.
 *
 * @param value - `codes` or `severities`.
 * @param prints - the line's fingerprints.
 * @returns true for a string[] of the same length.
 */
function isAligned(value: unknown, prints: readonly string[]): value is string[] {
  return isStrings(value) && value.length === prints.length;
}
/**
 * Tells whether a value is a plausible duration.
 *
 * @param value - the value.
 * @returns true for a finite number of milliseconds, zero or more.
 */
function isDuration(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
/**
 * Tells whether a value is one entry of a line's `lines`.
 *
 * @param value - the value.
 * @returns true for `{file, added, removed}`.
 */
function isLineCount(value: unknown): value is RunLine["lines"][number] {
  return (
    isRecord(value) &&
    typeof value["file"] === "string" &&
    typeof value["added"] === "number" &&
    typeof value["removed"] === "number"
  );
}
