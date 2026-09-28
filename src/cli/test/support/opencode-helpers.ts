/**
 * @file Loading the OpenCode plugin `inwards init --agent opencode` wrote, as
 * OpenCode loads it, with a stand-in client that records what the plugin
 * sends and answers session lookups from a table of parents. Also the
 * shortcuts the plugin tests use to fire OpenCode events at it.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { inwards, LAYERS, project } from "./run.ts";

export const PLUGIN = ".opencode/plugins/inwards.js";
/** How every Stop gate message the plugin sends begins. */
export const STOP = "Inwards Stop gate (sent by the Inwards plugin, not the user)";
/** An outward import from the domain layer: INW001. */
export const LEAK = "import shop.infrastructure.db\n";

/** A message the plugin sent through the stand-in client. */
export interface Sent {
  id: string;
  text: string;
  noReply: boolean;
  agent: string | undefined;
  model: { providerID: string; modelID: string } | undefined;
  variant: string | undefined;
}

/** The agent, model and variant a user picks for a message. */
export interface Picked {
  agent?: string;
  model?: { providerID: string; modelID: string };
  variant?: string;
}

/** The hooks the plugin returns, as the tests call them. */
export interface Hooks {
  event: (input: { event: { type: string; properties: unknown } }) => Promise<void>;
  "chat.message": (
    input: {
      sessionID: string;
      agent?: string;
      model?: { providerID: string; modelID: string };
      variant?: string;
    },
    output: { parts: { type: string; text: string }[] },
  ) => Promise<void>;
  "tool.execute.before": (
    input: { tool: string; sessionID: string },
    output: { args: Record<string, unknown> },
  ) => Promise<void>;
  "tool.execute.after": (
    input: { tool: string; sessionID: string; args: Record<string, unknown> },
    output: { output: string },
  ) => Promise<void>;
}

/** The plugin, what it sent, and the parents the stand-in client reports. */
export interface Loaded {
  hooks: Hooks;
  sent: Sent[];
  parents: Map<string, string>;
}

/** The body of a prompt the plugin sends. */
interface PromptBody {
  noReply?: boolean;
  agent?: string;
  model?: { providerID: string; modelID: string };
  variant?: string;
  parts: { text: string }[];
}

/** How the stand-in client misbehaves: its first few requests fail as the SDK reports failures. */
export interface Failures {
  /** Session lookups that fail before one succeeds. */
  get?: number;
  /** Prompts that fail before one succeeds. */
  prompt?: number;
  /** Which prompts fail, counting every prompt from 0. */
  promptAt?: readonly number[];
  /** Which prompts throw, as a dropped connection does, counting every prompt from 0. */
  throwAt?: readonly number[];
  /** Runs while a prompt request is in flight, before it answers: OpenCode may take the message then. */
  during?: (call: number, text: string) => Promise<void>;
}

/**
 * Makes a project with the layers and an empty domain module, and runs
 * `inwards init --agent opencode` in it.
 *
 * @returns the project directory.
 * @throws {Error} when init fails.
 */
export function initProject(): string {
  const root = project({ "pyproject.toml": LAYERS, "shop/domain/order.py": "X = 1\n" });
  const result = inwards(["init", "--agent", "opencode"], { cwd: root });
  if (result.code !== 0) {
    throw new Error(`init failed: ${result.stderr}`);
  }
  return root;
}

/**
 * Loads the plugin init wrote, as OpenCode would.
 *
 * @param root - the project directory.
 * @param directory - where OpenCode runs; the project by default.
 * @param failures - requests of the stand-in client that fail first.
 * @returns the plugin's hooks, the messages sent so far, and the parent table.
 * @throws {Error} when the file exports no plugin.
 */
export async function load(
  root: string,
  directory: string = root,
  failures: Failures = {},
): Promise<Loaded> {
  const sent: Sent[] = [];
  const parents = new Map<string, string>();
  const failing = { get: failures.get ?? 0, prompt: failures.prompt ?? 0, calls: 0 };
  const client = {
    session: {
      promptAsync: async ({
        path,
        body,
      }: {
        path: { id: string };
        body: PromptBody;
      }): Promise<{ error?: string }> => {
        const call = failing.calls;
        failing.calls += 1;
        await failures.during?.(call, body.parts.map((p) => p.text).join(""));
        if (failures.throwAt?.includes(call)) {
          throw new Error("socket hang up");
        }
        if (failing.prompt > 0 || failures.promptAt?.includes(call)) {
          failing.prompt = Math.max(0, failing.prompt - 1);
          return Promise.resolve({ error: "HTTP 500" });
        }
        const text = body.parts.map((p) => p.text).join("");
        const { agent, model, variant } = body;
        sent.push({ id: path.id, text, noReply: body.noReply === true, agent, model, variant });
        return Promise.resolve({});
      },
      get: ({
        path,
      }: {
        path: { id: string };
      }): Promise<{ data?: { parentID: string | undefined }; error?: string }> => {
        if (failing.get > 0) {
          failing.get -= 1;
          return Promise.resolve({ error: "HTTP 500" });
        }
        return Promise.resolve({ data: { parentID: parents.get(path.id) } });
      },
    },
  };
  // A query string loads a fresh copy, as a restarted OpenCode would.
  const url = `${pathToFileURL(join(root, PLUGIN)).href}?${Math.random()}`;
  const mod: Record<string, (ctx: unknown) => Promise<Hooks>> = await import(url);
  const plugin = mod["Inwards"];
  if (plugin === undefined) {
    throw new Error(`${PLUGIN} exports no Inwards plugin`);
  }
  return { hooks: await plugin({ client, directory }), sent, parents };
}

/**
 * Fires an OpenCode session event.
 *
 * @param hooks - the plugin's hooks.
 * @param type - `session.created` or `session.idle`.
 * @param id - the session.
 * @param parentID - the parent, for a subagent's `session.created`.
 */
export async function fire(
  hooks: Hooks,
  type: "session.created" | "session.idle",
  id: string,
  parentID?: string,
): Promise<void> {
  const properties =
    type === "session.created"
      ? { info: { id, ...(parentID ? { parentID } : {}) } }
      : { sessionID: id };
  await hooks.event({ event: { type, properties } });
}

/**
 * Sends a message into a session as the user would.
 *
 * @param hooks - the plugin's hooks.
 * @param id - the session.
 * @param text - the message.
 * @param picked - the agent, model and variant the user picked.
 */
export async function say(
  hooks: Hooks,
  id: string,
  text: string,
  picked: Picked = {},
): Promise<void> {
  await hooks["chat.message"]({ sessionID: id, ...picked }, { parts: [{ type: "text", text }] });
}

/** The line of the plugin that names the Inwards command. */
export const INWARDS_LINE: RegExp = /^const INWARDS = .*$/mu;

/**
 * Makes every hook run of the plugin answer late: Inwards runs, then the
 * run waits before it exits, so a test can act after the hook has read the
 * project and before the plugin gets its answer.
 *
 * @param root - the project directory.
 * @param seconds - how long each run waits after Inwards is done.
 */
export function slowHook(root: string, seconds: number): void {
  const path = join(root, PLUGIN);
  const text = readFileSync(path, "utf8");
  const command: unknown = JSON.parse(
    INWARDS_LINE.exec(text)?.[0].slice("const INWARDS = ".length, -1) ?? "[]",
  );
  const slow = [
    "sh",
    "-c",
    `"$0" "$@"; code=$?; sleep ${seconds}; exit $code`,
    ...(Array.isArray(command) ? command : []),
  ];
  writeFileSync(path, text.replace(INWARDS_LINE, `const INWARDS = ${JSON.stringify(slow)};`));
}

/**
 * Waits a while.
 *
 * @param ms - how long.
 * @returns after that long.
 */
export function pause(ms: number): Promise<void> {
  return new Promise((done) => {
    setTimeout(done, ms);
  });
}

/**
 * Asks the plugin whether a tool call may run.
 *
 * @param hooks - the plugin's hooks.
 * @param tool - the OpenCode tool.
 * @param args - its arguments.
 * @returns the refusal's message, or "" when the call may run.
 */
export async function refusal(
  hooks: Hooks,
  tool: string,
  args: Record<string, unknown>,
): Promise<string> {
  try {
    await hooks["tool.execute.before"]({ tool, sessionID: "ses_guard" }, { args });
    return "";
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}
