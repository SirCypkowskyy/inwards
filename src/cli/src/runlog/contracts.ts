/**
 * @file What `inwards stats` needs from outside: the platform, and for `--export`
 * the project's export key, kept and read without following symlinks, and a
 * file written for the owner only. Types only.
 */
import type { Platform } from "../platform/contracts.ts";

/** Storage for `--export`. */
export interface ExportFiles {
  /**
   * Returns the project's export key, creating it on first use.
   *
   * @param project - the project root, whose `.inwards/export-key` holds it.
   * @returns 64 hex digits.
   * @throws {ConfigError} when `.inwards` or the key is a symlink, or the key is malformed.
   */
  exportKey: (project: string) => string;
  /**
   * Writes a file, creating it readable by the owner only. A file that already
   * exists keeps its permissions, as on develop.
   *
   * @param path - the file.
   * @param text - its content.
   * @throws when it can't be written.
   */
  writeOwnerOnly: (path: string, text: string) => void;
}

/** What `inwards stats` is given: the part of `AppDeps` it reads. */
export interface StatsDeps {
  /** Everything outside the process. */
  io: Platform;
  /** Keeps the export key and writes the export. */
  exports: ExportFiles;
}
