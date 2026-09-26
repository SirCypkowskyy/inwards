/**
 * The language server's side of pyproject.toml: reading the config, and
 * turning a config error into what the editor shows.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { ConfigError, declaresInwards, type InwardsConfig, parseConfig } from "@inwards/core";
import { type Diagnostic, DiagnosticSeverity } from "vscode-languageserver/node";

/** A config error, shown on pyproject.toml at a 0-based line. */
export interface ConfigProblem {
  message: string;
  line: number;
}

/**
 * Reads and validates the config.
 * As in the CLI, a file that can't be read is an error, not a missing
 * config; a file without `[tool.inwards]` is no config at all.
 *
 * @param path - the pyproject.toml's absolute path.
 * @returns the config, or undefined when there is no Inwards config.
 * @throws {ConfigError} when the config is broken or can't be read.
 */
export function readConfig(path: string): InwardsConfig | undefined {
  if (!existsSync(path)) {
    return undefined;
  }
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new ConfigError(`pyproject.toml can't be read: ${detail}`, { cause: err });
  }
  return declaresInwards(text) ? parseConfig(text) : undefined;
}

/**
 * Finds the line a config error points at: the TOML parser's, when the
 * file isn't valid TOML. The config's own checks name a key, not a line.
 *
 * @param err - the config error.
 * @returns the error's message and 0-based line, 0 when it has none.
 */
export function problemOf(err: ConfigError): ConfigProblem {
  const cause: unknown = err.cause;
  let line = 0;
  if (typeof cause === "object" && cause !== null && "line" in cause) {
    line = typeof cause.line === "number" ? cause.line - 1 : 0;
  }
  return { message: err.message, line };
}

/**
 * Lists the diagnostics for pyproject.toml: the config error on its whole
 * line. A config that isn't a file (a directory, say) gets none; the popup
 * still says what is wrong.
 *
 * @param path - the pyproject.toml's absolute path.
 * @param problem - the config's error, if it has one.
 * @returns the diagnostics to publish, empty once the config is fine.
 */
export function configDiagnostics(path: string, problem: ConfigProblem | undefined): Diagnostic[] {
  if (!problem || statSync(path, { throwIfNoEntry: false })?.isFile() !== true) {
    return [];
  }
  const { message, line } = problem;
  return [
    {
      range: { start: { line, character: 0 }, end: { line: line + 1, character: 0 } },
      severity: DiagnosticSeverity.Error,
      source: "inwards",
      message,
    },
  ];
}
