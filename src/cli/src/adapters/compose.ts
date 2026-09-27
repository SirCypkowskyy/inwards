/**
 * Wires the real adapters into one invocation's `AppDeps`: the production
 * composition. `main.ts` calls it once per process; a test calls it to get
 * the real filesystem, git and streams, or to run two independent
 * invocations in one process. This is the only place the adapters meet.
 */
import { resolve } from "node:path";
import type { Report } from "@inwards/core";
import type { AppDeps } from "../commands/deps.ts";
import type { Platform } from "../platform/contracts.ts";
import { runCheck } from "../project/check.ts";
import type { ProjectIo } from "../project/contracts.ts";
import { createRunLog } from "../runlog/record.ts";
import type { CheckRunner } from "../session/contracts.ts";
import { nodeBaselineWriter } from "./baseline-files.ts";
import { nodeExportFiles } from "./export-files.ts";
import { nodeFileWalker } from "./file-walk.ts";
import { nodeFileReader, nodePathProbe } from "./filesystem.ts";
import { nodeGit } from "./git.ts";
import { loadGrammars } from "./grammars.ts";
import { nodeInitFiles } from "./init-files.ts";
import { terminalPicker } from "./picker.ts";
import { readRuntime, systemClock } from "./runtime.ts";
import { nodeStateFiles } from "./state-files.ts";
import { processStreams } from "./stdio.ts";

/**
 * The platform on the real process: filesystem, git, clock, environment,
 * streams and state files.
 *
 * @returns a fresh platform, with the environment read now.
 */
export function nodePlatform(): Platform {
  return {
    probe: nodePathProbe,
    read: nodeFileReader,
    walk: nodeFileWalker,
    git: nodeGit,
    clock: systemClock,
    runtime: readRuntime(),
    streams: processStreams,
    state: nodeStateFiles,
  };
}

/**
 * What a check reads on the real process: the platform plus the grammars.
 *
 * @param io - the platform.
 * @returns the project I/O.
 */
export function nodeProjectIo(io: Platform): ProjectIo {
  return { ...io, grammars: loadGrammars };
}

/**
 * Builds one invocation's dependencies from the real adapters. Called once
 * per process; a test can call it again for an independent invocation.
 *
 * @returns the dependencies, with a fresh run log.
 */
export function compose(): AppDeps {
  const io = nodePlatform();
  const project = nodeProjectIo(io);
  return {
    io,
    runlog: createRunLog(io),
    check: (
      configPath: string,
      targets: string[] | undefined,
      base: string,
      options: Parameters<CheckRunner>[3],
    ): Promise<Report> => runCheck(project, configPath, targets, { ...options, base }),
    baselines: nodeBaselineWriter,
    exports: nodeExportFiles,
    init: {
      files: nodeInitFiles,
      picker: terminalPicker,
      entry: resolve(import.meta.dir, "../main.ts"),
    },
  };
}
