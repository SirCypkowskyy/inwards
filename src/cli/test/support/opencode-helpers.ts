/**
 * @file Loading the OpenCode plugin `inwards init --agent opencode` wrote, as
 * OpenCode loads it, with a stand-in client that records what the plugin
 * sends and answers session lookups from a table of parents. Also the
 * shortcuts the plugin tests use to fire OpenCode events at it.
 */
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { inwards, LAYERS, project } from "./run.ts";

export const PLUGIN = ".opencode/plugins/inwards.js";

/** A message the plugin sent through the stand-in client. */
export interface Sent {
  id: string;
  text: string;
  noReply: boolean;
  agent: string | undefined;
}

/** The hooks the plugin returns, as the tests call them. */
export interface Hooks {
  event: (input: { event: { type: string; properties: unknown } }) => Promise<void>;
  "chat.message": (
    input: { sessionID: string; agent?: string; model?: { providerID: string; modelID: string } },
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
  parts: { text: string }[];
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
 * @returns the plugin's hooks, the messages sent so far, and the parent table.
 * @throws {Error} when the file exports no plugin.
 */
export async function load(root: string, directory: string = root): Promise<Loaded> {
  const sent: Sent[] = [];
  const parents = new Map<string, string>();
  const client = {
    session: {
      promptAsync: ({ path, body }: { path: { id: string }; body: PromptBody }): Promise<void> => {
        const text = body.parts.map((p) => p.text).join("");
        sent.push({ id: path.id, text, noReply: body.noReply === true, agent: body.agent });
        return Promise.resolve();
      },
      get: ({
        path,
      }: {
        path: { id: string };
      }): Promise<{ data: { parentID: string | undefined } }> =>
        Promise.resolve({ data: { parentID: parents.get(path.id) } }),
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
 * @param agent - the agent the user picked.
 */
export async function say(hooks: Hooks, id: string, text: string, agent?: string): Promise<void> {
  await hooks["chat.message"](
    { sessionID: id, ...(agent ? { agent } : {}) },
    { parts: [{ type: "text", text }] },
  );
}
