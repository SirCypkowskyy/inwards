import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readRunLogs } from "../src/runs.ts";
import { computeStats, type Stats } from "../src/stats.ts";
import { inwards, LAYERS, project } from "./run.ts";
import { edit, LOG, line, statsOf, withLog } from "./stats-helpers.ts";

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
    met: false,
    byRule: {
      INW001: { reported: 1, fixed: 1, noRetry: 0, rate: 1 },
      INW011: { reported: 1, fixed: 0, noRetry: 0, rate: 0 },
      unknown: { reported: 0, fixed: 0, noRetry: 1, rate: null },
    },
  },
  violationsPer1000Lines: { violations: 3, linesAdded: 50, rate: 60, target: 1, met: true },
  hookLatencyMs: { runs: 6, p50: 40, p95: 200, target: 100, met: true },
};

describe("inwards stats", () => {
  test("the numbers match the hand-computed log", () => {
    const { lines, skipped } = readRunLogs([withLog(LOG)]);
    expect(computeStats(lines, skipped)).toEqual(EXPECTED);
  });

  test("the rotated file is read first, so order holds across rotation", () => {
    const root = withLog(LOG.slice(4));
    writeFileSync(join(root, ".inwards/runs.1.jsonl"), `${LOG.slice(0, 4).join("\n")}\n`);
    const { lines, skipped } = readRunLogs([root]);
    expect(computeStats(lines, skipped)).toEqual(EXPECTED);
  });

  test("the CLI prints the same JSON, and text with the targets", () => {
    const root = withLog(LOG);
    const json = inwards(["stats", root, "--format", "json"], { cwd: root });
    expect(json.code).toBe(0);
    expect(JSON.parse(json.stdout)).toEqual(EXPECTED);
    const text = inwards(["stats", root], { cwd: root });
    expect(text.stdout).toContain(
      "Fixed within one retry: 1 of 2 (50%). Target: at least 80%. Not met.",
    );
    expect(text.stdout).toContain("Violations per 1,000 agent-written lines: 60 (3 in 50 lines).");
    expect(text.stdout).toContain("Hook latency: p50 40 ms, p95 200 ms over 6 runs.");
  });

  test("an empty log says there is no data", () => {
    const root = project({ "pyproject.toml": LAYERS, "shop/domain/order.py": "" });
    const { stdout, code } = inwards(["stats", root], { cwd: root });
    expect(code).toBe(0);
    expect(stdout).toContain("No data yet.");
  });

  test("a bad format is a usage error", () => {
    const root = project({ "pyproject.toml": LAYERS, "shop/domain/order.py": "" });
    expect(inwards(["stats", "--format", "sarif"], { cwd: root }).code).toBe(2);
    expect(inwards(["stats", "--config", "pyproject.toml"], { cwd: root }).code).toBe(2);
  });
});

describe("inwards stats: review cases", () => {
  test("a check run after SessionStart but before the first edit still marks old violations", () => {
    const stats = statsOf([
      line(0, { event: "SessionStart", tool: null }),
      line(1, { session_id: null, event: "check", fingerprints: ["old"] }),
      edit(2, "s1", "a.py", { added: 1, prints: ["old"], ms: 1 }),
      edit(3, "s1", "a.py", { added: 1, prints: ["old"], ms: 1 }),
    ]);
    expect(stats.fixedWithinOneRetry.reported).toBe(0);
    expect(stats.violationsPer1000Lines.violations).toBe(0);
  });

  test("warnings don't count", () => {
    const warn = { added: 1, prints: ["w"], codes: ["INW006"], ms: 1 };
    const stats = statsOf([
      line(0, { ...JSON.parse(edit(0, "s1", "u.py", warn)), severities: ["warning"] }),
      line(1, { ...JSON.parse(edit(1, "s1", "u.py", warn)), severities: ["warning"] }),
    ]);
    expect(stats.fixedWithinOneRetry.byRule).toEqual({});
    expect(stats.violationsPer1000Lines.violations).toBe(0);
  });

  test("a violation still there at Stop counts as not fixed", () => {
    const stats = statsOf([
      edit(0, "s1", "a.py", { added: 1, prints: ["p"], ms: 1 }),
      edit(1, "s1", "b.py", { added: 1, prints: [], ms: 1 }),
      line(2, { event: "Stop", tool: null, fingerprints: ["p"] }),
    ]);
    expect(stats.fixedWithinOneRetry).toMatchObject({ reported: 1, fixed: 0, noRetry: 0 });
    const earlierStop = statsOf([
      line(0, { event: "Stop", tool: null, fingerprints: ["p"] }),
      edit(1, "s1", "a.py", { added: 1, prints: ["p"], ms: 1 }),
    ]);
    expect(earlierStop.fixedWithinOneRetry).toMatchObject({ reported: 0, noRetry: 1 });
  });

  test("a violation left by an earlier session isn't counted again", () => {
    const stats = statsOf([
      edit(0, "s1", "a.py", { added: 1, prints: ["p"], ms: 1 }),
      edit(1, "s1", "a.py", { added: 1, prints: ["p"], ms: 1 }),
      edit(2, "s2", "a.py", { added: 1, prints: ["p"], ms: 1 }),
      edit(3, "s2", "a.py", { added: 1, prints: ["p"], ms: 1 }),
    ]);
    expect(stats.fixedWithinOneRetry).toMatchObject({ reported: 1, fixed: 0 });
    expect(stats.violationsPer1000Lines.violations).toBe(1);
  });

  test("hook runs that checked no file don't count toward latency", () => {
    const stats = statsOf([
      edit(0, "s1", "a.py", { added: 1, prints: [], ms: 40 }),
      line(1, { files: [], durationMs: 5 }),
      line(2, { files: [], durationMs: 5 }),
    ]);
    expect(stats.hookLatencyMs).toMatchObject({ runs: 1, p50: 40 });
  });

  test("the verdict uses the exact share, not the rounded one", () => {
    const runs: string[] = [];
    for (let i = 0; i < 2000; i += 1) {
      const kept = i < 401 ? [`p${i}`] : [];
      runs.push(edit(0, "s1", `f${i}.py`, { added: 0, prints: [`p${i}`], ms: 1 }));
      runs.push(edit(1, "s1", `f${i}.py`, { added: 0, prints: kept, ms: 1 }));
    }
    const retry = statsOf(runs).fixedWithinOneRetry;
    expect(retry).toMatchObject({ reported: 2000, fixed: 1599, rate: 0.8, met: false });
  });

  test("the hooks' log at the root and a package's check log are read together", () => {
    const root = project({
      "pyproject.toml": '[project]\nname = "mono"\n',
      "pkg/pyproject.toml": LAYERS.replaceAll("shop", "pkg"),
      "pkg/pkg/domain/order.py": "",
      "pkg/pkg/infrastructure/db.py": "",
    });
    mkdirSync(join(root, ".inwards"), { recursive: true });
    mkdirSync(join(root, "pkg/.inwards"), { recursive: true });
    writeFileSync(
      join(root, ".inwards/runs.jsonl"),
      `${[edit(2, "s1", "pkg/pkg/domain/order.py", { added: 5, prints: ["old", "new"], ms: 30 }), edit(3, "s1", "pkg/pkg/domain/order.py", { added: 1, prints: ["old"], ms: 30 })].join("\n")}\n`,
    );
    writeFileSync(
      join(root, "pkg/.inwards/runs.jsonl"),
      `${line(1, { session_id: null, event: "check", fingerprints: ["old"] })}\n`,
    );
    const env = { CLAUDE_PROJECT_DIR: root };
    const run = inwards(["stats", "--format", "json"], { cwd: join(root, "pkg"), env });
    expect(run.code).toBe(0);
    expect(JSON.parse(run.stdout).fixedWithinOneRetry).toMatchObject({ reported: 1, fixed: 1 });
  });
});
