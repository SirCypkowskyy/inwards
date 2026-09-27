/**
 * The real filesystem behind the `PathProbe` and `FileReader` contracts
 * (`platform/contracts.ts`). Observations answer "not there" instead of
 * throwing; reads throw, as the contract says. Writes are not here: each
 * kind of state the CLI writes has its own adapter with its own safety rules
 * (`state-files.ts`, `baseline-files.ts`, ...).
 */
import {
  lstatSync,
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
  bytes(path: string): Uint8Array {
    return readFileSync(path);
  },
  list(dir: string): DirEntry[] | undefined {
    if (nodePathProbe.kind(dir) !== "dir") {
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
