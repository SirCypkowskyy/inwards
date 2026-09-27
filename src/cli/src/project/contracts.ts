/**
 * @file What the project feature needs from outside, besides the shared platform
 * contracts: the tree-sitter binaries for the engine, and a safe way to
 * replace a baseline file. Types only.
 */
import type { GrammarBinaries } from "@inwards/core";
import type { Clock, FileReader, FileWalker, PathProbe } from "../platform/contracts.ts";

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
}
