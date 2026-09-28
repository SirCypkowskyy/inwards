/**
 * @file `inwards context [--config pyproject.toml] [--write]`: prints the
 * architecture brief for `[tool.inwards]` (the layers, the allowed import
 * directions, where ports live), or with `--write` puts it in its marked
 * section of the AGENTS.md next to the config. The brief itself is built in
 * `init/brief.ts`; this module only finds the config and picks the output.
 */
import { briefFor, withBrief } from "../init/brief.ts";
import { print } from "../platform/print.ts";
import { commandConfig } from "../project/config-discovery.ts";
import type { AppDeps } from "./deps.ts";

/**
 * Runs `inwards context`: the brief on stdout, or written into AGENTS.md.
 *
 * @param deps - the platform and init's writer.
 * @param config - `--config`, resolved against the cwd; else the nearest config above it.
 * @param write - `--write`: update the marked section in AGENTS.md instead of printing.
 * @returns 0 once printed or written, 2 without a config or with broken markers in AGENTS.md.
 * @throws {ConfigError} when the config is invalid; when a file can't be read or written.
 */
export function contextCommand(deps: AppDeps, config: string | undefined, write: boolean): number {
  const { io } = deps;
  const configPath = commandConfig(io, config);
  if (!configPath) {
    return print(io.streams, "No pyproject.toml with [tool.inwards] found.", 2);
  }
  const text = io.read.text(configPath);
  if (!write) {
    return print(io.streams, briefFor(io, configPath, text), 0);
  }
  const changes = withBrief(io, [], { path: configPath, text });
  if (typeof changes === "string") {
    return print(io.streams, `inwards context: ${changes}`, 2);
  }
  const edits = changes.filter((change) => change.before !== change.after);
  if (edits.length === 0) {
    return print(io.streams, "inwards context: AGENTS.md is up to date.", 0);
  }
  for (const change of edits) {
    deps.init.files.write(change.path, change.after);
    print(io.streams, `inwards context: updated ${change.path}`, 0);
  }
  return 0;
}
