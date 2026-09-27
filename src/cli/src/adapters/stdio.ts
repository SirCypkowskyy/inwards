/**
 * The standard streams behind the `Streams` contract. Output goes through
 * `write`, not console.*: with FORCE_COLOR set, Bun paints console.error red,
 * and the JSON an agent parses would arrive wrapped in ANSI codes.
 */
import { readFileSync } from "node:fs";
import process from "node:process";
import type { Streams } from "../platform/contracts.ts";

/** The process's stdin, stdout and stderr. */
export const processStreams: Streams = {
  out(text: string): void {
    process.stdout.write(text);
  },
  err(text: string): void {
    process.stderr.write(text);
  },
  readIn(): string {
    // Sync on purpose: awaiting Bun.stdin in the Windows binary let the process
    // exit before main() settled, i.e. exit 0 and the violation lost.
    return readFileSync(0, "utf8");
  },
};
