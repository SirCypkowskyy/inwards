/**
 * @file The shapes the session feature shares between its modules: what a session
 * started from, how a report was made, and how to run a check. Types only.
 */
import type { InwardsConfig, Report } from "@inwards/core";

/** What a session started from, as far as file content and configs go. */
export interface Start {
  /** The commit at session start, or null outside git. */
  head: string | null;
  /** SHA-256 of every Python file at session start, by project-relative path. */
  manifest: Record<string, string>;
  /** The valid configs at session start, by project-relative path. */
  configs: Record<string, InwardsConfig>;
}

/** How a report was made: its config, the base of its paths, and whether the baseline applied. */
export interface Check {
  configPath: string;
  base: string;
  baseline: boolean;
  /**
   * The path the agent wrote for a checked file, when the hook had to resolve
   * a `..` to find it: absolute checked file to the payload's cwd joined with
   * its path, `..` applied as text. The file has a start identity only if
   * both name the same one (`identityOf`).
   */
  written?: ReadonlyMap<string, string>;
}

/**
 * Runs a check, as `project/check.ts`'s `runCheck` does, with its I/O already bound.
 *
 * @param configPath - the pyproject.toml.
 * @param targets - absolute files; undefined for the whole project.
 * @param base - the directory report paths are relative to.
 * @param options - whether the baseline applies, and file contents to check instead of the disk's.
 * @returns the report.
 */
export type CheckRunner = (
  configPath: string,
  targets: string[] | undefined,
  base: string,
  options: { baseline?: boolean; required?: boolean; texts?: ReadonlyMap<string, string> },
) => Promise<Report>;
