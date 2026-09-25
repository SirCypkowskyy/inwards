import { LAYER_RULE } from "./layers.ts";
import { DOCS_BASE, VERSION } from "./meta.ts";
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

export function render(
  report: Report,
  format: Format,
  { pretty = true, color = false }: RenderOptions = {},
): string {
  const indent = pretty ? 2 : undefined;
  if (format === "json") return renderJson(report, indent);
  if (format === "sarif") return renderSarif(report, indent);
  return renderText(report, color ? ANSI : PLAIN);
}

type Paint = Record<"bold" | "dim" | "red" | "green" | "cyan", (s: string) => string>;
const sgr = (code: number) => (s: string) => `\x1b[${code}m${s}\x1b[0m`;
const ANSI: Paint = { bold: sgr(1), dim: sgr(2), red: sgr(31), green: sgr(32), cyan: sgr(36) };
const PLAIN: Paint = { bold: String, dim: String, red: String, green: String, cyan: String };

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

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Stable, versioned shape. Agents parse this, so fields are only ever added. */
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

/** SARIF 2.1.0, enough for GitHub code scanning and most IDE viewers. */
function renderSarif({ diagnostics }: Report, indent?: number): string {
  return JSON.stringify(
    {
      $schema: "https://json.schemastore.org/sarif-2.1.0.json",
      version: "2.1.0",
      runs: [
        {
          tool: {
            driver: {
              name: "inwards",
              informationUri: DOCS_BASE,
              version: VERSION,
              rules: [
                {
                  id: LAYER_RULE.code,
                  name: LAYER_RULE.name,
                  shortDescription: { text: "Dependencies must point toward inner layers." },
                  helpUri: LAYER_RULE.docs,
                },
              ],
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
                  artifactLocation: { uri: encodeURI(d.file), uriBaseId: "%SRCROOT%" },
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
