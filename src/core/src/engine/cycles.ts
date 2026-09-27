/**
 * @file Whole-project import cycles (INW004) on top of a check: the engine
 * collects every checked file's imports as it goes, and this module finds the
 * cycles among them. The import skeleton can see an import inside a string,
 * so every file behind a step of a reported cycle is read again with the full
 * parse, and the cycles are found again, until each reported step stands on
 * a full parse. Only files a layer or a context owns take part; the others
 * aren't parsed by the check at all.
 */
import type { ContextSpec } from "../config/contexts.ts";
import type { CycleMode } from "../config/cycles.ts";
import { CONFIG_DEFAULTS } from "../config/defaults.ts";
import type { Diagnostic, ImportRef, SourceFile } from "../contracts/records.ts";
import {
  cycleDiagnostic,
  type FileImports,
  fileEdges,
  findCycles,
  searches,
} from "../rules/import-cycles/cycles.ts";

/**
 * What the skeleton can mistake for an import: a line that starts with
 * `import` inside a multi-line string, which needs triple quotes or a
 * backslash at the end of a line. A file with neither has exact skeleton imports.
 */
const MAY_HIDE_IMPORTS = /"""|'''|\\\r?$/mu;

/**
 * Tells whether a file's skeleton imports are exactly its imports.
 *
 * @param text - the file's normalised text.
 * @returns true when no line can be an import inside a string.
 */
export function skeletonIsExact(text: string): boolean {
  return !MAY_HIDE_IMPORTS.test(text);
}

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
 * Finds the import cycles among the checked files, confirming each reported
 * step with a full parse first.
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
    const behind = new Set(cycles.flatMap((cycle) => cycle.steps.map((step) => step.file.path)));
    const unconfirmed = sorted.filter((entry) => !entry.exact && behind.has(entry.file.path));
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
