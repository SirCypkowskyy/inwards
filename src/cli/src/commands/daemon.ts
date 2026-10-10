/**
 * @file `inwards daemon`: the resident process that keeps the engine warm for
 * the PostToolUse hook (ADR-039), in the foreground, for the project in the
 * working directory (or `CLAUDE_PROJECT_DIR`); and `inwards daemon status`
 * and `inwards daemon stop` for that project. Hooks start it on their own and
 * it exits after 10 minutes without a request, so nobody has to run it by
 * hand. The socket, the lock and the record are the adapter's
 * (`DaemonHost`, `DaemonLink`); what a request means is `daemon/server.ts`.
 */
import { ConfigError, VERSION } from "@inwards/core";
import { hookProject } from "../claude-code/protocol.ts";
import { askDaemon, BACKOFF_MS, holdsLock } from "../daemon/client.ts";
import type { LockHolder } from "../daemon/contracts.ts";
import { daemonPlace, type HookRequest, PROTOCOL, toLine } from "../daemon/protocol.ts";
import { createHandler, type HookOutcome } from "../daemon/server.ts";
import { print } from "../platform/print.ts";
import type { AppDeps, DaemonDeps } from "./deps.ts";
import { hookClaudeCode } from "./hook.ts";

/** How long the daemon waits for a request before it exits: 10 minutes. */
const IDLE_SECONDS = 600;
const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const DIGITS = /^\d+$/u;

/**
 * Runs `inwards daemon`, `inwards daemon status` or `inwards daemon stop`.
 *
 * @param deps - this invocation's dependencies.
 * @param args - the positionals after `daemon`.
 * @param idle - `--idle SECONDS`, how long to wait for a request before exiting.
 * @param usage - the CLI usage text, for a usage error.
 * @returns the exit code: 0, 1 when the daemon couldn't serve or isn't
 *   answering, 2 for a usage error.
 */
export async function daemonCommand(
  deps: AppDeps,
  args: string[],
  idle: string | undefined,
  usage: string,
): Promise<number> {
  const { io } = deps;
  const [sub, ...rest] = args;
  const seconds = idleSeconds(idle);
  if (
    rest.length > 0 ||
    seconds <= 0 ||
    (sub !== undefined && sub !== "status" && sub !== "stop")
  ) {
    return print(io.streams, usage, 2);
  }
  const project = hookProject(io);
  if (project === undefined) {
    return print(io.streams, `inwards daemon: ${io.runtime.cwd} doesn't exist.`, 2);
  }
  if (sub === undefined) {
    return await serveDaemon(deps, project, seconds * MS_PER_SECOND, usage);
  }
  return sub === "status" ? await status(deps, project) : await stop(deps, project);
}

/**
 * Reads `--idle SECONDS`.
 *
 * @param idle - the option's value, if given.
 * @returns the seconds; 600 when not given, 0 when not a whole number.
 */
function idleSeconds(idle: string | undefined): number {
  if (idle === undefined) {
    return IDLE_SECONDS;
  }
  return DIGITS.test(idle) ? Number(idle) : 0;
}

/**
 * Serves the project's PostToolUse hooks until stopped or idle.
 *
 * @param deps - this invocation's dependencies.
 * @param project - the real project root.
 * @param idleMs - how long to wait for a request before exiting.
 * @param usage - the CLI usage text, for the hook's own TTY check.
 * @returns 0 when it served or another daemon already serves the project, 1 when it couldn't listen.
 */
async function serveDaemon(
  deps: AppDeps,
  project: string,
  idleMs: number,
  usage: string,
): Promise<number> {
  const { io, daemon } = deps;
  const identity = daemon.link.identity();
  if (identity === undefined) {
    return print(io.streams, "inwards daemon: can't examine the running executable.", 1);
  }
  const started = io.clock.now();
  const place = daemonPlace(io.runtime, project);
  let endpoint = "";
  let token = "";
  const handler = createHandler(
    {
      version: VERSION,
      identity,
      currentIdentity: daemon.link.identity,
      status: () => ({
        pid: io.runtime.pid,
        project,
        endpoint,
        version: VERSION,
        started,
        idleMs,
        token,
      }),
    },
    (request: HookRequest): Promise<HookOutcome> => runRequest(daemon, request, usage),
  );
  const result = await daemon.host.serve(place, handler, {
    idleMs,
    holds: (holder: LockHolder): Promise<boolean> => holdsLock(daemon.link, place, holder, VERSION),
    record: (at: string, lock: string): string => {
      endpoint = at;
      token = lock;
      io.streams.err(`inwards daemon: serving ${project} at ${at}\n`);
      return toLine({
        protocol: PROTOCOL,
        version: VERSION,
        identity,
        pid: io.runtime.pid,
        endpoint: at,
        project,
        started,
      });
    },
    failure: (why: string): string =>
      toLine({ protocol: PROTOCOL, at: io.clock.now(), why, pid: io.runtime.pid }),
  });
  if (result.kind === "running") {
    return print(
      io.streams,
      `inwards daemon: already running for ${project} (pid ${result.pid}).`,
      0,
    );
  }
  if (result.kind === "failed") {
    return print(io.streams, `inwards daemon: can't listen: ${result.why}.`, 1);
  }
  return 0;
}

/**
 * Runs one hook request with its own runtime and buffered streams. An error
 * that escapes the hook is reported as `main.ts` reports it, with exit 2.
 *
 * @param daemon - builds the request's dependencies.
 * @param request - the hook request.
 * @param usage - the CLI usage text.
 * @returns the exit code and what the hook wrote.
 */
async function runRequest(
  daemon: DaemonDeps,
  request: HookRequest,
  usage: string,
): Promise<HookOutcome> {
  const { deps, output } = daemon.invocation(request);
  let exit: number;
  try {
    exit = await hookClaudeCode(deps, usage);
  } catch (err) {
    const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
    exit = print(
      deps.io.streams,
      err instanceof ConfigError ? `config error: ${err.message}` : detail,
      2,
    );
  }
  return { exit, ...output() };
}

/**
 * Shows whether the project's daemon runs, and what it has done.
 *
 * @param deps - this invocation's dependencies.
 * @param project - the real project root.
 * @returns 0 when a daemon answered, 1 otherwise.
 */
async function status(deps: AppDeps, project: string): Promise<number> {
  const { io, daemon } = deps;
  const { record, answer, failure } = await askDaemon(
    daemon.link,
    daemonPlace(io.runtime, project),
    "status",
    VERSION,
  );
  if (record === undefined) {
    const lines = [`inwards daemon: not running for ${project}.`];
    if (failure !== undefined) {
      const minutes = Math.round(BACKOFF_MS / MS_PER_SECOND / SECONDS_PER_MINUTE);
      lines.push(
        `  the last start (pid ${failure.pid}, ${failure.at}) couldn't listen: ${failure.why}.`,
        `  Hooks start no other one for ${minutes} minutes after that; \`inwards daemon\` tries now.`,
      );
    }
    return print(io.streams, lines.join("\n"), 1);
  }
  if (answer !== undefined && "status" in answer) {
    const s = answer.status;
    const seconds = Math.round(s.idleMs / MS_PER_SECOND);
    return print(
      io.streams,
      [
        `inwards daemon: running for ${s.project}`,
        `  pid ${s.pid}, Inwards ${s.version}, started ${s.started}`,
        `  endpoint ${s.endpoint}`,
        `  ${s.requests} hook runs served; exits after ${seconds} s without one`,
      ].join("\n"),
      0,
    );
  }
  if (answer !== undefined && "error" in answer && answer.error === "stale") {
    return print(
      io.streams,
      `inwards daemon: the daemon for ${project} (pid ${record.pid}) was from another build and has exited.`,
      1,
    );
  }
  return print(
    io.streams,
    `inwards daemon: the record names pid ${record.pid} at ${record.endpoint}, but nothing answers there.`,
    1,
  );
}

/**
 * Stops the project's daemon.
 *
 * @param deps - this invocation's dependencies.
 * @param project - the real project root.
 * @returns 0 when it stopped or wasn't running, 1 when it didn't answer.
 */
async function stop(deps: AppDeps, project: string): Promise<number> {
  const { io, daemon } = deps;
  const { record, answer } = await askDaemon(
    daemon.link,
    daemonPlace(io.runtime, project),
    "stop",
    VERSION,
  );
  if (record === undefined) {
    return print(io.streams, `inwards daemon: not running for ${project}.`, 0);
  }
  if (answer !== undefined && ("stopped" in answer || "error" in answer)) {
    return print(io.streams, `inwards daemon: stopped (pid ${record.pid}).`, 0);
  }
  return print(
    io.streams,
    `inwards daemon: the record names pid ${record.pid} at ${record.endpoint}, but nothing answers there.`,
    1,
  );
}
