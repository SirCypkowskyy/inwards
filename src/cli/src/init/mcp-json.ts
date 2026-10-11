/**
 * @file The project's `.mcp.json` as `inwards init --agent claude --shared`
 * writes it: one `inwards` server under `mcpServers` that runs `inwards mcp`,
 * through the launcher when there is one, so every teammate's Claude Code
 * starts the same server. It keeps the other servers and an Inwards entry's
 * own keys (`env`), and refuses an `inwards` server that runs something else.
 * It computes the change only; writing is the caller's.
 */

import { INWARDS_BINARY, LAUNCHER } from "../claude-code/settings.ts";
import { isRecord } from "../json/guards.ts";
import type { Change, InitContext } from "./contracts.ts";
import { readIfThere } from "./section.ts";

const SERVER = "inwards";
const PATH_SEPARATOR = /[\\/]/u;
const EXE_SUFFIX = /\.exe$/iu;

/**
 * Adds or updates the `inwards` server in `.mcp.json`. A rerun with the same
 * launcher leaves the text as it is, whatever its formatting.
 *
 * @param ctx - reads the current file.
 * @param path - the project's `.mcp.json`.
 * @param words - the launcher's words and `inwards`, e.g. `["uv", "run", "inwards"]`.
 * @returns the change, or an error when the file can't be edited safely.
 */
export function mcpJson(ctx: InitContext, path: string, words: readonly string[]): Change | string {
  const before = readIfThere(ctx.io, path);
  let config: unknown;
  try {
    config = before === undefined ? {} : JSON.parse(before);
  } catch {
    return `${path} is not valid JSON; fix it first`;
  }
  if (!isRecord(config)) {
    return `${path} is not a JSON object`;
  }
  const servers = config["mcpServers"] ?? {};
  if (!isRecord(servers)) {
    return `"mcpServers" in ${path} is not an object; fix it first`;
  }
  const existing = servers[SERVER];
  if (existing !== undefined && !isInwardsServer(existing)) {
    return `${path} already has an "${SERVER}" server that doesn't run \`inwards mcp\`; rename or remove it, then run init again`;
  }
  const [command = SERVER, ...rest] = words;
  const wanted = { command, args: [...rest, "mcp"] };
  const entry = isRecord(existing) ? { ...existing, ...wanted } : wanted;
  if (before !== undefined && JSON.stringify(entry) === JSON.stringify(existing)) {
    return { path, before, after: before };
  }
  const after = { ...config, mcpServers: { ...servers, [SERVER]: entry } };
  return { path, before, after: `${JSON.stringify(after, null, 2)}\n` };
}

/**
 * Tells whether an MCP server entry runs Inwards' server: a stdio entry whose
 * command and arguments are an `inwards` binary and `mcp`, with nothing or a
 * launcher init accepts in front (`uv run`).
 *
 * @param entry - one value under `mcpServers`.
 * @returns true for an Inwards server, which init may update.
 */
function isInwardsServer(entry: unknown): boolean {
  if (!isRecord(entry) || typeof entry["command"] !== "string") {
    return false;
  }
  const type = entry["type"];
  const args = entry["args"] ?? [];
  if (!((type === undefined || type === "stdio") && Array.isArray(args))) {
    return false;
  }
  const words: unknown[] = [entry["command"], ...args];
  if (!words.every((w) => typeof w === "string") || words.at(-1) !== "mcp") {
    return false;
  }
  const binary = String(words.at(-2) ?? "")
    .split(PATH_SEPARATOR)
    .at(-1)
    ?.replace(EXE_SUFFIX, "");
  const launcher = words.slice(0, -2).join(" ");
  return (
    binary !== undefined &&
    INWARDS_BINARY.test(binary) &&
    (launcher === "" || LAUNCHER.test(launcher))
  );
}
