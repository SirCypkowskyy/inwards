/**
 * @file The real filesystem behind the `PathProbe` and `FileReader` contracts
 * (`platform/contracts.ts`). Observations answer "not there" instead of
 * throwing; reads throw, as the contract says. Writes are not here: each
 * kind of state the CLI writes has its own adapter with its own safety rules
 * (`state-files.ts`, `baseline-files.ts`, ...).
 */
import {
  lstatSync,
  promises,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  statSync,
} from "node:fs";
import type { DirEntry, FileReader, PathKind, PathProbe } from "../platform/contracts.ts";

/** Path observations on the real filesystem. */
export const nodePathProbe: PathProbe = {
  realpath,
  kind(path: string): PathKind {
    try {
      const stat = statSync(path);
      if (stat.isDirectory()) {
        return "dir";
      }
      return stat.isFile() ? "file" : undefined;
    } catch {
      return undefined;
    }
  },
  isLink(path: string): boolean | undefined {
    try {
      return lstatSync(path).isSymbolicLink();
    } catch {
      return undefined;
    }
  },
  readLink(path: string): string | undefined {
    try {
      return lstatSync(path).isSymbolicLink() ? readlinkSync(path) : undefined;
    } catch {
      return undefined;
    }
  },
  exists(path: string): boolean {
    try {
      statSync(path);
      return true;
    } catch {
      return false;
    }
  },
};

/** File reads on the real filesystem. */
export const nodeFileReader: FileReader = {
  text(path: string): string {
    return readFileSync(path, "utf8");
  },
  texts: readTexts,
  bytes(path: string): Uint8Array {
    return readFileSync(path);
  },
  list(dir: string): DirEntry[] | undefined {
    // Not nodePathProbe.kind, which reads every error as "nothing there": an
    // ancestor the user can't enter must throw here, as on develop.
    if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) {
      return undefined;
    }
    return readdirSync(dir, { withFileTypes: true }).map((entry) => ({
      name: entry.name,
      dir: entry.isDirectory(),
      file: entry.isFile(),
    }));
  },
};

/**
 * Resolves symlinks and `..` in a path that may not exist.
 *
 * @param path - any path.
 * @returns the canonical path, or undefined when it does not exist.
 */
function realpath(path: string): string | undefined {
  try {
    return realpathSync(path);
  } catch {
    return undefined;
  }
}

/**
 * Reads many files as UTF-8 text, all requested at once, so the reads wait
 * on the disk together. Bun's docs list `node:fs` as fully implemented
 * without saying how many files `fs.promises.readFile` keeps open at once;
 * measured instead, saleor's 4,324 files read the same under a limit of 64
 * open files (`ulimit -n 64`) on macOS and Linux, and a bounded queue of 16
 * reads was no faster (#281).
 *
 * @param paths - the files.
 * @returns their texts, in the order of `paths`.
 * @throws (as a rejected promise) a read error, as `readFileSync` would throw it.
 */
function readTexts(paths: readonly string[]): Promise<string[]> {
  return Promise.all(paths.map((path) => promises.readFile(path, "utf8")));
}
