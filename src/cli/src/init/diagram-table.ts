/**
 * @file Renders what `inwards import-diagram` read out of a marked diagram
 * (ADR-045) as a `[tool.inwards]` table: the `diagrams` entry that keeps the
 * diagram checked, the layers with their sibling groups, the contexts with
 * `public` and `depends-on`, and INW017 and INW018 turned on. Pure text: the
 * command checks that it parses and decides where it goes.
 */
import type { DiagramDraft } from "@inwards/core";
import { array, placeLines, quoted } from "./import-linter/render.ts";

/**
 * Renders the draft as a `[tool.inwards]` table.
 *
 * @param draft - what the diagram stands for.
 * @param opts - where it came from and the module root.
 * @param opts.source - the diagram file as the user names it, for the comment on top.
 * @param opts.root - the config root, `.` (left out) or `src`.
 * @param opts.entry - the `diagrams` entry for the file, relative to the
 *   pyproject.toml; undefined when the file lies outside the project.
 * @returns the TOML text, ending with a newline.
 */
export function renderDiagramToml(
  draft: DiagramDraft,
  opts: { source: string; root: string; entry: string | undefined },
): string {
  const lines = [`# Converted from ${opts.source} by inwards import-diagram.`, "[tool.inwards]"];
  if (opts.root !== ".") {
    lines.push(`root = ${quoted(opts.root)}`);
  }
  if (opts.entry !== undefined) {
    lines.push(`diagrams = ${array([opts.entry])}`);
  }
  lines.push("layers = [");
  lines.push(
    ...draft.layers.flatMap((place) => placeLines(place.map((layer) => ({ ...layer, deny: [] })))),
  );
  lines.push("]");
  for (const context of draft.contexts) {
    lines.push(
      "",
      "[[tool.inwards.contexts]]",
      `name = ${quoted(context.name)}`,
      `modules = ${array(context.modules)}`,
      `public = ${array(context.public)}`,
      `depends-on = ${array(context.dependsOn)}`,
    );
  }
  if (opts.entry !== undefined) {
    lines.push("", "[tool.inwards.rules]", `extend-select = ${array(["INW017", "INW018"])}`);
  }
  return `${lines.join("\n")}\n`;
}
