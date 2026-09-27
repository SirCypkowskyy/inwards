import process from "node:process";

/**
 * Writes a message line: stdout for exit 0, stderr otherwise.
 * Not console.*: with FORCE_COLOR set, Bun paints console.error red, and the
 * JSON an agent parses would arrive wrapped in ANSI codes.
 *
 * @param message - the text to print, without a trailing newline.
 * @param code - the exit code the caller will return.
 * @returns `code`, so callers can `return print(...)`.
 */
export function print(message: string, code: number): number {
  (code === 0 ? process.stdout : process.stderr).write(`${message}\n`);
  return code;
}
