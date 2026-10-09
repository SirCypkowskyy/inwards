/**
 * @file Renders what `inwards import-config` arrived at: the draft as a
 * `[tool.inwards]` table in TOML, and the per-contract report for the
 * terminal. Pure text: the command decides where each one goes.
 */
import type { Draft, DraftLayer, Outcome } from "./model.ts";

/** The width of the status column in the report (`partial`, the longest). */
const STATUS_WIDTH: number = "partial".length;

/**
 * Quotes a string for TOML: JSON's escapes are valid TOML basic strings.
 *
 * @param text - the raw string.
 * @returns the quoted string.
 */
function quoted(text: string): string {
  return JSON.stringify(text);
}

/**
 * Renders a list of strings as a one-line TOML array.
 *
 * @param items - the strings.
 * @returns such as `["a", "b"]`.
 */
function array(items: readonly string[]): string {
  return `[${items.map(quoted).join(", ")}]`;
}

/**
 * Renders one place in the layer order: an inline table, or a nested array
 * of them for sibling layers.
 *
 * @param place - the layers sharing the place, innermost place first in the list.
 * @returns the lines of the `layers` array that stand for it.
 */
function placeLines(place: readonly DraftLayer[]): string[] {
  const siblings = place.length > 1;
  const indent = siblings ? "    " : "  ";
  const rows = place.map((layer) => {
    const deny = layer.deny.length > 0 ? `, extend-deny-libraries = ${array(layer.deny)}` : "";
    return `${indent}{ name = ${quoted(layer.name)}, modules = ${array(layer.modules)}${deny} },`;
  });
  return siblings ? ["  [", ...rows, "  ],"] : rows;
}

/**
 * Renders the draft as a `[tool.inwards]` table.
 *
 * @param draft - the converted table.
 * @param opts - where it came from and the module root.
 * @param opts.source - the import-linter file's name, for the comment on top.
 * @param opts.root - the config root, `.` (left out) or `src`.
 * @returns the TOML text, ending with a newline.
 */
export function renderToml(draft: Draft, opts: { source: string; root: string }): string {
  const lines = [`# Converted from ${opts.source} by inwards import-config.`, "[tool.inwards]"];
  if (opts.root !== ".") {
    lines.push(`root = ${quoted(opts.root)}`);
  }
  lines.push("layers = [");
  lines.push(...draft.layers.flatMap(placeLines));
  lines.push("]");
  if (draft.ignore.length > 0) {
    lines.push(`ignore = ${array(draft.ignore)}`);
  }
  if (draft.contexts.length > 0) {
    lines.push("# The contexts only stand for forbidden imports; import-linter checked no cycles.");
    lines.push("cycles = []");
  }
  for (const context of draft.contexts) {
    lines.push(
      "",
      "[[tool.inwards.contexts]]",
      `name = ${quoted(context.module)}`,
      `modules = ${array([context.module])}`,
      `public = ${array([context.module])}`,
      `depends-on = ${array(context.dependsOn)}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Renders the verdicts for the terminal.
 *
 * @param outcomes - one per contract, in file order.
 * @param source - the import-linter file as the user would name it.
 * @returns the report: a summary, a line per contract with its reasons, and two notes.
 */
export function renderReport(outcomes: readonly Outcome[], source: string): string {
  const done = outcomes.filter((o) => o.status !== "skipped").length;
  const lines = [
    `inwards import-config: converted ${done} of ${outcomes.length} contracts from ${source}.`,
  ];
  const indent = `  ${" ".repeat(STATUS_WIDTH)} `;
  for (const o of outcomes) {
    lines.push(`  ${o.status.padEnd(STATUS_WIDTH)} ${o.contract}`);
    lines.push(...o.reasons.map((reason) => `${indent}${reason}`));
  }
  lines.push(
    "Inwards checks direct imports only: an import chain through a third module, which import-linter follows, isn't reported.",
    "Inwards also runs rules import-linter doesn't have (INW006 for code outside every layer, INW005's default deny list on the innermost layer, INW010, INW011): run `inwards check`, then `inwards baseline` to accept what is there today.",
  );
  return lines.join("\n");
}
