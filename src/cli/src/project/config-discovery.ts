/**
 * @file Finding the pyproject.toml that configures Inwards for a directory: the
 * nearest one above it whose parsed TOML declares `[tool.inwards]`
 * (`declaresInwards`), so any valid spelling of the table counts. The hooks
 * pass a boundary, so a config (or its text, via an error message) is never
 * read from outside the project. Filesystem access comes in through the
 * `PathProbe` and `FileReader` contracts.
 */
import { dirname, resolve } from "node:path";
import { declaresInwards } from "@inwards/core";
import { isInside } from "../paths/lexical.ts";
import type { FileReader, PathProbe, Runtime } from "../platform/contracts.ts";

/**
 * Picks the config a command works on: `--config`, resolved against the
 * cwd, or else the nearest one above the cwd. A `--config` that isn't a file
 * is a usage error rather than a crash on the first read (#212).
 *
 * @param io - probes and resolves paths, reads candidates and knows the cwd.
 * @param io.probe - tells what a path is and resolves real paths.
 * @param io.read - reads a candidate's text.
 * @param io.runtime - the cwd.
 * @param flag - the `--config` value, if given.
 * @returns the config path, or the line to print with exit 2 when there is none.
 * @throws when a candidate can't be read.
 */
export function commandConfig(
  io: {
    probe: Pick<PathProbe, "kind" | "realpath">;
    read: Pick<FileReader, "text">;
    runtime: Pick<Runtime, "cwd">;
  },
  flag: string | undefined,
): { path: string } | { problem: string } {
  if (flag) {
    const path = resolve(io.runtime.cwd, flag);
    return io.probe.kind(path) === "file"
      ? { path }
      : { problem: `--config ${flag}: no such file.` };
  }
  const path = findConfig(io, io.runtime.cwd);
  return path ? { path } : { problem: "No pyproject.toml with [tool.inwards] found." };
}

/**
 * Finds the nearest pyproject.toml that configures Inwards, walking up from
 * `dir` to the filesystem root.
 *
 * @param io - resolves real paths and reads candidates.
 * @param io.probe - resolves real paths.
 * @param io.read - reads a candidate's text.
 * @param dir - the directory to start from.
 * @param within - optional real directory every accepted config must be inside.
 * @param accept - optional filter on a candidate's real path; a rejected one is passed over.
 * @returns the config path, or undefined when no ancestor has one.
 * @throws when an accepted candidate can't be read.
 */
export function findConfig(
  io: { probe: Pick<PathProbe, "realpath">; read: Pick<FileReader, "text"> },
  dir: string,
  within?: string,
  accept?: (real: string) => boolean,
): string | undefined {
  for (let d = dir; ; d = dirname(d)) {
    const candidate = resolve(d, "pyproject.toml");
    const real = io.probe.realpath(candidate);
    const allowed =
      real !== undefined &&
      (within === undefined || isInside(within, real)) &&
      (accept === undefined || accept(real));
    if (allowed && declaresInwards(io.read.text(real))) {
      return candidate;
    }
    if (dirname(d) === d) {
      return undefined;
    }
  }
}
