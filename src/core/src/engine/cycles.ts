/**
 * @file Whole-project import cycles (INW004) on top of a check: the engine
 * collects every checked file's imports as it goes, and this module finds the
 * cycles among them. The import skeleton can read an import that isn't one
 * (inside a string, or in a malformed file), and a spurious edge can join two
 * groups into one. So every file with an edge inside a cyclic group whose
 * skeleton isn't certain (`skeletonIsCertain`) is read again with the full
 * parse, and the cycles are found again, until each group stands on imports
 * the full parse would find. Only the files the check parses take part.
 */
import type { ContextSpec } from "../config/contexts.ts";
import type { CycleMode } from "../config/cycles.ts";
import { CONFIG_DEFAULTS } from "../config/defaults.ts";
import type { Diagnostic, ImportRef, SourceFile } from "../contracts/records.ts";
import { skeletonIsCertain } from "../python/import-certainty.ts";
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
   * Reads a file's imports with the full parse.
   *
   * @param file - a checked file, with normalised text.
   * @returns its static imports.
   */
  fullImports: (file: SourceFile) => readonly ImportRef[];
}

/**
 * Finds the import cycles among the checked files, confirming every
 * uncertain file inside a cyclic group with a full parse first.
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
      const lastLine = Math.max(0, ...entry.imports.map((ref) => ref.endLine));
      entry.exact = skeletonIsCertain(entry.file.text, lastLine); // cheap, so it runs before a full parse
      return !entry.exact;
    });
    if (unconfirmed.length === 0) {
      return cycles.flatMap((cycle) => {
        const found = cycleDiagnostic(cycle);
        return found === undefined ? [] : [found];
      });
    }
    for (const entry of unconfirmed) {
      entry.imports = inputs.fullImports(entry.file);
      entry.exact = true;
      edges.set(entry, fileEdges(entry, nodes));
    }
  }
}
