/**
 * @file How the eval runs OpenCode, and how it reads what OpenCode recorded.
 * Each run starts `opencode serve` in the scratch project and drives one
 * session over its HTTP API, instead of `opencode run`, because `opencode
 * run` exits when the session goes idle: the Inwards plugin's Stop gate
 * sends its reasons as a new message at that point, and only a server stays
 * up for that second turn. The run ends once the session has stayed idle for
 * SETTLE_MS. OpenCode gets a private home directory for the whole eval, so
 * the user's own OpenCode config, plugins, sessions and `~/.claude` files
 * stay out, and an environment built from an allowlist: the Ollama Cloud key
 * and the locale. It doesn't judge the result; run.ts does.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { ASK_USER } from "../src/cli/src/claude-code/protocol.ts";
import type { AgentRun, Driver } from "./agent.ts";
import { type AgentSummary, isRecord, numberOrZero, objectsOf } from "./evidence.ts";

/** 15 minutes per agent run, as for Claude Code. */
const AGENT_TIMEOUT_MS = 900_000;
/** How long `opencode serve` may take to print its URL. */
const START_TIMEOUT_MS = 60_000;
/** Idle this long after a turn means no Stop gate message is coming. */
const SETTLE_MS = 20_000;
const POLL_MS = 2000;
const MS_PER_S = 1000;
/** System directories only: `python3` and `git` are all the agent's shell needs. */
const SYSTEM_PATH = "/usr/local/bin:/usr/bin:/bin";
/** Variables passed through when set: locale, temp dir, and the Ollama Cloud key. */
const PASSED = ["LANG", "LC_ALL", "TMPDIR", "OLLAMA_API_KEY"];
/**
 * OpenCode's defaults, except what would wait for an answer nobody gives
 * headless (a file outside the project, a repeated call, the question tool,
 * which waits for the user's pick until the run times out) and web access.
 */
const CONFIG = {
  autoupdate: false,
  share: "disabled",
  permission: {
    external_directory: "deny",
    doom_loop: "deny",
    question: "deny",
    webfetch: "deny",
  },
};
/** The URL `opencode serve` prints once it listens. */
const SERVER_URL = /http:\/\/127\.0\.0\.1:\d+/u;
/** A tool call refused by one of OpenCode's permission rules. */
const PERMISSION_RULE = /prevents you from using this specific tool call|rejected permission/u;
/** A tool call the Inwards plugin refused itself (its own files, a patch, a `workdir`). */
const PLUGIN_REFUSAL = /Inwards(?::| couldn't check)/u;

/**
 * Builds OpenCode's environment from the allowlist: a private home, the
 * run log switch, a fixed shell, no bytecode files, and switches that keep Claude Code's files,
 * external skills, updates and LSP downloads out.
 *
 * @param home - The private home directory.
 * @returns The environment for `opencode`.
 */
function opencodeEnv(home: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of PASSED) {
    const value = process.env[name];
    if (value !== undefined) {
      env[name] = value;
    }
  }
  return {
    ...env,
    HOME: home,
    PATH: SYSTEM_PATH,
    SHELL: "/bin/bash",
    INWARDS_RUN_LOG: "1",
    // Keeps __pycache__ out of the diff when the agent runs its code.
    PYTHONDONTWRITEBYTECODE: "1",
    OPENCODE_CONFIG_CONTENT: JSON.stringify(CONFIG),
    OPENCODE_DISABLE_AUTOUPDATE: "1",
    OPENCODE_DISABLE_CLAUDE_CODE: "1",
    OPENCODE_DISABLE_EXTERNAL_SKILLS: "1",
    OPENCODE_DISABLE_LSP_DOWNLOAD: "1",
  };
}

/**
 * Starts `opencode serve` on a free port in the project and reads its URL from stdout.
 *
 * @param opencode - The `opencode` executable.
 * @param work - The scratch project root.
 * @param env - OpenCode's environment.
 * @returns The server process and its base URL.
 * @throws {Error} when no URL appears within START_TIMEOUT_MS.
 */
async function startServer(
  opencode: string,
  work: string,
  env: Record<string, string>,
): Promise<{ server: Bun.Subprocess<"ignore", "pipe", "ignore">; url: string }> {
  const server = Bun.spawn([opencode, "serve", "--port", "0", "--hostname", "127.0.0.1"], {
    cwd: work,
    env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "ignore",
  });
  const reader = server.stdout.getReader();
  const decoder = new TextDecoder();
  const deadline = Date.now() + START_TIMEOUT_MS;
  let text = "";
  while (Date.now() < deadline) {
    // biome-ignore lint/performance/noAwaitInLoops: reads the stream chunk by chunk until the URL shows.
    const next = await Promise.race([reader.read(), Bun.sleep(deadline - Date.now())]);
    if (next === undefined || next.done) {
      break;
    }
    text += decoder.decode(next.value);
    const url = SERVER_URL.exec(text)?.[0];
    if (url !== undefined) {
      reader.releaseLock();
      return { server, url };
    }
  }
  server.kill();
  throw new Error(`opencode serve printed no URL within ${START_TIMEOUT_MS / MS_PER_S} s`);
}

/**
 * Calls OpenCode's HTTP API.
 *
 * @param url - The server's base URL.
 * @param path - The endpoint.
 * @param body - A JSON body to POST; GET without one.
 * @returns The parsed JSON reply, or null for an empty one.
 * @throws {Error} when the server answers with an error status.
 */
async function api(url: string, path: string, body?: unknown): Promise<unknown> {
  const response = await fetch(`${url}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`OpenCode ${path} answered ${response.status}: ${text}`);
  }
  return text === "" ? null : JSON.parse(text);
}

/**
 * Waits until the session has been idle for SETTLE_MS, which covers the
 * Stop gate: when it blocks, the plugin starts the next turn well within that.
 *
 * @param url - The server's base URL.
 * @param id - The session id.
 * @returns True when the session settled, false when AGENT_TIMEOUT_MS ran out first.
 */
async function settle(url: string, id: string): Promise<boolean> {
  const deadline = Date.now() + AGENT_TIMEOUT_MS;
  let idleSince = Date.now();
  while (Date.now() < deadline) {
    // biome-ignore lint/performance/noAwaitInLoops: polling; each status read waits for the last.
    await Bun.sleep(POLL_MS);
    const status = await api(url, "/session/status");
    const entry = isRecord(status) ? status[id] : undefined;
    const busy = isRecord(entry) && entry["type"] !== "idle";
    if (busy) {
      idleSince = Date.now();
    } else if (Date.now() - idleSince >= SETTLE_MS) {
      return true;
    }
  }
  return false;
}

/**
 * Runs one task in a fresh session on a fresh server in the project, and
 * returns the session's messages as the transcript.
 *
 * @param opencode - The `opencode` executable.
 * @param env - OpenCode's environment.
 * @param run - The task, the `provider/model` and the scratch project root.
 * @param run.task - the fixture's prompt.
 * @param run.model - `provider/model`, as `opencode run -m` takes it.
 * @param run.work - the scratch project root.
 * @returns Exit code 0, or null when the run timed out; the transcript; the wall time.
 * @throws {Error} when the model isn't `provider/model` or the server fails.
 */
async function runOpencode(
  opencode: string,
  env: Record<string, string>,
  run: { task: string; model: string; work: string },
): Promise<AgentRun> {
  const slash = run.model.indexOf("/");
  if (slash <= 0) {
    throw new Error(`--model must be provider/model for OpenCode, got ${run.model}`);
  }
  const model = { providerID: run.model.slice(0, slash), modelID: run.model.slice(slash + 1) };
  const started = performance.now();
  const { server, url } = await startServer(opencode, run.work, env);
  try {
    const session = await api(url, "/session", {});
    const id = isRecord(session) && typeof session["id"] === "string" ? session["id"] : "";
    await api(url, `/session/${id}/prompt_async`, {
      model,
      parts: [{ type: "text", text: run.task }],
    });
    const settled = await settle(url, id);
    if (!settled) {
      await api(url, `/session/${id}/abort`, {});
    }
    const messages = await api(url, `/session/${id}/message`);
    const lines = Array.isArray(messages) ? messages.map((m) => JSON.stringify(m)) : [];
    return {
      exitCode: settled ? 0 : null,
      stream: lines.join("\n"),
      durationS: (performance.now() - started) / MS_PER_S,
    };
  } finally {
    server.kill();
    await server.exited;
  }
}

/**
 * Reads the `info` of one message: its role, cost and error.
 *
 * @param message - One `{info, parts}` message.
 * @returns Its info, or an empty object.
 */
function info(message: Record<string, unknown>): Record<string, unknown> {
  const i = message["info"];
  return isRecord(i) ? i : {};
}

/**
 * Reads the error text of a failed tool call.
 *
 * @param part - One message part.
 * @returns The error when the part is a tool call that ended in error, else "".
 */
function toolError(part: unknown): string {
  const state = isRecord(part) && part["type"] === "tool" ? part["state"] : undefined;
  const failed = isRecord(state) && state["status"] === "error";
  return failed && typeof state["error"] === "string" ? state["error"] : "";
}

/**
 * Lists the parts of one message.
 *
 * @param message - One `{info, parts}` message.
 * @returns Its parts, or none.
 */
function partsOf(message: Record<string, unknown>): unknown[] {
  const parts = message["parts"];
  return Array.isArray(parts) ? parts : [];
}

/**
 * Reads the text the model wrote in one message, leaving out text OpenCode added.
 *
 * @param message - One `{info, parts}` message.
 * @returns The text parts joined, or "".
 */
function textOf(message: Record<string, unknown>): string {
  return partsOf(message)
    .filter((p) => isRecord(p) && p["type"] === "text" && p["synthetic"] !== true)
    .map((p) => (isRecord(p) && typeof p["text"] === "string" ? p["text"] : ""))
    .join("\n")
    .trim();
}

/**
 * Picks the message a report quotes: the model's last text, with the error
 * that ended the run in front of it, such as a provider's usage limit.
 *
 * @param assistant - The assistant messages, oldest first.
 * @param error - The last message's `info.error`, if any.
 * @returns The last text, prefixed with `<name>: <message>` when the run ended in an error.
 */
function finalOf(assistant: Record<string, unknown>[], error: unknown): string {
  const text = assistant.map(textOf).findLast(Boolean) ?? "";
  if (!isRecord(error)) {
    return text;
  }
  const data = error["data"];
  const message = isRecord(data) && typeof data["message"] === "string" ? data["message"] : "";
  return [`${String(error["name"])}: ${message}`, text].filter(Boolean).join("\n\n");
}

/**
 * Reads what an OpenCode session recorded: one `{info, parts}` message per
 * line, as `GET /session/:id/message` returns them.
 *
 * Turns are assistant messages (one per model step). Cost is what OpenCode
 * computes from its model prices, not what a subscription bills. The run
 * failed when no assistant message exists or the last one carries an error.
 *
 * @param transcript - The messages, one JSON object per line.
 * @returns Turns, cost, error flag, final message and refusals.
 */
export function summariseOpencode(transcript: string): AgentSummary {
  const messages = objectsOf(transcript);
  const assistant = messages.filter((m) => info(m)["role"] === "assistant");
  const last = assistant.at(-1);
  const errors = messages.flatMap(partsOf).map(toolError).filter(Boolean);
  const guard = errors.filter((e) => e.includes(ASK_USER));
  const plugin = errors.filter((e) => !e.includes(ASK_USER) && PLUGIN_REFUSAL.test(e));
  return {
    turns: assistant.length,
    costUsd: assistant.reduce((sum, m) => sum + numberOrZero(info(m)["cost"]), 0),
    isError: last === undefined || info(last)["error"] !== undefined,
    finalMessage: last === undefined ? "" : finalOf(assistant, info(last)["error"]),
    permissionDenials:
      guard.length + plugin.length + errors.filter((e) => PERMISSION_RULE.test(e)).length,
    guardDenials: guard.length,
    denyRuleDenials: plugin.length,
  };
}

/**
 * The OpenCode driver: a server and a session per task, messages as the transcript.
 *
 * @returns The driver; `dispose` removes the private home.
 * @throws {Error} when `opencode` isn't on PATH or can't start with the eval's environment.
 */
export function opencodeDriver(): Driver {
  const opencode = Bun.which("opencode");
  if (opencode === null) {
    throw new Error("opencode is not on PATH; install OpenCode first");
  }
  const home = mkdtempSync(join(tmpdir(), "inwards-eval-opencode-"));
  const env = opencodeEnv(home);
  const p = Bun.spawnSync([opencode, "--version"], { env, stdout: "pipe" });
  if (p.exitCode !== 0) {
    rmSync(home, { recursive: true, force: true });
    throw new Error(`${opencode} --version exited ${p.exitCode} with the eval's environment`);
  }
  return {
    name: "opencode",
    version: `OpenCode ${p.stdout.toString().trim()}`,
    effort: "default",
    run: (task: string, model: string, work: string): Promise<AgentRun> =>
      runOpencode(opencode, env, { task, model, work }),
    summarise: summariseOpencode,
    dispose: (): void => rmSync(home, { recursive: true, force: true }),
  };
}
