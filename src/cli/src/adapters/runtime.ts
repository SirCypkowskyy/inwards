/**
 * @file The process behind the `Runtime` and `Clock` contracts: the environment
 * variables Inwards reads, the working directory, the platform and the
 * clocks. `readRuntime` is called once, by
 * `main.ts`; nothing else in the CLI reads `process` for these. The daemon
 * builds each request's runtime with `runtimeFrom` from the variables the
 * hook sent (`RUNTIME_ENV`).
 */
import { availableParallelism, homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import process from "node:process";
import type { Clock, Runtime } from "../platform/contracts.ts";

/**
 * The environment variables `Runtime` is built from. The hook sends these to
 * the daemon (`daemon/client.ts`), which builds the request's `Runtime` from
 * them as a one-shot run would from its own environment.
 */
const RUNTIME_ENV: readonly string[] = [
  "CLAUDE_PROJECT_DIR",
  "CLAUDE_CONFIG_DIR",
  "INWARDS_RUN_LOG",
  "FORCE_COLOR",
  "NO_COLOR",
  "INWARDS_NO_CACHE",
  "XDG_STATE_HOME",
  "CI",
  "INWARDS_HOOK_HOST",
  "INWARDS_PLUGIN_SHA256",
  "INWARDS_DAEMON",
  "HOME",
  "USERPROFILE",
];

/**
 * Reads the environment the CLI depends on, once.
 *
 * @returns the resolved runtime values.
 */
export function readRuntime(): Runtime {
  return runtimeFrom(process.env, {
    cwd: process.cwd(),
    stdinIsTTY: process.stdin.isTTY === true,
    stdoutIsTTY: process.stdout.isTTY === true,
  });
}

/**
 * Picks the variables `Runtime` reads out of an environment, for a request
 * to the daemon.
 *
 * @param env - the environment, usually `process.env`.
 * @returns the set ones among `RUNTIME_ENV`.
 */
export function runtimeEnv(env: Record<string, string | undefined>): Record<string, string> {
  const picked: Record<string, string> = {};
  for (const name of RUNTIME_ENV) {
    const value = env[name];
    if (value !== undefined) {
      picked[name] = value;
    }
  }
  return picked;
}

/**
 * Builds the runtime from an environment and a working directory: this
 * process's own, or the ones a hook sent the daemon. The process id, the
 * executable and the platform are always this process's.
 *
 * @param env - the environment variables.
 * @param where - the working directory and which streams are terminals.
 * @param where.cwd - the working directory.
 * @param where.stdinIsTTY - standard input is a terminal.
 * @param where.stdoutIsTTY - standard output is a terminal.
 * @returns the resolved runtime values.
 */
export function runtimeFrom(
  env: Record<string, string | undefined>,
  where: { cwd: string; stdinIsTTY: boolean; stdoutIsTTY: boolean },
): Runtime {
  const xdgState = env["XDG_STATE_HOME"] ?? "";
  // os.homedir() reads this process's HOME; a request brings its own.
  const home = (process.platform === "win32" ? env["USERPROFILE"] : env["HOME"]) || homedir();
  return {
    cwd: where.cwd,
    claudeProjectDir: env["CLAUDE_PROJECT_DIR"] || undefined,
    claudeConfigDir: env["CLAUDE_CONFIG_DIR"] || undefined,
    runLog: env["INWARDS_RUN_LOG"],
    forceColor: Boolean(env["FORCE_COLOR"]),
    noColor: Boolean(env["NO_COLOR"]),
    noCache: Boolean(env["INWARDS_NO_CACHE"]),
    threads: env["INWARDS_THREADS"] || undefined,
    cores: availableParallelism(),
    home,
    // The XDG spec says a relative value is invalid and must be ignored.
    stateHome: isAbsolute(xdgState) ? xdgState : join(home, ".local", "state"),
    platform: process.platform,
    pid: process.pid,
    execPath: process.execPath,
    ci: Boolean(env["CI"]),
    githubWorkspace: env["GITHUB_WORKSPACE"] || undefined,
    daemon: daemonSwitch(env["INWARDS_DAEMON"]),
    hookHost: env["INWARDS_HOOK_HOST"] === "opencode" ? "opencode" : "claude-code",
    pluginSha256: env["INWARDS_PLUGIN_SHA256"] || undefined,
    stdinIsTTY: where.stdinIsTTY,
    stdoutIsTTY: where.stdoutIsTTY,
  };
}

/**
 * Reads `INWARDS_DAEMON`.
 *
 * @param value - the variable, if set.
 * @returns "off" for `0`, `false`, `off` or `no`; "on" for `1`, `true`, `on` or
 *   `yes`; "auto" otherwise (on unless `CI` is set).
 */
function daemonSwitch(value: string | undefined): Runtime["daemon"] {
  const word = value?.trim().toLowerCase() ?? "";
  if (["0", "false", "off", "no"].includes(word)) {
    return "off";
  }
  return ["1", "true", "on", "yes"].includes(word) ? "on" : "auto";
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
