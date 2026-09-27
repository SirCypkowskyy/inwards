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
import { PLUGIN_HELPERS } from "./opencode-helpers.ts";
import { PLUGIN_HOOKS } from "./opencode-hooks.ts";

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
 * @returns the change, or an error when something init didn't write is already there.
 */
export function opencodePlugin(ctx: InitContext, path: string, exec: Exec): Change | string {
  const link = ctx.io.probe.isLink(path);
  if (link === true || (link === false && ctx.io.probe.kind(path) !== "file")) {
    return `${path} exists and isn't a regular file; move it away and run init again.`;
  }
  const before = link === false ? ctx.io.read.text(path) : undefined;
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
import { createHash } from "node:crypto";
import { readFileSync, readlinkSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const INWARDS = ${JSON.stringify(command)};
${PLUGIN_HELPERS}
${PLUGIN_HOOKS}`;
}
