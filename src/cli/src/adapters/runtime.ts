/**
 * @file The process behind the `Runtime` and `Clock` contracts: the environment
 * variables Inwards reads, the working directory, the platform and the
 * clocks. `readRuntime` is called once, by
 * `main.ts`; nothing else in the CLI reads `process` for these.
 */
import { homedir } from "node:os";
import process from "node:process";
import type { Clock, Runtime } from "../platform/contracts.ts";

/**
 * Reads the environment the CLI depends on, once.
 *
 * @returns the resolved runtime values.
 */
export function readRuntime(): Runtime {
  const { env } = process;
  return {
    cwd: process.cwd(),
    claudeProjectDir: env["CLAUDE_PROJECT_DIR"] || undefined,
    claudeConfigDir: env["CLAUDE_CONFIG_DIR"] || undefined,
    runLog: env["INWARDS_RUN_LOG"],
    forceColor: Boolean(env["FORCE_COLOR"]),
    noColor: Boolean(env["NO_COLOR"]),
    noCache: Boolean(env["INWARDS_NO_CACHE"]),
    home: homedir(),
    platform: process.platform,
    pid: process.pid,
    execPath: process.execPath,
    ci: Boolean(env["CI"]),
    hookHost: env["INWARDS_HOOK_HOST"] === "opencode" ? "opencode" : "claude-code",
    stdinIsTTY: process.stdin.isTTY === true,
    stdoutIsTTY: process.stdout.isTTY === true,
  };
}

/** Wall-clock and monotonic time. */
export const systemClock: Clock = {
  now(): string {
    return new Date().toISOString();
  },
  elapsed(): number {
    // Since the process started (Bun's performance clock), so startup counts too.
    return performance.now();
  },
};
