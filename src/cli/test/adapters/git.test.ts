/**
 * @file The daemon's git budget on real processes (#277): a git that hangs is
 * killed when the request's budget runs out and answers "not there", later
 * calls in the same request don't start, and the next request gets a fresh
 * budget. Unix only: the hanging git is a shell script.
 */
import { describe, expect, test } from "bun:test";
import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { budgetedGit } from "../../src/adapters/git.ts";
import { tempDir } from "../support/temp.ts";

const BUDGET_MS = 300;

/**
 * Writes an executable that stands in for git: it hangs, ignoring SIGTERM, or
 * prints its arguments and exits.
 *
 * @param hang - true for a git that never answers.
 * @returns the script's path.
 */
function fakeGit(hang: boolean): string {
  const dir = tempDir("inwards-git-");
  const path = join(dir, "git");
  const body = hang ? "trap '' TERM\nexec sleep 30\n" : 'echo "$@"\n';
  writeFileSync(path, `#!/bin/sh\n${body}`);
  chmodSync(path, 0o755);
  return path;
}

/**
 * Times one call.
 *
 * @param call - the git call.
 * @returns its answer and how long it took in milliseconds.
 */
function timed(call: () => string | undefined): { out: string | undefined; ms: number } {
  const start = performance.now();
  const out = call();
  return { out, ms: performance.now() - start };
}

describe.skipIf(process.platform === "win32")("the daemon's git budget (#277)", () => {
  test("a hanging git is killed at the budget, and the rest of the request skips git", () => {
    const git = budgetedGit(BUDGET_MS, fakeGit(true));
    git.begin();
    const first = timed(() => git.run(".", ["cat-file", "blob", "HEAD:a.py"]));
    expect(first.out).toBeUndefined();
    expect(first.ms).toBeGreaterThanOrEqual(BUDGET_MS - 50);
    expect(first.ms).toBeLessThan(BUDGET_MS * 10);
    const second = timed(() => git.run(".", ["ls-tree", "HEAD"]));
    expect(second.out).toBeUndefined();
    expect(second.ms).toBeLessThan(BUDGET_MS);
  });

  test("a git that answers in time is read, and every request gets a fresh budget", () => {
    const git = budgetedGit(BUDGET_MS, fakeGit(false));
    expect(git.run(".", ["rev-parse", "HEAD"])).toBeUndefined();
    git.begin();
    expect(git.run(".", ["rev-parse", "HEAD"])).toContain("rev-parse HEAD");
    expect(git.run(".", ["ls-tree", "HEAD"])).toContain("core.hooksPath=/dev/null ls-tree HEAD");
    git.begin();
    expect(git.run(".", ["ls-tree", "HEAD"])).toContain("ls-tree HEAD");
  });
});
