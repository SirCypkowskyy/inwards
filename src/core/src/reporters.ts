import { DOCS_BASE, VERSION } from "./meta.ts";
import { RULES } from "./rules.ts";
import type { Diagnostic } from "./types.ts";

export interface Report {
  diagnostics: Diagnostic[];
  filesChecked: number;
  durationMs: number;
}

export type Format = "text" | "json" | "sarif";

export interface RenderOptions {
  /** Indent JSON and SARIF. Adapters turn this off when a program, not a person, reads stdout. */
  pretty?: boolean;
  /** ANSI colours in text output. The adapter decides (TTY, NO_COLOR, FORCE_COLOR). */
  color?: boolean;
}

/**
 * Formats a report as text, JSON or SARIF.
 * The engine only builds strings; the adapter decides where they go and
 * whether to indent or colour them.
 *
 * @param report - the diagnostics plus file count and timing.
 * @param format - `text` for people, `json` (`inwards/diagnostics@1`) or `sarif` for tools.
 * @param options - `pretty` indents JSON and SARIF (default true); `color`
 *   adds ANSI codes to text (default false).
 * @returns the rendered report, without a trailing newline.
 */
export function render(
  report: Report,
  format: Format,
  { pretty = true, color = false }: RenderOptions = {},
): string {
  const indent = pretty ? 2 : undefined;
  if (format === "json") {
    return renderJson(report, indent);
  }
  if (format === "sarif") {
    return renderSarif(report, indent);
  }
  return renderText(report, color ? ANSI : PLAIN);
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
 * @param report - the diagnostics plus file count and timing.
 * @param c - the palette: ANSI styles, or identity functions for plain text.
 * @returns the text report.
 */
function renderText({ diagnostics, filesChecked, durationMs }: Report, c: Paint): string {
  const lines = diagnostics.map((d) =>
    [
      `${c.bold(`${d.file}:${d.line}:${d.column}:`)} ${c.red(c.bold(d.code))} ${d.message}`,
      `  ${c.green("fix:")} ${d.fix.summary}`,
      ...d.fix.steps.map((s, i) => `    ${c.cyan(`${i + 1}.`)} ${s}`),
      `  ${c.dim(`docs: ${d.docs}`)}`,
    ].join("\n"),
  );
  const ms = c.dim(`(${durationMs.toFixed(1)} ms)`);
  const files = plural(filesChecked, "file");
  const tail =
    diagnostics.length === 0
      ? `${c.green(c.bold("All clear:"))} ${files}, 0 violations ${ms}.`
      : `${c.red(c.bold("Found"))} ${plural(diagnostics.length, "violation")} in ${files} ${ms}.`;
  return [...lines, tail].join("\n\n");
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
 * The duration is rounded to 0.1 ms.
 *
 * @param report - the diagnostics plus file count and timing.
 * @param indent - spaces per level, or undefined for one line.
 * @returns the JSON document.
 */
function renderJson({ diagnostics, filesChecked, durationMs }: Report, indent?: number): string {
  return JSON.stringify(
    {
      schema: "inwards/diagnostics@1",
      summary: {
        filesChecked,
        violations: diagnostics.length,
        durationMs: Math.round(durationMs * 10) / 10,
      },
      diagnostics,
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
 * Enough for GitHub code scanning and most IDE viewers. Each result carries
 * the fix as text and as a `fix` property; file URIs are relative to
 * `%SRCROOT%`.
 *
 * @param report - the diagnostics; the counts are not part of SARIF.
 * @param indent - spaces per level, or undefined for one line.
 * @returns the SARIF log.
 */
function renderSarif({ diagnostics }: Report, indent?: number): string {
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
                defaultConfiguration: { level: rule.severity },
              })),
            },
          },
          results: diagnostics.map((d) => ({
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
          })),
        },
      ],
    },
    null,
    indent,
  );
}
