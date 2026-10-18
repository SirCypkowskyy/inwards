/**
 * @file The shapes the session feature shares between its modules: what a session
 * started from, how a report was made, and how to run a check. Types only.
 */
import type { InwardsConfig } from "@inwards/core";

/** What a session started from, as far as file content and configs go. */
export interface Start {
  /** The commit at session start, or null outside git. */
  head: string | null;
  /** SHA-256 of every Python file at session start, by project-relative path. */
  manifest: Record<string, string>;
  /** The valid configs at session start, by project-relative path. */
  configs: Record<string, InwardsConfig>;
}

/** What a session started from, as its start record holds it. */
export interface SessionStart extends Start {
  at: string;
  /** pyproject.toml files whose `[tool.inwards]` was already invalid (absent in older state files). */
  invalid?: string[];
  /** Each config's inwards-baseline.json SHA-256, by config path (absent in older state files). */
  baselines?: Record<string, string>;
  /**
   * The symlinks in layer packages: project-relative link path to its real
   * target (absent in older state files, where every link counts as new).
   */
  links?: Record<string, string>;
  /**
   * The top-level first-party modules under each config's root, by config
   * path (`projectTopLevel`; absent in older state files, where no package
   * counts as new).
   */
  topLevel?: Record<string, string[]>;
}

/** How a report was made: its config, the base of its paths, and whether the baseline applied. */
export interface Check {
  configPath: string;
  base: string;
  baseline: boolean;
  /** The config to check with instead of the one in `configPath`, as `CheckRunner` takes it. */
  config?: InwardsConfig | undefined;
  /** Top-level names new this session, which the session-start check must not see. */
  absent?: readonly string[] | undefined;
  /**
   * Absolute files the Stop gate checks only because they mention a new
   * top-level name, byte for byte what they were at start: their text now is
   * their start content, even without a copy or a git blob (#86).
   */
  unchanged?: ReadonlySet<string> | undefined;
  /**
   * The path the agent wrote for a checked file, when the hook had to resolve
   * a `..` to find it: absolute checked file to the payload's cwd joined with
   * its path, `..` applied as text. The file has a start identity only if
   * both name the same one (`identityOf`).
   */
  written?: ReadonlyMap<string, string>;
}
