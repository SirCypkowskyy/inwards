/**
 * @file `inwards diagram [--layers|--contexts] [--format mermaid|plantuml]`:
 * prints `[tool.inwards]` as a marked Mermaid or PlantUML diagram (#349), the
 * reverse of `inwards import-diagram`, so a team can start its architecture
 * docs from the config and let INW017 and INW018 keep them in step. The
 * diagram goes to stdout, ready for a `.mmd` or `.puml` file or a fenced
 * block; what it can't show goes to stderr.
 *
 * Drawing is the engine's (`writeDiagram`); this module only finds and parses
 * the config and checks the flags. It writes no file.
 */
import { type DiagramKind, type DiagramNotation, parseConfig, writeDiagram } from "@inwards/core";
import { print } from "../platform/print.ts";
import { commandConfig } from "../project/config-discovery.ts";
import type { AppDeps } from "./deps.ts";

/** The command's name, as messages start with it. */
const COMMAND = "inwards diagram";

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
      `${COMMAND}: unknown --format ${opts.format ?? ""}; use mermaid or plantuml.`,
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
      `${COMMAND}: [tool.inwards] declares no contexts, so there is no contexts diagram; leave out --contexts for the layers.`,
      2,
    );
  }
  const { text, notes } = writeDiagram(config, kind, notation);
  io.streams.out(text);
  for (const note of notes) {
    io.streams.err(`${COMMAND}: ${note}\n`);
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
