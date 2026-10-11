/**
 * @file What `inwards import-config` and `inwards import-diagram` share once
 * they hold a `[tool.inwards]` table: checking that it parses, and appending
 * it to a pyproject.toml that doesn't configure Inwards yet, in the file's
 * own line endings. It never overwrites a table; it reads nothing itself and
 * writes through init's file writer.
 */
import { ConfigError, declaresInwards, parseConfig } from "@inwards/core";
import { separator } from "../init/style.ts";
import { shown } from "../init/target.ts";
import type { AppDeps } from "./deps.ts";

/** The pyproject.toml a table goes into, and its text when it exists. */
export interface Pyproject {
  path: string;
  text: string | undefined;
}

/**
 * Appends the table to pyproject.toml, one blank line after the rest, in the
 * file's own line endings. Refuses when there is no pyproject.toml, when it
 * already configures Inwards, or when the result wouldn't read back as the table.
 *
 * @param deps - the platform and init's file writer.
 * @param pyproject - the file to add the table to.
 * @param table - the `[tool.inwards]` TOML.
 * @param command - the command's name, for the refusals.
 * @returns undefined once written, or why it wasn't.
 * @throws when the file can't be written.
 */
export function appendTable(
  deps: AppDeps,
  pyproject: Pyproject,
  table: string,
  command: string,
): string | undefined {
  const { path, text } = pyproject;
  const where = shown(deps.io.runtime.cwd, path);
  if (text === undefined) {
    return `there is no ${where} to write to; run without --write and save the table yourself.`;
  }
  if (declaresInwards(text)) {
    return `${where} already has [tool.inwards], and ${command} never overwrites it. Run without --write and merge the table by hand.`;
  }
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const after = `${text}${separator(text, eol)}${table.replaceAll("\n", eol)}`;
  if (JSON.stringify(parsedTable(after)) !== JSON.stringify(parsedTable(table))) {
    return `could not add [tool.inwards] to ${where} safely; add this table by hand:\n${table}`;
  }
  deps.init.files.write(path, after);
  return undefined;
}

/**
 * Parses a config, keeping the parts the imports write, so two texts can be compared.
 *
 * @param text - TOML holding `[tool.inwards]`.
 * @returns the parsed root, layers, contexts, ignores and diagrams, or the config error.
 * @throws when parsing fails with anything but a ConfigError.
 */
export function parsedTable(text: string): object | ConfigError {
  try {
    const { layers, contexts, ignore, root, diagrams } = parseConfig(text);
    return { layers, contexts, ignore, root, diagrams };
  } catch (err) {
    if (err instanceof ConfigError) {
      return err;
    }
    throw err;
  }
}
