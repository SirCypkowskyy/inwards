/**
 * @file The shared vocabulary of `inwards init`: which agents it can wire up, the
 * options it was given, the plan it settles on, the project it works on, and
 * the file changes it computes before writing anything.
 *
 * These types live apart from the modules that use them, so the wizard's
 * parts (planning, target discovery, the picker, the report) depend on this
 * contract instead of on each other. Pure: no I/O.
 */
import type { Platform } from "../platform/contracts.ts";
import type { CheckRunner } from "../session/contracts.ts";
import type { StyleName } from "./styles.ts";

/** The agents `inwards init --agent` can wire Inwards into. */
export const AGENTS = ["claude", "opencode", "aider", "agents-md"] as const;

/** One of {@link AGENTS}. */
export type Agent = (typeof AGENTS)[number];

/**
 * Tells whether a string names an agent init supports.
 *
 * @param value - what was passed to `--agent`, if anything.
 * @returns true for claude, opencode, aider or agents-md.
 */
export function isAgent(value: string | undefined): value is Agent {
  return AGENTS.some((agent) => agent === value);
}

/** One file init wants to write: its current text (undefined if absent) and the new text. */
export interface Change {
  path: string;
  before: string | undefined;
  after: string;
}

/** The `init` options main.ts parsed. */
export interface InitFlags {
  agent?: string | undefined;
  style?: string | undefined;
  scaffold?: boolean | undefined;
  package?: string | undefined;
  launcher?: string | undefined;
  "list-styles"?: boolean | undefined;
  "dry-run"?: boolean | undefined;
}

/** What to do, once flags or the picker have decided. */
export interface InitPlan {
  style: StyleName | undefined;
  scaffold: boolean;
  agent: Agent | undefined;
}

/** A pyproject.toml found from the cwd, and what init needs to know about it. */
export interface Target {
  path: string;
  text: string;
  /** True when it already has `[tool.inwards]`. */
  configured: boolean;
  /** The import package: `--package`, or `[project].name` normalised; undefined when neither is set. */
  pkg: string | undefined;
}

/** Writing what init planned (see `adapters/init-files.ts`). */
export interface InitFiles {
  /**
   * Writes one file, creating its directory: the agent wiring init edits in place.
   *
   * @param path - the file.
   * @param text - its new content.
   * @throws when it can't be written.
   */
  write: (path: string, text: string) => void;
  /**
   * Writes the scaffold's files without replacing anything, pyproject.toml
   * last, and removes what this run created if any write fails.
   *
   * @param files - the files to create.
   * @param config - the pyproject.toml change, written last.
   * @returns undefined on success, or which file failed and why.
   */
  writeAll: (files: readonly Change[], config: Change) => string | undefined;
}

/** The interactive style picker (see `adapters/picker.ts`). */
export interface Picker {
  /**
   * Asks for a style, whether to scaffold, and an agent.
   *
   * @param target - the project found from the cwd.
   * @param flags - the options given so far.
   * @returns the plan, or undefined when the user cancels.
   */
  pick: (target: Target, flags: InitFlags) => Promise<InitPlan | undefined>;
}

/** What `inwards init` needs besides the platform. */
export interface InitDeps {
  files: InitFiles;
  picker: Picker;
  /** Absolute path of the CLI's `main.ts`, for running Inwards from source under Bun. */
  entry: string;
  /**
   * Parses TOML, returning undefined instead of throwing.
   *
   * @param text - the TOML text.
   * @returns the document, or undefined when it doesn't parse.
   */
  toml: (text: string) => unknown;
}

/** Everything an init function is given. */
export interface InitContext {
  io: Platform;
  /** Runs a check with its I/O bound, for the report after writing. */
  check: CheckRunner;
  init: InitDeps;
}
