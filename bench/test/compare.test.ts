/**
 * @file The benchmark comparison's arithmetic: nearest-rank percentiles, the
 * threshold judgement on paired ratios, and the Markdown table. A slower head
 * must fail the gate and an equal one pass.
 */
import { describe, expect, test } from "bun:test";
import { judge, markdown, percentile } from "../compare.ts";

describe("bench compare", () => {
  test("percentile uses the nearest rank", () => {
    const xs = [5, 1, 4, 2, 3];
    expect(percentile(xs, 0.5)).toBe(3);
    expect(percentile(xs, 0.95)).toBe(5);
    expect(percentile([], 0.5)).toBeNaN();
  });

  test("a 30% slower head fails a 20% threshold; an equal one passes", () => {
    const base = [50, 51, 49, 52, 50, 48, 53, 50];
    expect(judge("hook", { base, head: base.map((x) => x * 1.3) }, 0.2).pass).toBe(false);
    expect(judge("hook", { base, head: [...base].reverse() }, 0.2).pass).toBe(true);
  });

  test("load that drifts during the job cancels out within pairs", () => {
    const base = [40, 45, 60, 80, 100, 90, 60, 45];
    expect(judge("full", { base, head: base.map((x) => x * 1.05) }, 0.2).pass).toBe(true);
    expect(judge("full", { base, head: base.map((x) => x * 1.3) }, 0.2).pass).toBe(false);
  });

  test("one spike doesn't move the median", () => {
    const base = [50, 50, 50, 50, 50, 50, 50, 50, 50];
    const head = [50, 50, 50, 50, 50, 50, 50, 50, 400];
    expect(judge("hook", { base, head }, 0.2).pass).toBe(true);
  });

  test("the table names the slower metric", () => {
    const slow = judge("full check", { base: [100], head: [150] }, 0.2);
    expect(markdown([slow], 0.2)).toContain("**full check more than 20% slower");
  });
});
