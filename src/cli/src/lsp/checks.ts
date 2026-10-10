/**
 * @file The two checks the language server runs, both through `inwards check`'s
 * own code: a whole-project pass over every config the workspace folders
 * route to (`planCheck`, so a multi-root workspace gets each folder's own
 * config), and a check of one document alone with the config `inwards check`
 * would route it to, as the PostToolUse hook checks an edit. Both read the
 * open documents' text instead of the disk's. When to run them, and what a
 * document shows, is `session.ts`'s; the I/O is bound into `ServerCheck`.
 */
import { dirname, resolve } from "node:path";
import type { ConfigError, Diagnostic, Report } from "@inwards/core";
import type { ProjectIo } from "../project/contracts.ts";
import { type CheckUnit, planCheck } from "../project/routing.ts";
import type { Editor } from "./contracts.ts";
import { isConfigError, messageOf } from "./convert.ts";

/** The documents a check reads, as `inwards check` does: Python sources and stubs. */
export const PYTHON: RegExp = /\.pyi?$/u;

/**
 * Runs one config's check, as `project/check.ts`'s `runCheck` does with its
 * I/O and the server's in-memory extraction cache bound. Never starts threads.
 *
 * @param configPath - the pyproject.toml.
 * @param targets - absolute files; undefined for the whole project.
 * @param base - the directory report paths are relative to.
 * @param options - the open documents' text (`texts`), a per-edit check
 *   (`edit`), and the directories another config checks (`exclude`).
 * @returns the report.
 * @throws {ConfigError} when the config or its baseline is invalid.
 */
export type ServerCheck = (
  configPath: string,
  targets: string[] | undefined,
  base: string,
  options: { texts: ReadonlyMap<string, string>; edit?: boolean; exclude: readonly string[] },
) => Promise<Report>;

/** What the server needs: the editor, a check, and what planning reads. */
export interface ServerDeps {
  /** Where diagnostics, popups and log lines go. */
  editor: Editor;
  /** Runs a check. */
  check: ServerCheck;
  /** Probes paths and reads pyproject.toml files, for routing. */
  io: Pick<ProjectIo, "probe" | "read">;
  /**
   * Parses TOML, for finding uv workspace members.
   *
   * @param text - a pyproject.toml's contents.
   * @returns the document, or undefined when it doesn't parse.
   */
  toml: (text: string) => unknown;
}

/** What a whole pass found. */
export interface PassResult {
  /** The findings, by absolute path. */
  found: Map<string, Diagnostic[]>;
  /** The configs that couldn't be checked, by config path. */
  errors: Map<string, ConfigError>;
}

/**
 * Lists the checks a whole pass runs: what `inwards check` would run in each
 * workspace folder, each config once. A folder that can't be planned (an
 * unreadable pyproject.toml on the way) is logged and skipped.
 *
 * @param deps - what planning reads, and the log.
 * @param folders - the workspace folders, absolute.
 * @returns the checks, one per config.
 */
function unitsOf(deps: ServerDeps, folders: readonly string[]): CheckUnit[] {
  const byConfig = new Map<string, CheckUnit>();
  for (const folder of folders) {
    try {
      for (const unit of planCheck({ ...deps.io, toml: deps.toml }, folder, undefined).units) {
        if (!byConfig.has(unit.config)) {
          byConfig.set(unit.config, unit);
        }
      }
    } catch (err) {
      deps.editor.log(`inwards server: can't plan ${folder}: ${messageOf(err)}`);
    }
  }
  return [...byConfig.values()];
}

/**
 * Checks every config the workspace folders route to, as `inwards check`
 * without paths does in each folder.
 *
 * @param deps - the check, what planning reads, and the log.
 * @param folders - the workspace folders, absolute.
 * @param texts - the open documents' text, by absolute path.
 * @returns the findings by absolute path, and the configs that were invalid.
 * @throws when a check fails for a reason other than its config.
 */
export async function checkWorkspace(
  deps: ServerDeps,
  folders: readonly string[],
  texts: ReadonlyMap<string, string>,
): Promise<PassResult> {
  const found = new Map<string, Diagnostic[]>();
  const errors = new Map<string, ConfigError>();
  for (const unit of unitsOf(deps, folders)) {
    const base = dirname(unit.config);
    try {
      // biome-ignore lint/performance/noAwaitInLoops: one config at a time, as `inwards check` runs them; the reads are synchronous, so nothing would overlap anyway.
      const report = await deps.check(unit.config, unit.targets, base, {
        texts,
        exclude: unit.exclude,
      });
      for (const d of report.diagnostics) {
        const path = resolve(base, d.file);
        found.set(path, [...(found.get(path) ?? []), d]);
      }
    } catch (err) {
      if (!isConfigError(err)) {
        throw err;
      }
      errors.set(unit.config, err);
    }
  }
  return { found, errors };
}

/**
 * Checks one document alone, as the PostToolUse hook checks an edit
 * (`edit: true`), with the config `inwards check` would route it to.
 *
 * @param deps - the check and what routing reads.
 * @param path - the document's absolute path.
 * @param texts - the open documents' text, by absolute path.
 * @returns the findings in that file; none for a file that isn't Python,
 *   that no config covers, or whose config is broken (the whole pass reports that).
 * @throws when a check fails for a reason other than its config, or a
 *   pyproject.toml on the way can't be read.
 */
export async function checkAlone(
  deps: ServerDeps,
  path: string,
  texts: ReadonlyMap<string, string>,
): Promise<Diagnostic[]> {
  if (!PYTHON.test(path)) {
    return [];
  }
  const own: Diagnostic[] = [];
  for (const unit of planCheck({ ...deps.io, toml: deps.toml }, dirname(path), [path]).units) {
    const base = dirname(unit.config);
    try {
      // biome-ignore lint/performance/noAwaitInLoops: one config at a time, in order.
      const report = await deps.check(unit.config, [path], base, {
        texts,
        edit: true,
        exclude: unit.exclude,
      });
      own.push(...report.diagnostics.filter((d) => resolve(base, d.file) === path));
    } catch (err) {
      if (!isConfigError(err)) {
        throw err;
      }
    }
  }
  return own;
}

/**
 * Lists the findings of one list that another doesn't have, each copy counted.
 *
 * @param all - the findings to filter.
 * @param taken - the findings to leave out.
 * @returns what is left of `all`, in order.
 */
export function without(all: readonly Diagnostic[], taken: readonly Diagnostic[]): Diagnostic[] {
  const left = new Map<string, number>();
  for (const d of taken) {
    const key = JSON.stringify(d);
    left.set(key, (left.get(key) ?? 0) + 1);
  }
  return all.filter((d) => {
    const key = JSON.stringify(d);
    const n = left.get(key) ?? 0;
    left.set(key, n - 1);
    return n <= 0;
  });
}
