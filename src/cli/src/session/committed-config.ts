/**
 * @file Whether a session's start configs are the ones committed at its start HEAD,
 * for a start record the Stop gate can't check against its witness (#88).
 * Such a record may have been recorded after the agent loosened
 * `[tool.inwards]`, so a config that differs from the commit can't be trusted
 * there. The committed text comes from `git cat-file blob`, never `git show`
 * or `--filters`, which could run filter drivers the agent wrote, and never
 * with a lazy fetch: `--no-lazy-fetch` on git 2.44 and later, and on older
 * git only outside a partial clone. git runs through the hardened `Git` contract.
 */
import { declaresInwards, type InwardsConfig, parseConfig } from "@inwards/core";
import type { Git } from "../platform/contracts.ts";
import type { SessionStart } from "./contracts.ts";

/** What the comparison with the committed configs found. */
export interface CommittedCheck {
  /** Config paths whose table at session start isn't the one committed at the start HEAD. */
  uncommitted: string[];
  /** True when git can't be read safely here, so nothing could be compared. */
  unverifiable: boolean;
}

/** A partial clone's markers in `git config --list`, which lowercases the names. */
const PARTIAL_CLONE =
  /^(?:extensions\.partialclone|remote\..+\.(?:promisor|partialclonefilter))=/mu;

/**
 * Compares the start configs with the committed ones.
 *
 * @param git - runs hardened git plumbing.
 * @param project - the real project root, where git runs.
 * @param start - the start record's HEAD and configs.
 * @returns the config paths whose `[tool.inwards]` at session start differs
 *   from the one at the start commit, or that isn't committed there (all of
 *   them outside git); or `unverifiable` when git can't read blobs safely.
 */
export function uncommittedConfigs(
  git: Git,
  project: string,
  start: Pick<SessionStart, "head" | "configs">,
): CommittedCheck {
  const { head } = start;
  const entries = Object.entries(start.configs);
  if (head === null) {
    return { uncommitted: entries.map(([rel]) => rel), unverifiable: false };
  }
  const flags = blobFlags(git, project);
  if (flags === undefined) {
    return { uncommitted: [], unverifiable: true };
  }
  const uncommitted = entries
    .filter(([rel, config]) => {
      // `./` makes the path relative to the project, which may sit below the repo root.
      const text = git.run(project, [...flags, "cat-file", "blob", `${head}:./${rel}`]);
      return text === undefined || !sameConfig(text, config);
    })
    .map(([rel]) => rel);
  return { uncommitted, unverifiable: false };
}

/**
 * Picks how to read a blob without fetching anything. Git 2.44 and later take
 * `--no-lazy-fetch`. Older git has no such flag, but it only fetches a
 * missing object from a promisor remote, which only a partial clone has; so
 * outside a partial clone a plain `cat-file blob` fetches nothing.
 *
 * @param git - runs hardened git plumbing.
 * @param project - the real project root, where git runs.
 * @returns the global flags for `cat-file`, or undefined when an older git
 *   runs in a partial clone, or its config can't be read.
 */
function blobFlags(git: Git, project: string): string[] | undefined {
  if (git.run(project, ["--no-lazy-fetch", "version"]) !== undefined) {
    return ["--no-lazy-fetch"];
  }
  const config = git.run(project, ["config", "--list"]);
  return config === undefined || PARTIAL_CLONE.test(config) ? undefined : [];
}

/**
 * Tells whether a pyproject.toml's `[tool.inwards]` is a given config.
 *
 * @param text - the pyproject.toml text.
 * @param config - the config as the start record holds it.
 * @returns true when the text declares a table that parses to the same config.
 */
function sameConfig(text: string, config: InwardsConfig): boolean {
  try {
    return declaresInwards(text) && JSON.stringify(parseConfig(text)) === JSON.stringify(config);
  } catch {
    return false; // an invalid table can't be the valid one recorded
  }
}
