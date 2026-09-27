/**
 * Git behind the `Git` contract. The hooks run git in a project whose
 * `.git/config` the agent can write, so only plumbing that runs no filters,
 * hooks or pagers may go through here (`rev-parse`, `cat-file blob`), and
 * every call switches off the two config commands such plumbing could still
 * reach (fsmonitor and hooksPath).
 */
import { spawnSync } from "node:child_process";
import type { Git } from "../platform/contracts.ts";

/** Flags on every call: no pager, no fsmonitor, no hooks. */
const SAFE = ["--no-pager", "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null"];

/** Git as a subprocess. */
export const nodeGit: Git = {
  run(dir: string, args: string[]): string | undefined {
    const run = spawnSync("git", [...SAFE, ...args], { cwd: dir, encoding: "utf8" });
    return run.status === 0 ? run.stdout : undefined;
  },
};
