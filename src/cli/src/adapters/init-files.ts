/**
 * @file Writing what `inwards init` planned, behind the `InitFiles` contract: the
 * agent wiring files (created with their directory), and the scaffold, whose
 * files are created with `wx` so nothing existing is replaced, pyproject.toml
 * last. A failed scaffold write removes the files and directories this run
 * created, so the project is as it was and init can run again.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Change, InitFiles } from "../init/contracts.ts";

/** Init writes on the real filesystem. */
export const nodeInitFiles: InitFiles = {
  write(path: string, text: string): void {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  },
  writeAll,
};

/**
 * Writes the scaffold's files, each with `wx` so nothing existing is
 * replaced, and pyproject.toml last. If any write fails, the files and
 * directories this run created are removed, and pyproject.toml is untouched
 * unless its own write was the one that failed.
 *
 * @param files - the files to create.
 * @param config - the pyproject.toml change, written last.
 * @returns undefined on success, or which file failed and why.
 */
function writeAll(files: readonly Change[], config: Change): string | undefined {
  const created: string[] = [];
  const dirs: string[] = [];
  let current = config.path;
  try {
    for (const file of files) {
      current = file.path;
      const made = mkdirSync(dirname(file.path), { recursive: true });
      if (made !== undefined) {
        dirs.push(made);
      }
      writeFileSync(file.path, file.after, { flag: "wx" });
      created.push(file.path);
    }
    current = config.path;
    writeFileSync(config.path, config.after);
    return undefined;
  } catch (err) {
    for (const path of [...created].reverse()) {
      rmSync(path, { force: true });
    }
    // Each is the first directory one mkdir created: everything below it is this run's.
    for (const dir of [...dirs].reverse()) {
      rmSync(dir, { recursive: true, force: true });
    }
    const reason = err instanceof Error ? err.message : String(err);
    return `${current}: ${reason}`;
  }
}
