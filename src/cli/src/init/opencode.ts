/**
 * @file `inwards init --agent opencode`: writes the project plugin
 * `.opencode/plugins/inwards.js` (ADR-033). The plugin doesn't reimplement
 * anything: it turns OpenCode's plugin events into the hook payloads Inwards
 * already handles and runs `inwards hook claude-code`, so the rules, the
 * session record, the config guard and the Stop gate stay one
 * implementation. The file holds this machine's path to Inwards, so it goes
 * into `.gitignore` like Claude Code's `settings.local.json`.
 */
import { VERSION } from "@inwards/core";
import { PLUGIN_MARKER } from "../claude-code/hook-host.ts";
import type { Change, InitContext } from "./contracts.ts";

/** How to start Inwards with no shell: an executable and its leading arguments. */
interface Exec {
  command: string;
  args: string[];
}

/**
 * Computes the plugin file init writes.
 *
 * @param ctx - reads the current file.
 * @param path - `.opencode/plugins/inwards.js` in the project.
 * @param exec - how to start Inwards.
 * @returns the change, or an error when a plugin init didn't write is already there.
 */
export function opencodePlugin(ctx: InitContext, path: string, exec: Exec): Change | string {
  let before: string | undefined;
  if (ctx.io.probe.kind(path) === "file") {
    before = ctx.io.read.text(path);
  }
  if (before !== undefined && !before.startsWith(PLUGIN_MARKER)) {
    return `${path} exists and wasn't written by inwards init; move it away or merge by hand.`;
  }
  return { path, before, after: pluginSource([exec.command, ...exec.args]) };
}

/**
 * Writes the plugin's source.
 *
 * @param command - the executable and leading arguments that start Inwards.
 * @returns the JavaScript module OpenCode loads.
 */
function pluginSource(command: readonly string[]): string {
  return `${PLUGIN_MARKER} (written by inwards init ${VERSION}; run it again to update this file)
// Runs \`inwards hook claude-code\` on OpenCode's plugin events, so the config
// guard, the per-edit check and the Stop gate work as they do in Claude Code.
// It holds this machine's path to Inwards and is in .gitignore.
import { isAbsolute, join } from "node:path";

const INWARDS = ${JSON.stringify(command)};
/** OpenCode tools the hooks see, under the Claude Code names the hook knows. */
const TOOLS = { edit: "Edit", write: "Write", bash: "Bash" };
/** Files a patch may not touch without the guard: the plugin itself and Inwards' own, either separator, any case. */
const PROTECTED = /(^|[\\\\/])(\\.opencode[\\\\/]|opencode\\.jsonc?$|\\.inwards[\\\\/]|inwards-baseline\\.json$)/iu;
const PATCH_FILE = /^\\*\\*\\* (?:Add|Update|Delete) File: (.+)$|^\\*\\*\\* Move to: (.+)$/gmu;
/** Heads the Stop gate's reasons, which reach the agent as a new message, not as the user's words. */
const STOP_PREFACE =
  "Inwards Stop gate (sent by the Inwards plugin, not the user): the turn can't end yet. Fix what follows, then finish your turn.\\n\\n";

/**
 * Runs the hook with one payload.
 *
 * @param directory - the project, which is also the hook's working directory.
 * @param payload - a hook payload, as Claude Code would send it.
 * @returns the exit code and both output streams.
 */
async function hook(directory, payload) {
  try {
    const proc = Bun.spawn([...INWARDS, "hook", "claude-code"], {
      cwd: directory,
      stdin: new TextEncoder().encode(JSON.stringify({ cwd: directory, ...payload })),
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, CLAUDE_PROJECT_DIR: directory, INWARDS_HOOK_HOST: "opencode" },
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { code, stdout, stderr };
  } catch (err) {
    // Inwards missing or broken: tell the agent, never break OpenCode.
    return { code: 1, stdout: "", stderr: \`inwards: \${String(err)}\` };
  }
}

/**
 * Reads the reason out of a PreToolUse deny, if the hook denied.
 *
 * @param stdout - the hook's output.
 * @returns the reason, or undefined when the call may go ahead.
 */
function denial(stdout) {
  try {
    const out = JSON.parse(stdout);
    const decision = out?.hookSpecificOutput;
    return decision?.permissionDecision === "deny" ? decision.permissionDecisionReason : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Maps an OpenCode tool's arguments to what the Claude Code tool of the same kind takes.
 *
 * @param tool - the OpenCode tool.
 * @param args - its arguments.
 * @param directory - the project, for relative paths.
 * @returns the tool input the hook reads.
 */
function toolInput(tool, args, directory) {
  const file = (p) => (typeof p === "string" && !isAbsolute(p) ? join(directory, p) : p);
  if (tool === "edit") {
    return {
      file_path: file(args.filePath),
      old_string: args.oldString,
      new_string: args.newString,
      replace_all: args.replaceAll === true,
    };
  }
  if (tool === "write") {
    return { file_path: file(args.filePath), content: args.content };
  }
  return { command: args.command };
}

/**
 * Lists the files an apply_patch call touches.
 *
 * @param text - the patch.
 * @param directory - the project.
 * @returns absolute paths.
 */
function patchedFiles(text, directory) {
  const files = [];
  for (const match of String(text ?? "").matchAll(PATCH_FILE)) {
    const path = (match[1] ?? match[2]).trim();
    files.push(isAbsolute(path) ? path : join(directory, path));
  }
  return files;
}

export const Inwards = async ({ client, directory }) => {
  /** Sessions the Stop gate sent back to work, and messages the plugin sent itself. */
  const continued = new Set();
  const sent = new Set();
  /**
   * A subagent's session, by the top-level session it works for. Claude Code
   * gives a subagent its parent's session id, and the Stop gate runs for the
   * top-level session only, over everything the subagents changed as well.
   */
  const parents = new Map();
  const root = (id) => parents.get(id) ?? id;
  return {
    event: async ({ event }) => {
      if (event.type === "session.created") {
        const { id, parentID } = event.properties.info;
        if (parentID) {
          parents.set(id, root(parentID));
          return;
        }
        await hook(directory, { session_id: id, hook_event_name: "SessionStart", source: "startup" });
      } else if (event.type === "session.idle") {
        const id = event.properties.sessionID;
        if (parents.has(id)) {
          return;
        }
        const result = await hook(directory, {
          session_id: id,
          hook_event_name: "Stop",
          stop_hook_active: continued.has(id),
        });
        if (result.code === 2) {
          // OpenCode can't refuse a stop: the gate's message starts the next turn instead.
          continued.add(id);
          sent.add(id);
          await client.session.promptAsync({
            path: { id },
            body: { parts: [{ type: "text", text: STOP_PREFACE + result.stderr }] },
          });
        } else {
          continued.delete(id);
        }
      }
    },
    "chat.message": async (input) => {
      // A message the user sends starts a new turn; the one the plugin sent continues the old.
      if (sent.has(input.sessionID)) {
        sent.delete(input.sessionID);
      } else {
        continued.delete(input.sessionID);
      }
    },
    "tool.execute.before": async (input, output) => {
      if (input.tool === "apply_patch") {
        const touched = patchedFiles(output.args?.patchText, directory);
        const guarded = touched.filter((p) => PROTECTED.test(p) || p.toLowerCase().endsWith("pyproject.toml"));
        if (guarded.length > 0) {
          throw new Error(
            \`Inwards: apply_patch may not change \${guarded.join(", ")}; use the edit tool, which the config guard checks, or ask the user.\`,
          );
        }
        return;
      }
      const name = TOOLS[input.tool];
      if (name === undefined) {
        return;
      }
      const tool_input = toolInput(input.tool, output.args ?? {}, directory);
      if (name !== "Bash" && PROTECTED.test(tool_input.file_path ?? "")) {
        throw new Error(\`Inwards: \${tool_input.file_path} is Inwards' own; ask the user to change it.\`);
      }
      const result = await hook(directory, {
        session_id: root(input.sessionID),
        hook_event_name: "PreToolUse",
        tool_name: name,
        tool_input,
      });
      const reason = denial(result.stdout);
      if (reason !== undefined) {
        throw new Error(reason);
      }
    },
    "tool.execute.after": async (input, output) => {
      const files =
        input.tool === "apply_patch"
          ? patchedFiles(input.args?.patchText, directory)
          : input.tool === "edit" || input.tool === "write"
            ? [toolInput(input.tool, input.args ?? {}, directory).file_path]
            : [];
      for (const file_path of files) {
        const result = await hook(directory, {
          session_id: root(input.sessionID),
          hook_event_name: "PostToolUse",
          tool_name: input.tool === "write" ? "Write" : "Edit",
          tool_input: { file_path },
          tool_response: {},
        });
        if (result.code === 2) {
          output.output = \`\${output.output ?? ""}\\n\\n\${result.stderr}\`;
        }
      }
    },
  };
};
`;
}
