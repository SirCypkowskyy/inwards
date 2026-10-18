/**
 * @file The CLI's one way to say something and return an exit code: stdout when
 * the code is 0, stderr otherwise. It writes through the `Streams` contract,
 * so it works the same with the real streams and with a test's fake.
 */
import type { Streams } from "./contracts.ts";

/**
 * Writes a message line: stdout for exit 0, stderr otherwise.
 *
 * @param streams - where to write.
 * @param message - the text, without a trailing newline.
 * @param code - the exit code the caller will return.
 * @returns `code`, so callers can `return print(...)`.
 */
export function print(
  streams: Pick<Streams, "out" | "err">,
  message: string,
  code: number,
): number {
  (code === 0 ? streams.out : streams.err).call(streams, `${message}\n`);
  return code;
}
