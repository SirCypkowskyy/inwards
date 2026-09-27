/**
 * Helpers for the stats tests: run-log lines, a worked-by-hand log, and a
 * project holding a log.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { nodeFileReader } from "../src/adapters/filesystem.ts";
import { readRunLogs } from "../src/runlog/runs.ts";
import { computeStats, type Stats } from "../src/runlog/stats.ts";
import { LAYERS, project } from "./run.ts";

/**
 * Builds one run-log line.
 *
 * @param at - minutes after the start, for the `at` field.
 * @param fields - the fields that differ from a plain PostToolUse line.
 * @returns the line as JSON text.
 */
export function line(at: number, fields: Record<string, unknown>): string {
  return JSON.stringify({
    v: 1,
    at: new Date(Date.UTC(2026, 8, 26, 12, at)).toISOString(),
    session_id: "s1",
    event: "PostToolUse",
    tool: "Edit",
    files: [],
    lines: [],
    fingerprints: [],
    exit: 0,
    durationMs: 0,
    ...fields,
  });
}
/**
 * A PostToolUse line for one file.
 *
 * @param at - minutes after the start.
 * @param session - the session id.
 * @param file - the edited file.
 * @param rest - lines added, fingerprints, codes (optional) and duration.
 * @returns the line as JSON text.
 */
export function edit(
  at: number,
  session: string,
  file: string,
  rest: { added: number; prints: string[]; codes?: string[]; ms: number },
): string {
  return line(at, {
    session_id: session,
    files: [file],
    lines: [{ file, added: rest.added, removed: 0 }],
    fingerprints: rest.prints,
    ...(rest.codes ? { codes: rest.codes } : {}),
    durationMs: rest.ms,
  });
}
/**
 * Creates a project whose run log holds the given lines.
 *
 * @param lines - the log lines.
 * @returns the project directory.
 */
export function withLog(lines: string[]): string {
  const root = project({ "pyproject.toml": LAYERS, "shop/domain/order.py": "" });
  mkdirSync(join(root, ".inwards"), { recursive: true });
  writeFileSync(join(root, ".inwards/runs.jsonl"), `${lines.join("\n")}\n`);
  return root;
}
/**
 * Computes stats for a handful of lines.
 *
 * @param lines - log lines as JSON text.
 * @returns the numbers.
 */
export function statsOf(lines: string[]): Stats {
  const { lines: parsed, skipped } = readRunLogs(nodeFileReader, [withLog(lines)]);
  return computeStats(parsed, skipped);
}

// Worked by hand:
// - pOld was reported by `check --log` before both sessions, so it never counts.
// - s1: p1 (INW001) in a.py is gone at the next a.py run: fixed. p2 (INW011) in
//   b.py is still there: not fixed. p3 in c.py has no later run, and its line
//   predates `codes`: no retry, rule unknown.
// - Retry rate 1 of 2. Violations 3 (p1, p2, p3) in 10+2+20+1+7+10 = 50 lines:
//   60 per 1,000. Latency [30,40,50,60,200,20]: p50 40, p95 200.
export const LOG = [
  line(0, {
    session_id: null,
    event: "check",
    files: ["."],
    fingerprints: ["pOld"],
    codes: ["INW001"],
  }),
  line(1, { event: "SessionStart", tool: null }),
  edit(2, "s1", "a.py", { added: 10, prints: ["pOld", "p1"], codes: ["INW001", "INW001"], ms: 30 }),
  edit(3, "s1", "a.py", { added: 2, prints: ["pOld"], codes: ["INW001"], ms: 40 }),
  edit(4, "s1", "b.py", { added: 20, prints: ["p2"], codes: ["INW011"], ms: 50 }),
  edit(5, "s1", "b.py", { added: 1, prints: ["p2"], codes: ["INW011"], ms: 60 }),
  edit(6, "s1", "c.py", { added: 7, prints: ["p3"], ms: 200 }),
  edit(7, "s2", "a.py", { added: 10, prints: ["pOld"], codes: ["INW001"], ms: 20 }),
  "not json",
];
