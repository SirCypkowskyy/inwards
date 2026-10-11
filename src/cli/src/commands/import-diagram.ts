/**
 * @file `inwards import-diagram FILE [--write]`: turns the marked Mermaid
 * diagrams of one file into a `[tool.inwards]` table (ADR-045), so the docs
 * can drive the config once and INW017 and INW018 keep the two in step after
 * that. It prints the table on stdout and what to finish by hand on stderr,
 * or with `--write` appends the table to the pyproject.toml in the working
 * directory.
 *
 * It never overwrites an existing `[tool.inwards]`, and checks that the table
 * parses before printing or writing it. What a diagram means is the engine's
 * (`draftDiagrams`); the TOML is `init/diagram-table.ts`'s; this module only
 * reads, picks the root and writes.
 */
import { isAbsolute, join, resolve } from "node:path";
import { ConfigError, type DiagramDraft, draftDiagrams } from "@inwards/core";
import { renderDiagramToml } from "../init/diagram-table.ts";
import { shown, sourceRoot } from "../init/target.ts";
import { print } from "../platform/print.ts";
import { appendTable, parsedTable } from "./append-table.ts";
import type { AppDeps } from "./deps.ts";

/** The command's name, as messages start with it. */
const COMMAND = "inwards import-diagram";

/**
 * Runs `inwards import-diagram`.
 *
 * @param deps - the platform, init's TOML parser and file writer.
 * @param args - the positionals after the command: exactly one, the diagram file.
 * @param opts - the options that apply.
 * @param opts.write - `--write`: append the table to pyproject.toml in the working directory.
 * @param opts.config - `--config`, which this command refuses: FILE names its input.
 * @param usage - the usage text, printed for unexpected arguments.
 * @returns 0 once printed or written; 2 for bad arguments, a file without a
 *   usable diagram, a table that doesn't parse, or a pyproject.toml that
 *   already has `[tool.inwards]`.
 * @throws when a file can't be read or written.
 */
export function importDiagramCommand(
  deps: AppDeps,
  args: readonly string[],
  opts: { write?: boolean | undefined; config?: string | undefined },
  usage: string,
): number {
  const { io } = deps;
  const [file] = args;
  if (file === undefined || args.length > 1 || opts.config !== undefined) {
    return print(io.streams, usage, 2);
  }
  const { cwd } = io.runtime;
  const path = resolve(cwd, file);
  const source = shown(cwd, path);
  if (io.probe.kind(path) !== "file") {
    return print(io.streams, `${COMMAND}: ${file}: no such file.`, 2);
  }
  const draft = draftDiagrams({ path: source, text: io.read.text(path) });
  if (typeof draft === "string") {
    return print(io.streams, `${COMMAND}: ${draft}`, 2);
  }
  const pyproject = join(cwd, "pyproject.toml");
  const text = io.probe.kind(pyproject) === "file" ? io.read.text(pyproject) : undefined;
  const first = draft.layers.flat().find((layer) => layer.modules.length > 0)?.modules[0] ?? "";
  const root = sourceRoot({ ...io, toml: deps.init.toml }, cwd, first, text ?? "");
  const entry = source.startsWith("../") || isAbsolute(source) ? undefined : source;
  const table = renderDiagramToml(draft, { source, root, entry });
  const check = parsedTable(table);
  if (check instanceof ConfigError) {
    return print(
      io.streams,
      `${COMMAND}: the table read from ${source} doesn't parse: ${check.message} Fix the diagram and run it again.`,
      2,
    );
  }
  const notes = report(draft, source, entry);
  if (opts.write !== true) {
    io.streams.out(table);
    io.streams.err(notes);
    return 0;
  }
  const problem = appendTable(deps, { path: pyproject, text }, table, "import-diagram");
  if (problem !== undefined) {
    return print(io.streams, `${COMMAND}: ${problem}`, 2);
  }
  io.streams.err(notes);
  return print(io.streams, `${COMMAND}: wrote [tool.inwards] to ${shown(cwd, pyproject)}.`, 0);
}

/**
 * Writes what was read and what is left to finish by hand.
 *
 * @param draft - the layers, contexts and notes.
 * @param source - the diagram file as the user names it.
 * @param entry - its `diagrams` entry, or undefined when it lies outside the project.
 * @returns the report, one line each, ending with a newline.
 */
function report(draft: DiagramDraft, source: string, entry: string | undefined): string {
  const layers = draft.layers.flat().length;
  const lines = [
    `${COMMAND}: read ${layers} ${layers === 1 ? "layer" : "layers"} and ${draft.contexts.length} ${draft.contexts.length === 1 ? "context" : "contexts"} from ${source}.`,
    ...draft.notes.map((note) => `  ${note}`),
  ];
  if (entry === undefined) {
    lines.push(
      `  ${source} lies outside the working directory, so the table doesn't list it in diagrams; move it into the project to keep it checked.`,
    );
  }
  lines.push(
    "Run `inwards check` next: INW017 and INW018 then keep the diagram and the config in step.",
  );
  return `${lines.join("\n")}\n`;
}
