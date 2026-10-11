/**
 * @file The engine's entry for the diagram rules (ADR-045): it reads the
 * marked Mermaid diagrams out of the files the adapter passes and runs
 * INW017 on them, with the `diagrams` entries that matched no file. The
 * adapter does the reading and the globbing (`diagramBase`,
 * `diagramMatches`); nothing here touches a file.
 */
import type { InwardsConfig } from "../config/parse.ts";
import type { ConfigFile } from "../config/source-span.ts";
import type { Diagnostic, DiagramSource } from "../contracts/records.ts";
import { markedBlocks } from "../diagram/blocks.ts";
import { readFlowchart } from "../diagram/mermaid.ts";
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
 * @returns INW017's findings, after `[tool.inwards.rules]`.
 */
export function checkDiagrams(config: InwardsConfig, input: DiagramInput): Diagnostic[] {
  const diagrams = input.sources.flatMap((source) =>
    markedBlocks(source).map((block) => readFlowchart(block, source.path)),
  );
  return [
    ...checkDiagramEntries(config, input.unmatched, input.configFile),
    ...checkDiagramNames({ config, modules: input.modules, diagrams }),
  ];
}
