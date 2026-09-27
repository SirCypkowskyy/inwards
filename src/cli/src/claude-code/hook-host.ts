/**
 * @file Whether the agent that runs the hook still has Inwards wired in, for
 * the Stop gate's trust checks. Claude Code keeps the hooks in its settings
 * layers (`settings.ts`). OpenCode keeps them in the project plugin
 * `inwards init --agent opencode` writes, which runs this hook with
 * `INWARDS_HOOK_HOST=opencode`; there the plugin file must still be the one
 * init wrote.
 */
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
    read: Pick<FileReader, "text">;
    probe: Pick<PathProbe, "kind">;
    runtime: Pick<Runtime, "hookHost" | "claudeConfigDir" | "home">;
  },
  project: string,
): string | undefined {
  if (io.runtime.hookHost === "opencode") {
    const path = join(project, ".opencode", "plugins", "inwards.js");
    const ours = io.probe.kind(path) === "file" && io.read.text(path).startsWith(PLUGIN_MARKER);
    return ours
      ? undefined
      : "The Inwards OpenCode plugin (.opencode/plugins/inwards.js) is missing or isn't the one `inwards init` wrote. Restore it (`inwards init --agent opencode`) or ask the user.";
  }
  const hooks = settingsProblem(io, project);
  return hooks === undefined
    ? undefined
    : `${hooks} Restore them (\`inwards init --agent claude\`) or ask the user.`;
}
