/**
 * @file What `inwards stats --export` needs from outside: the project's export key,
 * kept and read without following symlinks, and a file written for the
 * owner only. Types only.
 */

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
   * Writes a file readable by the owner only.
   *
   * @param path - the file.
   * @param text - its content.
   * @throws when it can't be written.
   */
  writeOwnerOnly: (path: string, text: string) => void;
}
