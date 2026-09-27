/**
 * @file The `.gitignore` entries `inwards init` adds: `.inwards/` (session
 * state, run log) for every agent, and the file that holds this machine's
 * path to Inwards for the agents that have one. Existing entries are kept,
 * and nothing is added twice.
 */
import type { Agent, Change, InitContext } from "./contracts.ts";

const LINE_BREAK = /\r?\n/u;
/** The file holding this machine's path to Inwards, per agent, which must not be committed. */
const LOCAL_FILES: Partial<Record<Agent, string>> = {
  claude: ".claude/settings.local.json",
  opencode: ".opencode/plugins/inwards.js",
};

/**
 * Adds what Inwards writes locally to the project's .gitignore: `.inwards/`
 * (session state, run log) for every agent, and the machine-specific file
 * that holds the hooks: `.claude/settings.local.json` for Claude Code,
 * `.opencode/plugins/inwards.js` for OpenCode.
 *
 * @param ctx - reads the current file.
 * @param path - the project's .gitignore.
 * @param agent - which agent is being wired up.
 * @returns the change (unchanged when every entry is already there).
 */
export function gitignore(ctx: InitContext, path: string, agent: Agent): Change {
  const before = ctx.io.probe.exists(path) ? ctx.io.read.text(path) : undefined;
  const text = before ?? "";
  const lines = new Set(text.split(LINE_BREAK).map((l) => l.trim()));
  const local = LOCAL_FILES[agent];
  const wanted = [
    lines.has(".inwards/") || lines.has(".inwards") ? "" : ".inwards/",
    local === undefined || lines.has(local) ? "" : local,
  ].filter((entry) => entry !== "");
  if (wanted.length === 0) {
    return { path, before, after: text };
  }
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const base = text === "" || text.endsWith("\n") ? text : `${text}${eol}`;
  const added = ["# Inwards: local state and machine-specific hooks", ...wanted].join(eol);
  return { path, before, after: `${base}${added}${eol}` };
}
