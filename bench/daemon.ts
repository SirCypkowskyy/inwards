/**
 * @file The hook through `inwards daemon` for the bench job (#60): the head's
 * PostToolUse hook one-shot and through a running daemon, in alternation,
 * and a table with the daemon's p95 against the 50 ms target. Head only and
 * not gated, since the base branch may have no daemon to compare with.
 */
import process from "node:process";
import { judge, ms, timeRun } from "./timing.ts";

/** The #60 target: a hook's p95 through the daemon, in milliseconds. */
const DAEMON_TARGET_MS = 50;
/** How long to wait for the daemon to answer `status`. */
const DAEMON_START_MS = 10_000;
/** How often to ask while waiting. */
const POLL_MS = 50;

/** The head's PostToolUse hook one-shot and through the daemon, in milliseconds. */
export interface DaemonSamples {
  oneShot: number[];
  daemon: number[];
}

/**
 * Times the head's hook one-shot and through a running `inwards daemon`, in
 * alternation: even rounds start one-shot, odd rounds through the daemon. The daemon is started first and stopped at the end, also when
 * a run fails.
 *
 * @param head - the head's executable.
 * @param repo - the synthetic repo.
 * @param stdin - the PostToolUse payload.
 * @param runs - how many runs.
 * @param runs.measured - measured runs per mode.
 * @param runs.warmup - unmeasured runs per mode before those.
 * @param runs.before - runs before every timed run, untimed (an edit of the file, say).
 * @returns the samples.
 * @throws {Error} when the daemon doesn't start or a run fails.
 */
export function daemonHook(
  head: string,
  repo: string,
  stdin: string,
  runs: { measured: number; warmup: number; before?: () => void },
): DaemonSamples {
  const on = { INWARDS_DAEMON: "1" };
  const env = { ...process.env, CLAUDE_PROJECT_DIR: repo, ...on };
  Bun.spawn([head, "daemon", "--idle", "120"], {
    cwd: repo,
    env,
    stdout: "ignore",
    stderr: "ignore",
  });
  const samples: DaemonSamples = { oneShot: [], daemon: [] };
  try {
    waitForDaemon(head, repo, env);
    for (let i = 0; i < runs.warmup + runs.measured; i += 1) {
      // Each round starts with the other mode, so warming and drift hit both alike.
      const first = i % 2 === 0 ? "oneShot" : "daemon";
      runs.before?.();
      const firstMs = timeHook(head, repo, stdin, first === "daemon");
      runs.before?.();
      const secondMs = timeHook(head, repo, stdin, first !== "daemon");
      const oneShot = first === "oneShot" ? firstMs : secondMs;
      const daemon = first === "oneShot" ? secondMs : firstMs;
      if (i >= runs.warmup) {
        samples.oneShot.push(oneShot);
        samples.daemon.push(daemon);
      }
    }
  } finally {
    Bun.spawnSync([head, "daemon", "stop"], { cwd: repo, env });
  }
  return samples;
}

/**
 * Times one run of the head's hook.
 *
 * @param head - the head's executable.
 * @param repo - the synthetic repo.
 * @param stdin - the PostToolUse payload.
 * @param daemon - true to go through the daemon (`INWARDS_DAEMON=1`), false for one-shot.
 * @returns the elapsed milliseconds.
 */
function timeHook(head: string, repo: string, stdin: string, daemon: boolean): number {
  const env = { INWARDS_DAEMON: daemon ? "1" : "0" };
  return timeRun([head, "hook", "claude-code"], repo, stdin, env);
}

/**
 * Waits until `inwards daemon status` answers for the repo.
 *
 * @param head - the head's executable.
 * @param repo - the synthetic repo.
 * @param env - the environment the daemon was started with.
 * @throws {Error} when it doesn't answer within `DAEMON_START_MS`.
 */
function waitForDaemon(head: string, repo: string, env: Record<string, string | undefined>): void {
  const deadline = performance.now() + DAEMON_START_MS;
  while (Bun.spawnSync([head, "daemon", "status"], { cwd: repo, env }).exitCode !== 0) {
    if (performance.now() > deadline) {
      throw new Error("inwards daemon didn't start");
    }
    Bun.sleepSync(POLL_MS);
  }
}

/**
 * Renders the head's hook through the daemon as a Markdown table.
 *
 * @param samples - the hook one-shot and through the daemon.
 * @returns the table, with the p95 against the #60 target.
 */
export function daemonMarkdown(samples: DaemonSamples): string {
  const vs = judge("daemon", { base: samples.oneShot, head: samples.daemon }, 1);
  const met = vs.head.p95 < DAEMON_TARGET_MS ? "met" : "**missed**";
  return [
    "| PostToolUse hook (head) | p50 / p95 (ms) | Against one-shot (median of pairs) |",
    "|---|---|---|",
    `| one-shot | ${ms(vs.base.p50)} / ${ms(vs.base.p95)} | |`,
    `| through the daemon | ${ms(vs.head.p50)} / ${ms(vs.head.p95)} | ${(1 / vs.ratio).toFixed(1)}× faster |`,
    "",
    `p95 through the daemon against the ${DAEMON_TARGET_MS} ms target (#60): ${met}.`,
  ].join("\n");
}
