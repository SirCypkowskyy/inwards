/**
 * @file Turns diagnostics into GitHub Actions workflow commands (`::error` and
 * `::warning`), which the runner shows as annotations on the file and line.
 * It escapes messages and properties as `@actions/core` does; the summary
 * lines come from `render.ts`, and the paths from the adapter.
 */
import type { Diagnostic } from "../contracts/records.ts";

/**
 * Renders the report as workflow commands, one per diagnostic, after a
 * `::warning` with no file for each named path that gave nothing to check,
 * then the summary as plain log lines. `file` is used as given, so the
 * adapter passes paths relative to the repository root. The message carries
 * the fix and the docs link, since an annotation is all a reviewer sees.
 *
 * A span over several lines gives `line` and `endLine` only: the runner drops
 * `col` and `endColumn` when the two lines differ.
 *
 * @param shown - the diagnostics to print.
 * @param notChecked - the named paths that gave no file to check, with their sentences.
 * @param footer - the text report's summary lines, which start with one line per
 *   `notChecked` entry; those are left out, since the commands carry them.
 * @returns the commands and the summary, one per line.
 */
export function renderGithub(
  shown: readonly Diagnostic[],
  notChecked: readonly { message: string }[] | undefined,
  footer: readonly string[],
): string {
  const skipped = (notChecked ?? []).map((n) => `::warning::${escapeData(n.message)}`);
  return [...skipped, ...shown.map(command), ...footer.slice(skipped.length)].join("\n");
}

/**
 * Builds the workflow command for one diagnostic.
 *
 * @param d - the diagnostic.
 * @returns `::error file=…,line=…,title=CODE::message`, or `::warning` for a warning.
 */
function command(d: Diagnostic): string {
  const where =
    d.endLine === d.line
      ? { line: d.line, endLine: d.endLine, col: d.column, endColumn: d.endColumn }
      : { line: d.line, endLine: d.endLine };
  const properties = Object.entries({ file: d.file, ...where, title: d.code })
    .map(([key, value]) => `${key}=${escapeProperty(String(value))}`)
    .join(",");
  const steps = d.fix.steps.map((s, i) => `${i + 1}. ${s}`);
  const text = [d.message, `Fix: ${d.fix.summary}`, ...steps, `Docs: ${d.docs}`].join("\n");
  return `::${d.severity} ${properties}::${escapeData(text)}`;
}

/**
 * Escapes a workflow command's message the way `@actions/core` does
 * (`escapeData` in actions/toolkit `packages/core/src/command.ts`), so a
 * newline continues the message instead of ending the command.
 *
 * @param text - the message.
 * @returns the text with `%`, CR and LF percent-encoded, `%` first.
 */
function escapeData(text: string): string {
  return text.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
}

/**
 * Escapes a workflow command's property value the way `@actions/core` does
 * (`escapeProperty`): as a message, plus `:` and `,`, which would otherwise
 * end the value.
 *
 * @param value - a property value such as a file path or a rule code.
 * @returns the value with `%`, CR, LF, `:` and `,` percent-encoded.
 */
function escapeProperty(value: string): string {
  return escapeData(value).replaceAll(":", "%3A").replaceAll(",", "%2C");
}
