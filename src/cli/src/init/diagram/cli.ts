/**
 * @file The two commands between `[tool.inwards]` and architecture diagrams.
 * `inwards import-diagram FILE [--write]` turns the marked Mermaid and
 * PlantUML diagrams of one file into a `[tool.inwards]` table (ADR-045), so
 * the docs can drive the config once and INW017 and INW018 keep the two in
 * step after that. It prints the table on stdout and what to finish by hand
 * on stderr, or with `--write` appends the table to the pyproject.toml in the
 * working directory. It never overwrites an existing `[tool.inwards]`, and
 * checks that the table parses before printing or writing it.
 *
 * `inwards diagram [--layers|--contexts] [--format mermaid|plantuml]` goes
 * the other way (#349): it prints `[tool.inwards]` as a marked diagram on
 * stdout, ready for a `.mmd` or `.puml` file or a fenced block, and what it
 * can't show on stderr. It writes no file.
 *
 * What a diagram means and how one is drawn are the engine's
 * (`draftDiagrams`, `writeDiagram`); the TOML is `_table.ts`'s; this module
 * only reads, checks the flags, picks the root and writes.
 */
import { isAbsolute, join, resolve } from "node:path";
import {
  ConfigError,
  type DiagramDraft,
  type DiagramKind,
  type DiagramNotation,
  draftDiagrams,
  parseConfig,
  writeDiagram,
} from "@inwards/core";
import { commandConfig } from "../../check/index.ts";
import type { AppDeps } from "../../deps.ts";
import { print } from "../../shared/platform/print.ts";
import { appendTable, parsedTable } from "../_append-table.ts";
import { shown, sourceRoot } from "../_target.ts";
import { renderDiagramToml } from "./_table.ts";

/** `inwards import-diagram`, as its messages start with it. */
const COMMAND = "inwards import-diagram";
/** `inwards diagram`, as its messages start with it. */
const DIAGRAM = "inwards diagram";

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

/** The flags `inwards diagram` reads. */
export interface DiagramOptions {
  config?: string | undefined;
  /** `--format`: mermaid (the default) or plantuml. */
  format?: string | undefined;
  layers?: boolean | undefined;
  contexts?: boolean | undefined;
}

/**
 * Runs `inwards diagram`.
 *
 * @param deps - the platform: the config's path, its text and the streams.
 * @param args - the positionals after the command; there must be none.
 * @param opts - the flags.
 * @param usage - the usage text, printed for unexpected arguments.
 * @returns 0 once printed; 2 for bad arguments, no config, or `--contexts`
 *   with a config that declares no contexts.
 * @throws {ConfigError} when the config is invalid; when it can't be read.
 */
export function diagramCommand(
  deps: Pick<AppDeps, "io">,
  args: readonly string[],
  opts: DiagramOptions,
  usage: string,
): number {
  const { io } = deps;
  const notation = notationOf(opts.format);
  if (args.length > 0 || (opts.layers === true && opts.contexts === true)) {
    return print(io.streams, usage, 2);
  }
  if (notation === undefined) {
    return print(
      io.streams,
      `${DIAGRAM}: unknown --format ${opts.format ?? ""}; use mermaid or plantuml.`,
      2,
    );
  }
  const found = commandConfig(io, opts.config);
  if ("problem" in found) {
    return print(io.streams, found.problem, 2);
  }
  const config = parseConfig(io.read.text(found.path));
  const kind: DiagramKind = opts.contexts === true ? "contexts" : "layers";
  if (kind === "contexts" && (config.contexts ?? []).length === 0) {
    return print(
      io.streams,
      `${DIAGRAM}: [tool.inwards] declares no contexts, so there is no contexts diagram; leave out --contexts for the layers.`,
      2,
    );
  }
  const { text, notes } = writeDiagram(config, kind, notation);
  io.streams.out(text);
  for (const note of notes) {
    io.streams.err(`${DIAGRAM}: ${note}\n`);
  }
  return 0;
}

/**
 * Reads `--format`: mermaid when it is left out.
 *
 * @param format - the flag's value, if given.
 * @returns the notation, or undefined for a value that names none.
 */
function notationOf(format: string | undefined): DiagramNotation | undefined {
  if (format === undefined || format === "mermaid") {
    return "mermaid";
  }
  return format === "plantuml" ? "plantuml" : undefined;
}
