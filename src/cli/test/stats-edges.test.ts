import { describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { inwards } from "./run.ts";
import { edit, LOG, statsOf, withLog } from "./stats-helpers.ts";

describe("inwards stats: edge cases (#112)", () => {
  test("two sessions on one file at once: a violation belongs to the session that made it", () => {
    const stats = statsOf([
      edit(0, "A", "a.py", { added: 1, prints: [], ms: 1 }),
      edit(1, "B", "a.py", { added: 1, prints: ["p"], ms: 1 }),
      edit(2, "A", "a.py", { added: 1, prints: ["p"], ms: 1 }),
      edit(3, "B", "a.py", { added: 1, prints: [], ms: 1 }),
    ]);
    expect(stats.fixedWithinOneRetry).toMatchObject({ reported: 1, fixed: 1 });
    expect(stats.violationsPer1000Lines.violations).toBe(1);
  });

  test("a .py and its .pyi count the same way in both rates", () => {
    const stats = statsOf([
      edit(0, "s1", "m.py", { added: 1, prints: ["p"], ms: 1 }),
      edit(1, "s1", "m.pyi", { added: 1, prints: ["p"], ms: 1 }),
      edit(2, "s1", "m.py", { added: 1, prints: [], ms: 1 }),
      edit(3, "s1", "m.pyi", { added: 1, prints: [], ms: 1 }),
    ]);
    expect(stats.fixedWithinOneRetry.reported).toBe(2);
    expect(stats.violationsPer1000Lines.violations).toBe(2);
  });

  test("outside git, a package's stats read the log above it", () => {
    const root = withLog(LOG);
    mkdirSync(join(root, "pkg"), { recursive: true });
    const run = inwards(["stats", "--format", "json"], { cwd: join(root, "pkg") });
    expect(JSON.parse(run.stdout).hookRuns).toBe(6);
  });

  test("a violation another session made and fixed, then this session made, counts as this session's", () => {
    const stats = statsOf([
      edit(0, "A", "a.py", { added: 1, prints: [], ms: 1 }),
      edit(1, "B", "a.py", { added: 1, prints: ["X"], ms: 1 }),
      edit(2, "A", "a.py", { added: 1, prints: ["X"], ms: 1 }),
      edit(3, "B", "a.py", { added: 1, prints: [], ms: 1 }),
      edit(4, "A", "a.py", { added: 1, prints: ["X"], ms: 1 }),
      edit(5, "A", "a.py", { added: 1, prints: [], ms: 1 }),
    ]);
    expect(stats.fixedWithinOneRetry).toMatchObject({ reported: 2, fixed: 2 });
    expect(stats.violationsPer1000Lines.violations).toBe(2);
  });

  test("outside git, the folder with the hooks' session state wins over an outer log", () => {
    const outer = withLog(LOG);
    const inner = join(outer, "proj");
    mkdirSync(join(inner, ".inwards/state"), { recursive: true });
    mkdirSync(join(inner, "pkg"), { recursive: true });
    const run = inwards(["stats", "--format", "json"], { cwd: join(inner, "pkg") });
    expect(JSON.parse(run.stdout).hookRuns).toBe(0);
  });

  test("outside git, the walk stops below the home directory", () => {
    const home = withLog(LOG);
    mkdirSync(join(home, "proj/pkg"), { recursive: true });
    const run = inwards(["stats", "--format", "json"], {
      cwd: join(home, "proj/pkg"),
      env: { HOME: home },
    });
    expect(JSON.parse(run.stdout).hookRuns).toBe(0);
  });

  test("--config gets a one-line reason", () => {
    const root = withLog(LOG);
    const run = inwards(["stats", "--config", "pyproject.toml"], { cwd: root });
    expect(run.code).toBe(2);
    expect(run.stderr.trim().split("\n")).toHaveLength(1);
  });

  test("79.95% isn't shown as 80% next to a missed target", () => {
    const runs: string[] = [];
    for (let i = 0; i < 2000; i += 1) {
      const kept = i < 401 ? [`p${i}`] : [];
      runs.push(edit(0, "s1", `f${i}.py`, { added: 0, prints: [`p${i}`], ms: 1 }));
      runs.push(edit(1, "s1", `f${i}.py`, { added: 0, prints: kept, ms: 1 }));
    }
    const text = inwards(["stats", withLog(runs)], { cwd: withLog([]) });
    expect(text.stdout).toContain("1599 of 2000 (79.9%). Target: at least 80%. Not met.");
  });
});
