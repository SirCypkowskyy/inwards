/**
 * @file Storage for `inwards stats --export`, behind the `ExportFiles` contract: the
 * per-project HMAC key in `.inwards/export-key` (made once, never leaving
 * the machine, read with O_NOFOLLOW so a planted symlink isn't followed), and
 * the export file, written for the owner only.
 * Hashing and choosing what to export are policy, in `runlog/export.ts`; only
 * the key and the file live here.
 */
import { randomBytes } from "node:crypto";
import { closeSync, constants, lstatSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ConfigError } from "@inwards/core";
import type { ExportFiles } from "../runlog/contracts.ts";

const KEY_BYTES = 32;
const KEY_FORMAT = /^[0-9a-f]{64}$/u;
/** O_NOFOLLOW where the OS has it (not on Windows), so a planted symlink isn't read. */
const NO_FOLLOW: number = constants.O_NOFOLLOW ?? 0;
const OWNER_ONLY = 0o600;

/** Export storage on the real filesystem. */
export const nodeExportFiles: ExportFiles = {
  exportKey(project: string): string {
    const dir = join(project, ".inwards");
    if (lstatSync(dir, { throwIfNoEntry: false })?.isSymbolicLink()) {
      throw new ConfigError(`${dir} is a symlink; the export key must stay in the project.`);
    }
    return readKey(join(dir, "export-key")) ?? createKey(dir);
  },
  writeOwnerOnly(path: string, text: string): void {
    writeFileSync(path, text, { mode: OWNER_ONLY });
  },
};

/**
 * Reads the key without following a symlink.
 *
 * @param path - the key file.
 * @returns the key, or undefined when there is none yet.
 * @throws {ConfigError} when the file isn't 64 hex digits.
 */
function readKey(path: string): string | undefined {
  if (lstatSync(path, { throwIfNoEntry: false }) === undefined) {
    return undefined;
  }
  let fd: number;
  try {
    // biome-ignore lint/suspicious/noBitwiseOperators: open(2) flags are a bit set.
    fd = openSync(path, constants.O_RDONLY | NO_FOLLOW);
  } catch (err) {
    throw new ConfigError(`${path} can't be read safely (a symlink?).`, { cause: err });
  }
  try {
    const key = readFileSync(fd, "utf8").trim();
    if (!KEY_FORMAT.test(key)) {
      throw new ConfigError(
        `${path} isn't an export key (64 hex digits). Delete it to make a new one.`,
      );
    }
    return key;
  } finally {
    closeSync(fd);
  }
}

/**
 * Creates the key, or reads the one a concurrent export just created.
 *
 * @param dir - the project's `.inwards/`.
 * @returns 64 hex digits: a new key, or the one a concurrent export wrote first.
 */
function createKey(dir: string): string {
  const path = join(dir, "export-key");
  const key = randomBytes(KEY_BYTES).toString("hex");
  try {
    writeFileSync(path, `${key}\n`, { mode: OWNER_ONLY, flag: "wx" });
    return key;
  } catch {
    return readKey(path) ?? key; // another export won the race: use its key
  }
}
