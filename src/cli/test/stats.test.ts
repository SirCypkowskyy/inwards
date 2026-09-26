import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { computeStats, readRunLog, type Stats } from "../src/stats.ts";
import { inwards, LAYERS, project } from "./run.ts";

/**
 * Builds one run-log line.
 *
 * @param at - minutes after the start, for the `at` field.
 * @param fields - the fields that differ from a plain PostToolUse line.
 * @returns the line as JSON text.
 */
function line(at: number, fields: Record<string, unknown>): string {
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
function edit(
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

// Worked by hand:
// - pOld was reported by `check --log` before both sessions, so it never counts.
// - s1: p1 (INW001) in a.py is gone at the next a.py run: fixed. p2 (INW011) in
//   b.py is still there: not fixed. p3 in c.py has no later run, and its line
//   predates `codes`: no retry, rule unknown.
// - Retry rate 1 of 2. Violations 3 (p1, p2, p3) in 10+2+20+1+7+10 = 50 lines:
//   60 per 1,000. Latency [30,40,50,60,200,20]: p50 40, p95 200.
const LOG = [
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

const EXPECTED: Stats = {
  schema: "inwards/stats@1",
  sessions: 2,
  hookRuns: 6,
  skippedLines: 1,
  fixedWithinOneRetry: {
    reported: 2,
    fixed: 1,
    noRetry: 1,
    rate: 0.5,
    target: 0.8,
    byRule: {
      INW001: { reported: 1, fixed: 1, noRetry: 0, rate: 1 },
      INW011: { reported: 1, fixed: 0, noRetry: 0, rate: 0 },
      unknown: { reported: 0, fixed: 0, noRetry: 1, rate: null },
    },
  },
  violationsPer1000Lines: { violations: 3, linesAdded: 50, rate: 60, target: 1 },
  hookLatencyMs: { runs: 6, p50: 40, p95: 200, target: 100 },
};

/**
 * Creates a project whose run log holds the given lines.
 *
 * @param lines - the log lines.
 * @returns the project directory.
 */
function withLog(lines: string[]): string {
  const root = project({ "pyproject.toml": LAYERS, "shop/domain/order.py": "" });
  mkdirSync(join(root, ".inwards"), { recursive: true });
  writeFileSync(join(root, ".inwards/runs.jsonl"), `${lines.join("\n")}\n`);
  return root;
}

describe("inwards stats", () => {
  test("the numbers match the hand-computed log", () => {
    const { lines, skipped } = readRunLog(withLog(LOG));
    expect(computeStats(lines, skipped)).toEqual(EXPECTED);
  });

  test("the rotated file is read first, so order holds across rotation", () => {
    const root = withLog(LOG.slice(4));
    writeFileSync(join(root, ".inwards/runs.1.jsonl"), `${LOG.slice(0, 4).join("\n")}\n`);
    const { lines, skipped } = readRunLog(root);
    expect(computeStats(lines, skipped)).toEqual(EXPECTED);
  });

  test("the CLI prints the same JSON, and text with the targets", () => {
    const root = withLog(LOG);
    const json = inwards(["stats", "--format", "json"], { cwd: root });
    expect(json.code).toBe(0);
    expect(JSON.parse(json.stdout)).toEqual(EXPECTED);
    const text = inwards(["stats"], { cwd: root });
    expect(text.stdout).toContain(
      "Fixed within one retry: 1 of 2 (50%). Target: at least 80%. Not met.",
    );
    expect(text.stdout).toContain("Violations per 1,000 agent-written lines: 60 (3 in 50 lines).");
    expect(text.stdout).toContain("Hook latency: p50 40 ms, p95 200 ms over 6 runs.");
  });

  test("an empty log says there is no data", () => {
    const root = project({ "pyproject.toml": LAYERS, "shop/domain/order.py": "" });
    const { stdout, code } = inwards(["stats"], { cwd: root });
    expect(code).toBe(0);
    expect(stdout).toContain("No data yet.");
  });

  test("a bad format is a usage error", () => {
    const root = project({ "pyproject.toml": LAYERS, "shop/domain/order.py": "" });
    expect(inwards(["stats", "--format", "sarif"], { cwd: root }).code).toBe(2);
  });
});
