/**
 * @file Git behind the `Git` contract. The hooks run git in a project whose
 * `.git/config` the agent can write, so only plumbing that runs no filters,
 * hooks or pagers may go through here (`rev-parse`, `cat-file blob`,
 * `ls-tree`), and every call switches off the two config commands such
 * plumbing could still reach (fsmonitor and hooksPath). The daemon's git
 * also has a time budget per request, so a git call that hangs can't hold
 * its queue (#277); a one-shot hook waits for git as long as git takes.
 */
import { spawnSync } from "node:child_process";
import type { Git } from "../platform/contracts.ts";

/** Flags on every call: no pager, no fsmonitor, no hooks. */
const SAFE = ["--no-pager", "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null"];

/** Git as a subprocess. */
export const nodeGit: Git = {
  run: (dir: string, args: string[]): string | undefined => runGit("git", dir, args),
};

/** Git with a time budget that starts again for every request. */
export interface BudgetedGit extends Git {
  /** Starts a request's budget; calls before the first `begin` get none. */
  begin: () => void;
}

/**
 * Builds the daemon's git: every call in one request shares `budgetMs`. A
 * call that would run past it is killed, and a call made after it runs out
 * isn't started; both answer "not there", as a failed call does. The Stop
 * gate never runs in the daemon, so a missing answer can only make a
 * PostToolUse report less than a one-shot run would.
 *
 * @param budgetMs - how long all of one request's git calls may take together.
 * @param command - the git executable; the tests pass one that hangs.
 * @returns git whose `begin` starts a request's budget.
 */
export function budgetedGit(budgetMs: number, command = "git"): BudgetedGit {
  let deadline = 0;
  return {
    begin(): void {
      deadline = performance.now() + budgetMs;
    },
    run(dir: string, args: string[]): string | undefined {
      const left = Math.floor(deadline - performance.now());
      return left > 0 ? runGit(command, dir, args, left) : undefined;
    },
  };
}

/**
 * Runs one hardened git command. With a timeout, a call that runs past it is
 * killed with SIGKILL (on Windows, terminated): `spawnSync` returns only once
 * the child has exited, so a git that ignored SIGTERM would hold it anyway.
 * A call that timed out counts as failed even when git exited with 0, which
 * Bun reports for a child that outlived the timeout.
 *
 * @param command - the git executable.
 * @param dir - the working directory.
 * @param args - git arguments.
 * @param timeoutMs - how long the call may take, or undefined for no limit.
 * @returns stdout, or undefined when git fails, times out or isn't installed.
 */
function runGit(
  command: string,
  dir: string,
  args: string[],
  timeoutMs?: number,
): string | undefined {
  const run = spawnSync(command, [...SAFE, ...args], {
    cwd: dir,
    encoding: "utf8",
    ...(timeoutMs === undefined ? {} : { timeout: timeoutMs, killSignal: "SIGKILL" }),
  });
  return run.status === 0 && run.error === undefined ? run.stdout : undefined;
}
