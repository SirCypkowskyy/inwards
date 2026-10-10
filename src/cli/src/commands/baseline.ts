/**
 * @file `inwards baseline`: accepts the violations a project already has, so only
 * new ones fail. It checks the whole project without the baseline and writes
 * every error to `inwards-baseline.json` next to the config, replacing the
 * old one (see `project/baseline.ts` for what the file holds).
 */
import { parseConfig } from "@inwards/core";
import { print } from "../platform/print.ts";
import { BASELINE_FILE, writeBaseline } from "../project/baseline.ts";
import { diskCacheWanted } from "../project/check.ts";
import { commandConfig } from "../project/config-discovery.ts";
import { threadLimit } from "../project/threads.ts";
import type { AppDeps } from "./deps.ts";

/**
 * Runs `inwards baseline`. Later checks, hooks and the Stop gate then fail
 * only on new violations.
 *
 * @param deps - the platform, the check runner and the baseline writer.
 * @param config - the `--config` path, if given.
 * @param noCache - `--no-cache`: parse every file, without `.inwards/cache`.
 * @returns 0 once written, 2 without a config.
 * @throws {ConfigError} when the config is invalid or the baseline can't be written.
 */
export async function baselineCommand(
  deps: AppDeps,
  config: string | undefined,
  noCache = false,
): Promise<number> {
  const { io } = deps;
  const found = commandConfig(io, config);
  if ("problem" in found) {
    return print(io.streams, found.problem, 2);
  }
  const configPath = found.path;
  const report = await deps.check(configPath, undefined, io.runtime.cwd, {
    baseline: false,
    cache: diskCacheWanted(io.runtime, noCache),
    threads: threadLimit(io.runtime),
  });
  // The check has parsed the config already, so this can't throw.
  const { rules } = parseConfig(io.read.text(configPath));
  const accepted = writeBaseline(
    { ...io, baselines: deps.baselines },
    configPath,
    report.diagnostics,
    rules,
  );
  return print(
    io.streams,
    `Wrote ${BASELINE_FILE} with ${accepted} violation${accepted === 1 ? "" : "s"}. Commit it; new violations still fail.`,
    0,
  );
}
