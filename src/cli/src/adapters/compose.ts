/**
 * @file Wires the real adapters into one invocation's `AppDeps`: the production
 * composition. `main.ts` calls it once per process; a test calls it to get
 * the real filesystem, git and streams, or to run two independent
 * invocations in one process. This is the only place the adapters meet. It
 * also builds each request the daemon serves (`nodeDaemon`): the same
 * adapters, with the request's runtime, buffered streams and the daemon's
 * in-memory caches; and the language server's connection and warm check
 * (`nodeLsp`), whose stdout belongs to the protocol.
 */
import { resolve } from "node:path";
import type { ExtractionCache, GrammarBinaries, Report } from "@inwards/core";
import type { AppDeps, DaemonDeps, LspDeps } from "../commands/deps.ts";
import { commitKeyedGit, daemonExtractionCache } from "../daemon/memory.ts";
import type { HookRequest } from "../daemon/protocol.ts";
import type { ServerCheck } from "../lsp/checks.ts";
import type { Clock, Platform, Streams } from "../platform/contracts.ts";
import { runCheck } from "../project/check.ts";
import type { ExtractionPool, ProjectIo } from "../project/contracts.ts";
import { createRunLog } from "../runlog/record.ts";
import type { CheckRunner } from "../session/contracts.ts";
import { nodeBaselineWriter } from "./baseline-files.ts";
import { nodeDaemonHost } from "./daemon-host.ts";
import { nodeDaemonLink } from "./daemon-link.ts";
import { nodeExportFiles } from "./export-files.ts";
import { fileExtractionCache } from "./extraction-cache.ts";
import { startExtractionPool } from "./extraction-pool.ts";
import { nodeFileWalker } from "./file-walk.ts";
import { nodeFileReader, nodePathProbe } from "./filesystem.ts";
import { budgetedGit, nodeGit } from "./git.ts";
import { loadGrammars } from "./grammars.ts";
import { nodeInitFiles } from "./init-files.ts";
import { serveLsp } from "./lsp-connection.ts";
import { terminalPicker } from "./picker.ts";
import { readRuntime, runtimeFrom, systemClock } from "./runtime.ts";
import { nodeStateFiles } from "./state-files.ts";
import { processStreams } from "./stdio.ts";
import { parseToml } from "./toml.ts";

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
 * What a check reads on the real process: the platform, the grammars, the
 * extraction cache (used only by the runs that ask for it), TOML parsing,
 * and, given the program a worker thread runs, the extraction pool (#61).
 *
 * @param io - the platform.
 * @param workerEntry - the program worker threads run (`main.ts`'s own URL); none: no pool.
 * @returns the project I/O.
 */
export function nodeProjectIo(io: Platform, workerEntry?: string): ProjectIo {
  const project = {
    ...io,
    grammars: loadGrammars,
    extractionCache: fileExtractionCache,
    toml: parseToml,
  };
  return workerEntry === undefined
    ? project
    : {
        ...project,
        extractionPool: (wasm: GrammarBinaries, size: number): ExtractionPool =>
          startExtractionPool(workerEntry, wasm, size),
      };
}

/**
 * Builds one invocation's dependencies from the real adapters. Called once
 * per process; a test can call it again for an independent invocation.
 *
 * @param workerEntry - the program worker threads run, for a check of many
 *   files (`main.ts` passes its own URL); without it every check runs in one thread.
 * @returns the dependencies, with a fresh run log.
 */
export function compose(workerEntry?: string): AppDeps {
  const io = nodePlatform();
  const project = nodeProjectIo(io, workerEntry);
  const entry = resolve(import.meta.dir, "../main.ts");
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
      entry,
      toml: parseToml,
    },
    toml: parseToml,
    daemon: nodeDaemon(io, entry),
    lsp: nodeLsp(io),
  };
}

/**
 * The language server on the real process: LSP over stdio, and a check that
 * keeps what it extracted from each text in memory for as long as the server
 * runs (the daemon's cache, ADR-039). The check gets no worker pool, so a
 * keystroke never starts a thread, and streams whose stdout writes to stderr,
 * since stdout carries the protocol.
 *
 * @param io - the server's own platform.
 * @returns the language server's dependencies.
 */
function nodeLsp(io: Platform): LspDeps {
  const extractions = daemonExtractionCache();
  const streams: Streams = { ...io.streams, out: io.streams.err };
  const files = {
    ...nodeProjectIo({ ...io, streams }),
    extractionCache: (): ExtractionCache => extractions,
  };
  return {
    serve: serveLsp,
    check: (
      configPath: string,
      targets: string[] | undefined,
      base: string,
      options: Parameters<ServerCheck>[3],
    ): Promise<Report> => runCheck(files, configPath, targets, { ...options, base, cache: true }),
  };
}

/**
 * How long all of one daemon request's git calls may take together: well
 * under the 15 s `inwards daemon stop` waits and the 45 s a hook waits, so a
 * hung git can't hold the daemon's queue (#277). A healthy call takes about
 * 15 ms.
 */
const DAEMON_GIT_BUDGET_MS = 5000;

/**
 * The resident process on the real process: the socket, the files, and each
 * request's dependencies. The extraction cache and the commit-keyed git
 * answers are made here, once per invocation, so they live as long as the
 * daemon and are shared by its requests only. Its git runs under a budget
 * that starts again with every request.
 *
 * @param io - the daemon's own platform.
 * @param entry - the CLI's `main.ts`, for running from source.
 * @returns the daemon's dependencies.
 */
function nodeDaemon(io: Platform, entry: string): DaemonDeps {
  const extractions = daemonExtractionCache();
  const budgeted = budgetedGit(DAEMON_GIT_BUDGET_MS);
  const git = commitKeyedGit(budgeted);
  return {
    link: nodeDaemonLink(entry),
    host: nodeDaemonHost(),
    invocation(request: HookRequest): ReturnType<DaemonDeps["invocation"]> {
      // Requests run one at a time, so the budget is this request's alone.
      budgeted.begin();
      const out: string[] = [];
      const err: string[] = [];
      const streams: Streams = {
        out(text: string): void {
          out.push(text);
        },
        err(text: string): void {
          err.push(text);
        },
        readIn: (): string => request.stdin,
      };
      const received = systemClock.elapsed();
      const clock: Clock = {
        now: systemClock.now,
        // The hook's own start-up counts, as in a one-shot run.
        elapsed: (): number => request.elapsed + systemClock.elapsed() - received,
      };
      const runtime = runtimeFrom(request.env, {
        cwd: request.cwd,
        stdinIsTTY: false,
        stdoutIsTTY: request.tty,
      });
      const platform: Platform = { ...io, git, clock, runtime, streams };
      const files = {
        ...nodeProjectIo(platform),
        extractionCache: (): ExtractionCache => extractions,
      };
      return {
        deps: {
          io: platform,
          runlog: createRunLog(platform),
          check: (
            configPath: string,
            targets: string[] | undefined,
            base: string,
            options: Parameters<CheckRunner>[3],
          ): Promise<Report> =>
            runCheck(files, configPath, targets, { ...options, base, cache: true }),
        },
        output: (): { stdout: string; stderr: string } => ({
          stdout: out.join(""),
          stderr: err.join(""),
        }),
      };
    },
  };
}
