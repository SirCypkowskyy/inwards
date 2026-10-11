/**
 * @file Renders a check's report as text, concise, JSON, SARIF or GitHub
 * Actions workflow commands. Pure string building: the adapter writes the
 * result, picks the paths (relative to the working directory, or to the
 * repository root for `github`), and asks for colour.
 */
import type { Diagnostic, Suppressed } from "../contracts/records.ts";
import { DOCS_BASE, VERSION } from "../meta/product.ts";
import { RULES } from "../meta/registry.ts";
import { renderGithub } from "./github.ts";

/** A line break with the spaces around it; Unicode line and paragraph separators count too. */
const LINE_BREAKS = /\s*[\r\n\u2028\u2029]+\s*/gu;

export interface Report {
  diagnostics: Diagnostic[];
  filesChecked: number;
  durationMs: number;
  /** Violations left out because the project's baseline accepts them. */
  baselined?: number;
  /** Baseline entries a whole-project run no longer found: fixed since the baseline. */
  resolved?: number;
  /** Findings inline suppression comments hid; counted in every format, listed in SARIF. */
  suppressed?: Suppressed[];
  /**
   * Paths named for the check that gave no file to check (outside the config
   * root, or no Python files), each with the sentence to show for it.
   */
  notChecked?: { path: string; message: string }[];
}

export type Format = "text" | "concise" | "json" | "sarif" | "github";

export interface RenderOptions {
  /** Indent JSON and SARIF. Adapters turn this off when a program, not a person, reads stdout. */
  pretty?: boolean;
  /**
   * ANSI colours in `text` output; `concise` stays plain. The adapter decides
   * (TTY, NO_COLOR, FORCE_COLOR).
   */
  color?: boolean;
  /** Render at most this many diagnostics, errors first. The summary still counts all of them. */
  maxDiagnostics?: number | undefined;
}

/** A report plus the diagnostics to print and the ones `maxDiagnostics` cut. */
interface View extends Report {
  shown: Diagnostic[];
  cut: Diagnostic[];
}

/**
 * Formats a report as text, concise text, JSON, SARIF or GitHub workflow commands.
 * The engine only builds strings; the adapter decides where they go and
 * whether to indent or colour them.
 *
 * @param report - the diagnostics plus file count and timing.
 * @param format - `text` for people, `concise` (one line each) for agents on
 *   a token budget, `json` (`inwards/diagnostics@1`) or `sarif` for tools,
 *   `github` for annotations in a GitHub Actions log.
 * @param options - how to lay the output out.
 * @param options.pretty - indent JSON and SARIF (default true).
 * @param options.color - add ANSI colour codes to text (default false).
 * @param options.maxDiagnostics - show at most this many diagnostics; the rest are counted.
 * @returns the rendered report, without a trailing newline.
 */
export function render(
  report: Report,
  format: Format,
  { pretty = true, color = false, maxDiagnostics }: RenderOptions = {},
): string {
  // Code scanning should see every finding, so SARIF is never capped.
  const view = cap(report, format === "sarif" ? undefined : maxDiagnostics);
  const indent = pretty ? 2 : undefined;
  if (format === "json") {
    return renderJson(view, indent);
  }
  if (format === "sarif") {
    return renderSarif(view, indent);
  }
  if (format === "github") {
    return renderGithub(view.shown, view.notChecked, footer(view, PLAIN).map(oneLine));
  }
  return format === "concise" ? renderConcise(view) : renderText(view, color ? ANSI : PLAIN);
}

/**
 * Splits the diagnostics into the ones to print and the ones over the cap.
 * Errors go first when there is a cap to fill, so warnings never push an
 * error out; without a cut the report order stays as it is.
 *
 * @param report - the full report.
 * @param max - the cap, or undefined for none.
 * @returns the report with `shown` and `cut`.
 */
function cap(report: Report, max: number | undefined): View {
  const all = report.diagnostics;
  if (max === undefined || all.length <= max) {
    return { ...report, shown: all, cut: [] };
  }
  const ordered = [
    ...all.filter((d) => d.severity === "error"),
    ...all.filter((d) => d.severity !== "error"),
  ];
  return { ...report, shown: ordered.slice(0, max), cut: ordered.slice(max) };
}

type Style = "bold" | "dim" | "red" | "green" | "cyan";
type Paint = Record<Style, (s: string) => string>;

/** SGR parameters, see ECMA-48. */
const SGR_CODES: Record<Style, number> = { bold: 1, dim: 2, red: 31, green: 32, cyan: 36 };

/**
 * Makes a function that wraps text in one ANSI style and a reset.
 *
 * @param style - the style to apply.
 * @returns a function from plain text to styled text.
 */
function sgr(style: Style): (s: string) => string {
  const code = SGR_CODES[style];
  return (s: string): string => `\x1b[${code}m${s}\x1b[0m`;
}

const ANSI: Paint = {
  bold: sgr("bold"),
  dim: sgr("dim"),
  red: sgr("red"),
  green: sgr("green"),
  cyan: sgr("cyan"),
};
const PLAIN: Paint = { bold: String, dim: String, red: String, green: String, cyan: String };

/**
 * Renders the human-readable report.
 * One block per diagnostic (location, code, message, numbered fix steps,
 * docs link), blank lines between blocks, then a one-line summary.
 *
 * @param report - the report and the diagnostics to print.
 * @param c - the palette: ANSI styles, or identity functions for plain text.
 * @returns the text report.
 */
function renderText(report: View, c: Paint): string {
  const lines = report.shown.map((d) =>
    [
      `${c.bold(`${d.file}:${d.line}:${d.column}:`)} ${codeLabel(d, c)} ${d.message}`,
      `  ${c.green("fix:")} ${d.fix.summary}`,
      ...d.fix.steps.map((s, i) => `    ${c.cyan(`${i + 1}.`)} ${s}`),
      `  ${c.dim(`docs: ${d.docs}`)}`,
    ].join("\n"),
  );
  return [...lines, ...footer(report, c)].join("\n\n");
}

/**
 * Renders one line per diagnostic: location, code, message (which names the
 * import target) and the first fix step, then the summary. Under a third of
 * the tokens of one JSON diagnostic; `docs` and the later steps are left out.
 * Never coloured: agents read it, and hosts often set FORCE_COLOR.
 *
 * @param report - the report and the diagnostics to print.
 * @returns the concise report.
 */
function renderConcise(report: View): string {
  const lines = report.shown.map((d) =>
    oneLine(
      `${d.file}:${d.line}:${d.column}: ${codeLabel(d, PLAIN)} ${d.message} fix: ${d.fix.steps[0] ?? d.fix.summary}`,
    ),
  );
  return [...lines, ...footer(report, PLAIN)].join("\n");
}

/**
 * Folds line breaks into single spaces, so a diagnostic stays on one line:
 * a wrapped `from x import (\n a,\n)` statement is quoted in the fix step,
 * and a string literal or file name can hold a newline.
 *
 * @param text - one diagnostic's line.
 * @returns the same text with every line break (and the spaces around it) as one space.
 */
function oneLine(text: string): string {
  return text.replace(LINE_BREAKS, " ");
}

/**
 * Builds the lines under the diagnostics: a warning per named path that gave
 * nothing to check, the totals, what the cap left out, and the baseline note.
 * With nothing checked at all the totals say so instead of "All clear".
 *
 * @param report - the report and the diagnostics cut from it.
 * @param c - the palette.
 * @returns one line or more.
 */
function footer(report: View, c: Paint): string[] {
  const { diagnostics, filesChecked, durationMs, cut, notChecked = [] } = report;
  const ms = c.dim(`(${durationMs.toFixed(1)} ms)`);
  const files = plural(filesChecked, "file");
  const { errors, warnings } = counts(diagnostics);
  const warned = warnings === 0 ? "" : `, ${plural(warnings, "warning")}`;
  const nothing = filesChecked === 0 && notChecked.length > 0;
  const clear = nothing
    ? `${c.red(c.bold("Nothing checked:"))} ${files} ${ms}.`
    : `${c.green(c.bold("All clear:"))} ${files}, 0 violations${warned} ${ms}.`;
  const tail =
    errors === 0
      ? clear
      : `${c.red(c.bold("Found"))} ${plural(errors, "violation")}${warned} in ${files} ${ms}.`;
  const hidden = counts(cut);
  const omitted = [
    hidden.errors === 0 ? "" : plural(hidden.errors, "violation"),
    hidden.warnings === 0 ? "" : plural(hidden.warnings, "warning"),
  ].filter((part) => part !== "");
  const note = omitted.length === 0 ? [] : [`Not shown: ${omitted.join(", ")}.`];
  const suppressed = report.suppressed?.length ?? 0;
  const inline =
    suppressed === 0 ? [] : [`${plural(suppressed, "finding")} suppressed by inline comments.`];
  const skipped = notChecked.map((n) => `${c.bold("warning:")} ${oneLine(n.message)}`);
  return [...skipped, tail, ...note, ...baselineNote(report), ...inline];
}

/**
 * Says what the baseline accepted and what has been fixed since it was taken.
 *
 * @param report - the check's report.
 * @param report.baselined - violations the baseline accepted.
 * @param report.resolved - baseline entries no longer found.
 * @returns zero or one line.
 */
function baselineNote({ baselined = 0, resolved = 0 }: Report): string[] {
  const parts = [
    baselined === 0 ? "" : `${plural(baselined, "violation")} accepted by the baseline.`,
    resolved === 0
      ? ""
      : `${plural(resolved, "baselined violation")} fixed since: run \`inwards baseline\` to drop ${resolved === 1 ? "it" : "them"}.`,
  ].filter((part) => part !== "");
  return parts.length === 0 ? [] : [parts.join(" ")];
}

/**
 * Labels a diagnostic's code: an error in red, a warning marked as one.
 *
 * @param d - the diagnostic.
 * @param c - the palette.
 * @returns the styled label.
 */
function codeLabel(d: Diagnostic, c: Paint): string {
  return d.severity === "error" ? c.red(c.bold(d.code)) : c.bold(`${d.code} (warning)`);
}

/**
 * Counts errors and warnings. `violations` in every report means errors,
 * which are what the exit code follows.
 *
 * @param diagnostics - the findings a report shows.
 * @returns how many are errors and how many warnings.
 */
function counts(diagnostics: readonly Diagnostic[]): { errors: number; warnings: number } {
  const errors = diagnostics.filter((d) => d.severity === "error").length;
  return { errors, warnings: diagnostics.length - errors };
}

/**
 * Writes a count with its noun, adding "s" unless the count is 1.
 *
 * @param n - the count.
 * @param word - the singular noun.
 * @returns e.g. `1 file` or `3 files`.
 */
function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/**
 * Renders the `inwards/diagnostics@1` JSON report.
 * Stable, versioned shape. Agents parse this, so fields are only ever added.
 * The duration is rounded to 0.1 ms. `summary` counts every diagnostic;
 * `omitted` appears only when a cap cut some, `suppressed` only when
 * inline comments hid some, and the top-level `notChecked` only when a named
 * path gave no file to check.
 *
 * @param report - the report and the diagnostics to print.
 * @param indent - spaces per level, or undefined for one line.
 * @returns the JSON document.
 */
function renderJson(report: View, indent?: number): string {
  const { diagnostics, filesChecked, durationMs, baselined, resolved, shown, cut } = report;
  const suppressed = report.suppressed?.length ?? 0;
  const notChecked = report.notChecked ?? [];
  return JSON.stringify(
    {
      schema: "inwards/diagnostics@1",
      summary: {
        filesChecked,
        violations: counts(diagnostics).errors,
        warnings: counts(diagnostics).warnings,
        ...(baselined === undefined ? {} : { baselined }),
        ...(resolved === undefined ? {} : { resolved }),
        ...(cut.length === 0 ? {} : { omitted: cut.length }),
        ...(suppressed === 0 ? {} : { suppressed }),
        durationMs: Math.round(durationMs * 10) / 10,
      },
      ...(notChecked.length === 0 ? {} : { notChecked }),
      diagnostics: shown,
    },
    null,
    indent,
  );
}

/**
 * Turns a forward-slash file path into a relative URI reference.
 * Each segment is percent-encoded on its own, so `#`, `?` and spaces in file
 * names stay part of the path instead of starting a fragment or a query.
 *
 * @param path - a relative path with `/` separators.
 * @returns the path as a URI reference, e.g. `shop/order%231.py`.
 */
function toUriPath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

/**
 * Renders the report as SARIF 2.1.0.
 * Enough for GitHub code scanning and most IDE viewers. `rules[]` lists every
 * registered rule, an opt-in one with `defaultConfiguration.enabled = false`.
 * Each result carries
 * the fix as text and as a `fix` property; file URIs are relative to
 * `%SRCROOT%`. A finding an inline comment hid is a result too, with an
 * `inSource` suppression whose justification is the comment's reason, so
 * viewers show it as suppressed rather than lose it. A named path that gave
 * nothing to check is a warning notification on the run's invocation, since
 * it is about the run and not a finding in code.
 *
 * @param report - the report as capped for display; the counts and the cut are not part of SARIF.
 * @param report.shown - the diagnostics to print.
 * @param report.suppressed - the findings inline comments hid, printed as suppressed results.
 * @param report.notChecked - the named paths that gave no file to check.
 * @param report.filesChecked - how many files were checked; none means the run failed.
 * @param indent - spaces per level, or undefined for one line.
 * @returns the SARIF log.
 */
function renderSarif(
  { shown, suppressed = [], notChecked = [], filesChecked }: View,
  indent?: number,
): string {
  return JSON.stringify(
    {
      // biome-ignore lint/style/useNamingConvention: SARIF names this key "$schema".
      $schema: "https://json.schemastore.org/sarif-2.1.0.json",
      version: "2.1.0",
      runs: [
        {
          tool: {
            driver: {
              name: "inwards",
              informationUri: DOCS_BASE,
              version: VERSION,
              rules: Object.values(RULES).map((rule) => ({
                id: rule.code,
                name: rule.name,
                shortDescription: { text: rule.summary },
                helpUri: rule.docs,
                defaultConfiguration: {
                  level: rule.severity,
                  ...(rule.default === "off" ? { enabled: false } : {}),
                },
              })),
            },
          },
          ...(notChecked.length === 0
            ? {}
            : {
                invocations: [
                  {
                    executionSuccessful: filesChecked > 0,
                    toolExecutionNotifications: notChecked.map(({ path, message }) => ({
                      level: "warning",
                      message: { text: message },
                      locations: [
                        {
                          physicalLocation: {
                            artifactLocation: { uri: toUriPath(path), uriBaseId: "%SRCROOT%" },
                          },
                        },
                      ],
                    })),
                  },
                ],
              }),
          results: [
            ...shown.map(sarifResult),
            ...suppressed.map(({ diagnostic, reason }) => ({
              ...sarifResult(diagnostic),
              suppressions: [{ kind: "inSource", justification: reason }],
            })),
          ],
        },
      ],
    },
    null,
    indent,
  );
}

/**
 * Builds one SARIF result from a diagnostic.
 *
 * @param d - the diagnostic.
 * @returns the result object.
 */
function sarifResult(d: Diagnostic): Record<string, unknown> {
  return {
    ruleId: d.code,
    level: d.severity,
    message: {
      text: `${d.message}\nFix: ${d.fix.summary}\n${d.fix.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}`,
    },
    locations: [
      {
        physicalLocation: {
          // Relative to where `inwards check` ran; CI runs it from the checkout root.
          artifactLocation: { uri: toUriPath(d.file), uriBaseId: "%SRCROOT%" },
          region: {
            startLine: d.line,
            startColumn: d.column,
            endLine: d.endLine,
            endColumn: d.endColumn,
          },
        },
      },
    ],
    properties: { fix: d.fix },
  };
}
