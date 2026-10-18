/**
 * @file What the check slice needs from outside, besides the shared platform
 * contracts: the tree-sitter binaries for the engine, the extraction cache on
 * disk, the last full parse kept for an incremental one, worker threads for
 * a large check, a safe way to replace a baseline file, and `CheckRunner`, a
 * check with its I/O already bound. Types only.
 */
import type {
  Diagnostic,
  ExtractionBatch,
  ExtractionCache,
  GrammarBinaries,
  InwardsConfig,
  Report,
  TreeReuse,
} from "@inwards/core";
import type {
  Clock,
  FileReader,
  FileWalker,
  PathProbe,
  Platform,
} from "../shared/platform/contracts.ts";

/** Replacing a committed file in place without writing through a planted symlink. */
export interface BaselineWriter {
  /**
   * Replaces a file's content: a temporary file, then a rename over it.
   *
   * @param path - the file to replace.
   * @param text - its new content.
   * @throws {ConfigError} when the path can't be replaced (e.g. it is a directory).
   */
  replace: (path: string, text: string) => void;
}

/** Worker threads that run the engine's extraction jobs for one check (#61). */
export interface ExtractionPool {
  /** Runs jobs on the workers and the calling thread; a job no thread could run gets no answer. */
  extract: ExtractionBatch;
  /** Stops every worker. Called once, when the check is done or has failed. */
  close: () => void;
}

/** Everything `runCheck` and the index read. */
export interface ProjectIo {
  probe: PathProbe;
  read: FileReader;
  walk: FileWalker;
  clock: Pick<Clock, "elapsed">;
  /**
   * Loads the tree-sitter runtime and Python grammar.
   *
   * @returns the two WASM blobs.
   */
  grammars: () => Promise<GrammarBinaries>;
  /**
   * Opens the extraction cache under a project's `.inwards/cache`, for the
   * runs that ask for it (`inwards check` and `inwards baseline`, never the hooks).
   *
   * @param project - the directory of the pyproject.toml, with symlinks resolved.
   * @param wasm - the grammars the engine loads, which name the cache's namespace.
   * @returns the cache, or undefined when it can't be used safely.
   */
  extractionCache?: (project: string, wasm: GrammarBinaries) => ExtractionCache | undefined;
  /**
   * Starts worker threads for a check of many files (`inwards check` and
   * `inwards baseline`); absent where no worker can be started, such as in
   * the tests that build the I/O themselves.
   *
   * @param wasm - the grammars, which every worker loads.
   * @param size - how many workers to start, besides the calling thread.
   * @returns the pool.
   */
  extractionPool?: (wasm: GrammarBinaries, size: number) => ExtractionPool;
  /**
   * The last full parse, which every check of this invocation (the daemon's
   * whole life) shares, so a file parsed again parses only what changed:
   * the hook checks the edited file as it is now and as it was at session
   * start (#122). Absent: every full parse starts from scratch.
   */
  reuse?: TreeReuse;
  /**
   * Parses TOML, for the uv workspace's pyproject.toml files (INW005's wording, #203).
   *
   * @param text - a pyproject.toml's contents.
   * @returns the document, or undefined when it doesn't parse.
   */
  toml: (text: string) => unknown;
}

/**
 * Runs a check, as `_check.ts`'s `runCheck` does, with its I/O already bound.
 *
 * @param configPath - the pyproject.toml.
 * @param targets - absolute files; undefined for the whole project.
 * @param base - the directory report paths are relative to.
 * @param options - whether the baseline applies, whether it is a per-edit check
 *   (`edit`, the PostToolUse hook), file contents to check instead
 *   of the disk's, whether the extraction cache on disk may be used (never by a
 *   hook), a config to use instead of the one in `configPath`, and the
 *   directories another config checks (`exclude`, uv workspace members), and
 *   top-level names to treat as missing (`absent`, for a session-start check),
 *   and how many threads may parse (`threads`, #61).
 * @returns the report.
 */
export type CheckRunner = (
  configPath: string,
  targets: string[] | undefined,
  base: string,
  options: {
    baseline?: boolean;
    required?: boolean;
    edit?: boolean;
    texts?: ReadonlyMap<string, string>;
    cache?: boolean;
    config?: InwardsConfig | undefined;
    exclude?: readonly string[];
    absent?: readonly string[] | undefined;
    threads?: number;
  },
) => Promise<Report>;

/** What a check run notes in the run log; `RunLog` (`runlog/`) satisfies it, so this slice never imports `runlog/`. */
export interface CheckRunNotes {
  /** Notes the files and violations a check saw, for the run's log line. */
  noteRun: (project: string, files: readonly string[], diagnostics: readonly Diagnostic[]) => void;
  /** Notes what inline suppressions did in the run. */
  noteSuppressions: (report: Pick<Report, "suppressed">, rejected: readonly Diagnostic[]) => void;
  /** Appends one `check` run to the log, if it is on. */
  logRun: (
    project: string,
    run: { event: string; exit: number; force?: boolean; durationMs?: number },
  ) => void;
}

/** What `inwards check` and `inwards baseline` are given; `AppDeps` satisfies it. */
export interface CheckDeps {
  /** Everything outside the process. */
  io: Platform;
  /** Runs a check with `io` bound. */
  check: CheckRunner;
  /** This invocation's run log, when the command notes its runs. */
  runlog?: CheckRunNotes | undefined;
  /** Replaces `inwards-baseline.json`. */
  baselines: BaselineWriter;
  /**
   * Parses TOML, for finding a uv workspace's members (#57).
   *
   * @param text - a pyproject.toml's contents.
   * @returns the document, or undefined when it doesn't parse.
   */
  toml: (text: string) => unknown;
}
