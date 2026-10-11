/**
 * @file The engine's entry for the diagram rules (ADR-045): it reads the
 * marked Mermaid diagrams out of the files the adapter passes and runs
 * INW017 (with the `diagrams` entries that matched no file) and INW018 on
 * them, and reads the config a diagram stands for, for `inwards
 * import-diagram`. The adapter does the reading and the globbing
 * (`diagramBase`, `diagramMatches`); nothing here touches a file.
 */
import type { InwardsConfig } from "../config/parse.ts";
import type { ConfigFile } from "../config/source-span.ts";
import type { Diagnostic, DiagramDraft, DiagramSource } from "../contracts/records.ts";
import { markedBlocks } from "../diagram/blocks.ts";
import { draftFromSource } from "../diagram/draft.ts";
import { readFlowchart } from "../diagram/mermaid.ts";
import { checkDiagramEdges } from "../rules/diagram-forbidden-edge/check.ts";
import { checkDiagramEntries, checkDiagramNames } from "../rules/diagram-unknown-name/check.ts";

/** What a whole-project run gives the diagram rules. */
export interface DiagramInput {
  /** Every first-party module of the project. */
  modules: ReadonlySet<string>;
  /** The files the `diagrams` entries matched, with report paths. */
  sources: readonly DiagramSource[];
  /** The `diagrams` entries that matched no file. */
  unmatched: readonly string[];
  /** The pyproject.toml, for findings about an entry. */
  configFile: ConfigFile;
}

/**
 * Checks a project's marked diagrams against its config and its modules.
 *
 * @param config - the project's config.
 * @param input - the modules, the diagram files and the unmatched entries.
 * @returns INW017's and INW018's findings, after `[tool.inwards.rules]`.
 */
export function checkDiagrams(config: InwardsConfig, input: DiagramInput): Diagnostic[] {
  const diagrams = input.sources.flatMap((source) =>
    markedBlocks(source).map((block) => readFlowchart(block, source.path)),
  );
  return [
    ...checkDiagramEntries(config, input.unmatched, input.configFile),
    ...checkDiagramNames({ config, modules: input.modules, diagrams }),
    ...checkDiagramEdges(config, diagrams),
  ];
}

/**
 * Reads the `[tool.inwards]` the marked diagrams of one file stand for
 * (`inwards import-diagram`): layers ranked by the longest path to a sink,
 * same-rank layers as siblings, contexts with `depends-on` and `public`.
 *
 * @param source - the file's path and text.
 * @returns the draft, or why there is none, starting with `path:line`.
 */
export function draftDiagrams(source: DiagramSource): DiagramDraft | string {
  return draftFromSource(source);
}
