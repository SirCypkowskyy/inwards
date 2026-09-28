/**
 * @file Whether the agent that runs the hook still has Inwards wired in, for
 * the Stop gate's trust checks. Claude Code keeps the hooks in its settings
 * layers (`settings.ts`). OpenCode keeps them in the project plugin
 * `inwards init --agent opencode` writes, which runs this hook with
 * `INWARDS_HOOK_HOST=opencode`; there the plugin file must still be the one
 * init wrote, byte for byte the file OpenCode loaded (the plugin passes its
 * hash), so a plugin emptied or rewritten during the session is reported
 * before the next start loads it.
 */
import { createHash } from "node:crypto";
import { join } from "node:path";
import type { FileReader, PathProbe, Runtime } from "../platform/contracts.ts";
import { settingsProblem } from "./settings.ts";

/** The first line of the plugin `init` writes (`init/opencode.ts`), which marks it as ours. */
export const PLUGIN_MARKER = "// inwards: opencode plugin";

/**
 * Says what is wrong with the wiring of the agent that runs the hook.
 *
 * @param io - reads files, probes paths, and knows the host and the user's settings.
 * @param io.read - reads a settings or plugin file.
 * @param io.probe - tells whether the plugin file is there.
 * @param io.runtime - the hook host, `CLAUDE_CONFIG_DIR` and the home directory.
 * @param project - the project root.
 * @returns the problem with how to fix it, or undefined when the wiring is in place.
 */
export function hookProblem(
  io: {
    read: Pick<FileReader, "text" | "bytes">;
    probe: Pick<PathProbe, "kind" | "isLink">;
    runtime: Pick<Runtime, "hookHost" | "pluginSha256" | "claudeConfigDir" | "home">;
  },
  project: string,
): string | undefined {
  if (io.runtime.hookHost === "opencode") {
    return pluginProblem(io, join(project, ".opencode", "plugins", "inwards.js"));
  }
  const hooks = settingsProblem(io, project);
  return hooks === undefined
    ? undefined
    : `${hooks} Restore them (\`inwards init --agent claude\`) or ask the user.`;
}

/**
 * Says what is wrong with the OpenCode plugin file.
 *
 * @param io - reads and probes the file, and knows the hash OpenCode loaded.
 * @param io.read - reads the plugin.
 * @param io.probe - tells whether it is a regular file.
 * @param io.runtime - the hash the plugin passed.
 * @param path - `.opencode/plugins/inwards.js` in the project.
 * @returns the problem with how to fix it, or undefined when the plugin is the one OpenCode loaded.
 */
function pluginProblem(
  io: {
    read: Pick<FileReader, "text" | "bytes">;
    probe: Pick<PathProbe, "kind" | "isLink">;
    runtime: Pick<Runtime, "pluginSha256">;
  },
  path: string,
): string | undefined {
  const fix = "Restore it (`inwards init --agent opencode`) or ask the user.";
  const regular = io.probe.isLink(path) === false && io.probe.kind(path) === "file";
  if (!(regular && io.read.text(path).startsWith(PLUGIN_MARKER))) {
    return `The Inwards OpenCode plugin (.opencode/plugins/inwards.js) is missing or isn't the one \`inwards init\` wrote. ${fix}`;
  }
  const loaded = io.runtime.pluginSha256;
  const now = createHash("sha256").update(io.read.bytes(path)).digest("hex");
  return loaded === undefined || loaded === now
    ? undefined
    : `The Inwards OpenCode plugin (.opencode/plugins/inwards.js) changed since OpenCode loaded it, so the next start may run without Inwards. ${fix}`;
}
