/**
 * @file The capabilities the CLI needs from outside the process, as small named
 * contracts: looking at paths, reading files, walking a tree, running git,
 * telling the time, the process environment, and the standard streams.
 *
 * Policy code (session, project, runlog, claude-code, init) receives these as
 * parameters and never touches `node:fs`, `node:child_process`, `process` or
 * `Bun` itself; `adapters/` implements them and `main.ts` wires them in. That
 * keeps every decision testable with fakes and every side effect in one place.
 * Types only: no implementation and no I/O.
 */

/** What a path is, following symlinks: a regular file, a directory, or neither/missing. */
export type PathKind = "file" | "dir" | undefined;

/** One directory entry, as a listing reports it. */
export interface DirEntry {
  name: string;
  /** True for a directory (not following a symlink). */
  dir: boolean;
  /** True for a regular file (not following a symlink). */
  file: boolean;
}

/**
 * Read-only observations of the filesystem. Each answers "not there" instead
 * of throwing, so callers never handle filesystem errors for a question.
 */
export interface PathProbe {
  /**
   * Resolves symlinks and `..` in a path.
   *
   * @param path - any path.
   * @returns the canonical path, or undefined when it doesn't exist.
   */
  realpath: (path: string) => string | undefined;
  /**
   * Tells what a path is, following symlinks.
   *
   * @param path - any path.
   * @returns "file", "dir", or undefined when missing or anything else.
   */
  kind: (path: string) => PathKind;
  /**
   * Tells whether a path itself is a symlink (lstat).
   *
   * @param path - any path.
   * @returns true for a symlink, false for anything else, undefined when missing.
   */
  isLink: (path: string) => boolean | undefined;
  /**
   * Reads a symlink's target as stored.
   *
   * @param path - any path.
   * @returns the target, or undefined when the path isn't a symlink.
   */
  readLink: (path: string) => string | undefined;
  /**
   * Tells whether anything exists at a path, following symlinks.
   *
   * @param path - any path.
   * @returns true when the path exists.
   */
  exists: (path: string) => boolean;
}

/** Reading file contents. Unlike `PathProbe`, these throw when the file can't be read. */
export interface FileReader {
  /**
   * Reads a file as UTF-8 text.
   *
   * @param path - the file.
   * @returns its text.
   * @throws when the file is missing or unreadable.
   */
  text: (path: string) => string;
  /**
   * Reads a file's bytes.
   *
   * @param path - the file.
   * @returns its bytes.
   * @throws when the file is missing or unreadable.
   */
  bytes: (path: string) => Uint8Array;
  /**
   * Lists a directory.
   *
   * @param dir - the directory.
   * @returns its entries, or undefined when nothing, or something other than
   *   a directory, is at the path.
   * @throws when the path can't be examined or listed, e.g. EACCES on it or
   *   on an ancestor, as on develop: the callers let that reach the user
   *   rather than read it as empty.
   */
  list: (dir: string) => DirEntry[] | undefined;
}

/** Walking a tree for files, with the CLI's skip and symlink rules (see `adapters/file-walk.ts`). */
export interface FileWalker {
  /**
   * Lists the Python files under each path.
   *
   * @param paths - files or directories.
   * @param open - directories walked without the skip rules (layer packages).
   * @returns unique paths, sorted.
   */
  pythonFiles: (paths: string[], open?: readonly string[]) => string[];
  /**
   * Lists the files under each path whose name matches.
   *
   * @param paths - files or directories.
   * @param match - tells whether a file name is wanted.
   * @param open - directories walked without the skip rules.
   * @returns unique paths, sorted.
   */
  files: (paths: string[], match: (name: string) => boolean, open?: readonly string[]) => string[];
}

/** Git plumbing that runs nothing the agent could have configured (see `adapters/git.ts`). */
export interface Git {
  /**
   * Runs one hardened git command in a directory.
   *
   * @param dir - the working directory.
   * @param args - git arguments.
   * @returns stdout, or undefined when git fails or isn't installed.
   */
  run: (dir: string, args: string[]) => string | undefined;
}

/** Time, injected so tests and logs agree on it. */
export interface Clock {
  /**
   * The current wall-clock time, as the logs and state files record it.
   *
   * @returns an ISO 8601 UTC timestamp, e.g. `2026-09-27T12:00:00.000Z`.
   */
  now: () => string;
  /**
   * Milliseconds on the monotonic clock since the process started.
   *
   * @returns a duration, for timing runs.
   */
  elapsed: () => number;
}

/**
 * The process's environment, resolved once at startup. Values, not a lookup
 * function, so every configuration input is named here.
 */
export interface Runtime {
  /** The working directory. */
  cwd: string;
  /** `CLAUDE_PROJECT_DIR`, when set and non-empty. */
  claudeProjectDir: string | undefined;
  /** `CLAUDE_CONFIG_DIR`, when set and non-empty. */
  claudeConfigDir: string | undefined;
  /** `INWARDS_RUN_LOG`, when set. */
  runLog: string | undefined;
  /** `FORCE_COLOR` is set to a non-empty value. */
  forceColor: boolean;
  /** `NO_COLOR` is set to a non-empty value. */
  noColor: boolean;
  /** `INWARDS_NO_CACHE` is set to a non-empty value: `check` and `baseline` skip the disk cache. */
  noCache: boolean;
  /** The user's home directory. */
  home: string;
  /** `process.platform`. */
  platform: string;
  /** This process's id, for temporary file names. */
  pid: number;
  /** The running executable (Bun, or the compiled binary). */
  execPath: string;
  /** `CI` is set to a non-empty value. */
  ci: boolean;
  /** Standard input is a terminal. */
  stdinIsTTY: boolean;
  /** Standard output is a terminal. */
  stdoutIsTTY: boolean;
}

/** The standard streams. */
export interface Streams {
  /**
   * Writes to standard output.
   *
   * @param text - the text, with its own newline.
   */
  out: (text: string) => void;
  /**
   * Writes to standard error.
   *
   * @param text - the text, with its own newline.
   */
  err: (text: string) => void;
  /**
   * Reads all of standard input, synchronously (see `adapters/stdio.ts` for why).
   *
   * @returns the text.
   * @throws when stdin can't be read.
   */
  readIn: () => string;
}

/**
 * Everything outside the process, bundled for wiring. `main.ts` builds one
 * from the adapters; a function takes the narrowest `Pick` of it that it
 * needs, so its signature says what it touches.
 */
export interface Platform {
  probe: PathProbe;
  read: FileReader;
  walk: FileWalker;
  git: Git;
  clock: Clock;
  runtime: Runtime;
  streams: Streams;
  state: StateFiles;
}

/**
 * The CLI's own state under `<project>/.inwards/`, written safely: no
 * symlink is followed, the directory must really be inside the project, and
 * whole files appear atomically (see `adapters/state-files.ts`).
 */
export interface StateFiles {
  /**
   * Names the state directory without creating it, for readers.
   *
   * @param project - the real project root.
   * @returns `<project>/.inwards/state`.
   */
  statePath: (project: string) => string;
  /**
   * Creates the state directory and checks it lives inside the project.
   *
   * @param project - the real project root.
   * @returns the state directory.
   * @throws when it is a symlink, not a directory, or resolves outside the project.
   */
  stateDir: (project: string) => string;
  /**
   * Finds the state directory without creating it, for a reader that also deletes.
   *
   * @param project - the real project root.
   * @returns the directory, or undefined when missing or unsafe.
   */
  existingStateDir: (project: string) => string | undefined;
  /**
   * Appends one line, refusing a symlink planted at the path.
   *
   * @param path - the log file.
   * @param line - the text, ending in a newline.
   * @throws when the path isn't a regular file or can't be opened.
   */
  appendLine: (path: string, line: string) => void;
  /**
   * Writes a new file in a directory atomically: a temporary file named with
   * the process id, then a rename over `name`, which replaces a planted
   * symlink instead of following it.
   *
   * @param dir - a state directory that `stateDir` returned.
   * @param name - the final file name.
   * @param text - the content.
   * @throws when the temporary file exists or the rename fails.
   */
  publish: (dir: string, name: string, text: string) => void;
  /**
   * Deletes a file if it is there.
   *
   * @param path - the file.
   */
  remove: (path: string) => void;
  /**
   * Moves a log aside once it reaches a size, replacing the previous one.
   *
   * @param path - the log file.
   * @param maxBytes - the size at which it is moved.
   * @param rotated - where it goes.
   * @throws when the rename fails.
   */
  rotate: (path: string, maxBytes: number, rotated: string) => void;
  /**
   * Deletes other sessions' files past the age and count caps.
   *
   * @param dir - the state directory.
   * @param current - the session that is starting, never pruned.
   */
  prune: (dir: string, current: string) => void;
}
