/**
 * The shared vocabulary of `inwards init`: which agents it can wire up, the
 * options it was given, the plan it settles on, the project it works on, and
 * the file changes it computes before writing anything.
 *
 * These types live apart from the modules that use them, so the wizard's
 * parts (planning, target discovery, the picker, the report) depend on this
 * contract instead of on each other. Pure: no I/O.
 */
import type { StyleName } from "./styles.ts";

/** The agents `inwards init --agent` can wire Inwards into. */
export const AGENTS = ["claude", "aider", "agents-md"] as const;

/** One of {@link AGENTS}. */
export type Agent = (typeof AGENTS)[number];

/**
 * Tells whether a string names an agent init supports.
 *
 * @param value - the `--agent` value.
 * @returns true for claude, aider or agents-md.
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
