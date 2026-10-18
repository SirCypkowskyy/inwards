/**
 * @file What the `hook/` slice shares between its mini-domains: the dependencies
 * a handler is given, where the project is, and the one sentence every denial
 * ends with, then the shapes of the session record (what a session started
 * from, how a report was made). The handlers in `claude-code/` take `HookDeps`
 * from `cli.ts`, which gets them from `main.ts`; none of them reaches for the
 * environment or the filesystem on its own.
 */

import type { InwardsConfig } from "@inwards/core";
import type { CheckRunner } from "../check/contracts.ts";
import type { RunLog } from "../runlog/index.ts";
import type { Platform, Runtime } from "../shared/platform/contracts.ts";

/** Ends every denial. The agent eval (eval/evidence.ts) counts denials by it. */
export const ASK_USER = "If this really must change, stop and ask the user to do it.";

/** What a hook handler is given for one invocation. */
export interface HookDeps {
  /** Everything outside the process. */
  io: Platform;
  /** This invocation's run log, which the handlers note their checks in. */
  runlog: RunLog;
  /** Runs a check with `io` bound (`project/check.ts`). */
  check: CheckRunner;
}

/**
 * The project a hook works in: `CLAUDE_PROJECT_DIR`, else the process cwd
 * (Claude Code runs hooks in the project), resolved to its real path. Never
 * the payload's own `cwd`, which the agent controls.
 *
 * @param io - resolves real paths and knows the environment.
 * @param io.probe - resolves real paths.
 * @param io.runtime - `CLAUDE_PROJECT_DIR` and the cwd.
 * @returns the real project root, or undefined when it doesn't exist.
 */
export function hookProject(io: {
  probe: Pick<Platform["probe"], "realpath">;
  runtime: Pick<Runtime, "claudeProjectDir" | "cwd">;
}): string | undefined {
  return io.probe.realpath(io.runtime.claudeProjectDir ?? io.runtime.cwd);
}

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
