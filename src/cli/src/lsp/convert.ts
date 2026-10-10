/**
 * @file Turning what the engine and the config parser report into what an
 * editor shows: engine diagnostics into LSP diagnostics (0-based positions,
 * the fix summary on a second line), and a config error into a diagnostic on
 * the pyproject.toml line it names. Pure: no paths are read here.
 */
import { ConfigError, type Diagnostic } from "@inwards/core";
import type { LspDiagnostic } from "./contracts.ts";

/** LSP's severities for the engine's two. */
const ERROR = 1;
const WARNING = 2;

/**
 * Converts an engine diagnostic to an LSP diagnostic.
 * LSP positions are 0-based; the engine's are 1-based. The message carries
 * the fix summary on a second line, since LSP has no field for it.
 *
 * @param d - the engine's diagnostic.
 * @returns the diagnostic in LSP form.
 */
export function toLsp(d: Diagnostic): LspDiagnostic {
  return {
    range: {
      start: { line: d.line - 1, character: d.column - 1 },
      end: { line: d.endLine - 1, character: d.endColumn - 1 },
    },
    severity: d.severity === "error" ? ERROR : WARNING,
    code: d.code,
    codeDescription: { href: d.docs },
    source: "inwards",
    message: d.fix.summary === "" ? d.message : `${d.message}\n${d.fix.summary}`,
  };
}

/**
 * Words an error a check couldn't get past, for the popup and the log.
 *
 * @param err - what the check threw.
 * @returns the error's message, or its text when it isn't an Error.
 */
export function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Turns a config error into a diagnostic on pyproject.toml: on the line the
 * TOML parser names when the file isn't valid TOML, else on the first line,
 * since the config's own checks name a key, not a line.
 *
 * @param err - the config error.
 * @returns an error diagnostic spanning that whole line.
 */
export function configDiagnostic(err: ConfigError): LspDiagnostic {
  const cause: unknown = err.cause;
  let line = 0;
  if (typeof cause === "object" && cause !== null && "line" in cause) {
    line = typeof cause.line === "number" ? Math.max(cause.line - 1, 0) : 0;
  }
  return {
    range: { start: { line, character: 0 }, end: { line: line + 1, character: 0 } },
    severity: ERROR,
    source: "inwards",
    message: err.message,
  };
}

/**
 * Tells whether a check failed on the config (or its baseline) rather than on
 * something unexpected.
 *
 * @param err - what the check threw.
 * @returns true for a `ConfigError`.
 */
export function isConfigError(err: unknown): err is ConfigError {
  return err instanceof ConfigError;
}
