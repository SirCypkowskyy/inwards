/**
 * @file The engine's entry for the diagram rules (ADR-045): it reads the
 * marked Mermaid and PlantUML diagrams out of the files the adapter passes and runs
 * INW017 (with the `diagrams` entries that matched no file) and INW018 on
 * them, runs INW019 on them and the imports a whole-project check collected,
 * and reads the config a diagram stands for, for `inwards
 * import-diagram`. The adapter does the reading and the globbing
 * (`diagramBase`, `diagramMatches`); nothing here touches a file.
 */
import type { InwardsConfig } from "../config/parse.ts";
import { ruleLevel } from "../config/rule-settings.ts";
import type { ConfigFile } from "../config/source-span.ts";
import type { Diagnostic, DiagramDraft, DiagramSource } from "../contracts/records.ts";
import { draftFromSource } from "../diagram/draft.ts";
import { readDiagrams } from "../diagram/read.ts";
import { checkDiagramEdges } from "../rules/diagram-forbidden-edge/check.ts";
import { missingDependencies } from "../rules/diagram-missing-dependency/check.ts";
import { checkDiagramEntries, checkDiagramNames } from "../rules/diagram-unknown-name/check.ts";
import { type Collected, type CycleInputs, confirmImports } from "./cycles.ts";

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
  const diagrams = input.sources.flatMap(readDiagrams);
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

/**
 * Finds the imports the marked diagrams leave out (INW019), on the imports a
 * whole-project check collected. A finding that stands on a file only the
 * skeleton read (which can take an import line inside a string for an
 * import) has that file read with the full parse first, and the diagrams are
 * judged again, until every finding stands on the full parse. Nothing is read
 * when INW019 is off or no diagram is listed.
 *
 * @param collected - every checked file's imports, updated in place as files are confirmed.
 * @param inputs - the config, the diagram files and the full-parse reader.
 * @param inputs.config - the layers, contexts and `[tool.inwards.rules]`.
 * @param inputs.sources - the files the `diagrams` entries matched, with report paths.
 * @param inputs.fullImports - reads a file's imports with the full parse, up to a line.
 * @returns INW019's findings, before `[tool.inwards.rules]`.
 */
export function projectDiagramImports(
  collected: readonly Collected[],
  {
    config,
    sources,
    fullImports,
  }: {
    config: InwardsConfig;
    sources: readonly DiagramSource[];
    fullImports: CycleInputs["fullImports"];
  },
): Diagnostic[] {
  if (sources.length === 0 || ruleLevel("INW019", config.rules) === "off") {
    return [];
  }
  const diagrams = sources.flatMap(readDiagrams);
  for (;;) {
    const missing = missingDependencies(config, diagrams, collected);
    const behind = new Set(missing.map((found) => found.file.path));
    const reread = confirmImports(
      collected.filter((entry) => behind.has(entry.file.path)),
      fullImports,
    );
    if (reread.length === 0) {
      return missing.map((found) => found.diagnostic);
    }
  }
}
