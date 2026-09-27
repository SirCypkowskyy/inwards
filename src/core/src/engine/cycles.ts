/**
 * @file Whole-project import cycles (INW004) on top of a check: the engine
 * collects every checked file's imports as it goes, and this module finds the
 * cycles among them. The import skeleton can read an import that isn't one
 * (inside a string, or in a file the parser recovers from), and a spurious
 * edge can join two groups into one. So every file with an edge inside a
 * cyclic group that only the skeleton read is read again with the full
 * parse, and the cycles are found again, until each group stands on imports
 * the full parse found. Projects without cycles never pay for it, and it
 * stays cheap: a file that holds only imports, comments and blank lines up to
 * its last import needs no parse, since its skeleton is its text there
 * (`onlyImportsUpTo`); and since the skeleton never misses an import, the
 * full parse of any other file can stop after its last import line
 * (`Extractor.importsUpTo`). Only the files the check parses take part.
 */
import type { ContextSpec } from "../config/contexts.ts";
import type { CycleMode } from "../config/cycles.ts";
import { CONFIG_DEFAULTS } from "../config/defaults.ts";
import type { Diagnostic, ImportRef, SourceFile } from "../contracts/records.ts";
import { onlyImportsUpTo } from "../python/prescan.ts";
import {
  cycleDiagnostic,
  type FileImports,
  fileEdges,
  findCycles,
  searches,
} from "../rules/import-cycles/cycles.ts";

/** A checked file's imports, and whether a full parse read them. */
export interface Collected extends FileImports {
  /** True when the imports come from the full parse, not the skeleton alone. */
  exact: boolean;
}

/** What the cycle search needs from the config and the engine. */
export interface CycleInputs {
  /** `cycles` from the config; unset means the default. */
  modes: readonly CycleMode[] | undefined;
  contexts: readonly ContextSpec[];
  /**
   * Reads a file's imports with the full parse, which may stop after the
   * line where the skeleton's last import ends (`Extractor.importsUpTo`).
   *
   * @param file - a checked file, with normalised text.
   * @param lastLine - the 1-based line where the skeleton's last import ends.
   * @returns its static imports.
   */
  fullImports: (file: SourceFile, lastLine: number) => readonly ImportRef[];
}

/**
 * Finds the import cycles among the checked files, confirming every file
 * inside a cyclic group with a full parse first.
 *
 * @param collected - every checked file's imports, updated in place as files are confirmed.
 * @param inputs - the modes, contexts, module lookup and full-parse reader.
 * @returns one INW004 diagnostic per cycle.
 */
export function projectCycles(collected: Collected[], inputs: CycleInputs): Diagnostic[] {
  const modes = inputs.modes ?? CONFIG_DEFAULTS.cycles;
  if (!searches(modes, inputs.contexts)) {
    return [];
  }
  const nodes = new Set(collected.map((entry) => entry.file.module));
  const sorted = [...collected].sort((a, b) => a.file.path.localeCompare(b.file.path));
  const edges = new Map(sorted.map((entry) => [entry, fileEdges(entry, nodes)]));
  for (;;) {
    const cycles = findCycles([...edges.values()].flat(), modes, inputs.contexts);
    const inside = new Set(cycles.flatMap((cycle) => cycle.inside.map((edge) => edge.file.path)));
    const unconfirmed = sorted.filter((entry) => {
      if (entry.exact || !inside.has(entry.file.path)) {
        return false;
      }
      // A file that opens with its imports needs no parse: its skeleton is its text.
      const lastName = Math.max(0, ...entry.imports.map((ref) => ref.endLine));
      entry.exact = onlyImportsUpTo(entry.file.text, lastName);
      return !entry.exact;
    });
    if (unconfirmed.length === 0) {
      return cycles.flatMap((cycle) => {
        const found = cycleDiagnostic(cycle);
        return found === undefined ? [] : [found];
      });
    }
    for (const entry of unconfirmed) {
      entry.imports = inputs.fullImports(entry.file, lastLineOf(entry));
      entry.exact = true;
      edges.set(entry, fileEdges(entry, nodes));
    }
  }
}

/**
 * Finds a line by which every import of a file has ended: a reference spans
 * one imported name, and its statement can't end later than that name's line
 * plus the statement's line breaks.
 *
 * @param entry - a checked file and its imports.
 * @returns the 1-based line, 0 for no imports.
 */
function lastLineOf(entry: Collected): number {
  return Math.max(
    0,
    ...entry.imports.map((ref) => ref.line + ref.statement.split("\n").length - 1),
  );
}
