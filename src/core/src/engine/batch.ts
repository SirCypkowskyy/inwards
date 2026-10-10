/**
 * @file Checking many files at once: the order the engine's per-file steps run
 * in over a whole list, and what only the whole list decides (the baseline
 * shortcut, FastAPI's cross-file findings, one unassigned-package warning per
 * package, import cycles). `checkAllWith` is the same run with the parsing
 * handed to an `ExtractionBatch` first (#61), such as worker threads. The
 * rules and their precedence stay in `engine.ts`; this module only orders
 * the steps the engine hands it.
 */
import type { Parser } from "web-tree-sitter";
import { acceptedModules } from "../baseline/accepted.ts";
import type { InwardsConfig } from "../config/parse.ts";
import { applyRules } from "../config/rule-settings.ts";
import type {
  Diagnostic,
  ExtractionBatch,
  ImportRef,
  SourceFile,
  Suppressed,
} from "../contracts/records.ts";
import type { ProjectIndex } from "../lookup/project-index.ts";
import { type Collected, projectCycles } from "./cycles.ts";
import type { Extractor } from "./extraction.ts";
import { fastApiFindings, withFastApi } from "./fastapi.ts";
import {
  type Checked,
  type Confirmed,
  keptOnce,
  normalized,
  type Scan,
  wantsFull,
  withFound,
} from "./stages.ts";
import { thinEndpointFindings } from "./thin-endpoint.ts";

/** A file's findings after its suppression comments: those left, and those hidden. */
export interface Suppressing {
  kept: Diagnostic[];
  suppressed: Suppressed[];
}

/** What a check of many files needs from the engine. */
export interface FileSteps {
  config: InwardsConfig;
  parser: Parser;
  extractor: Extractor;
  /**
   * Applies the rules that need no full parse to one file.
   *
   * @param src - the source file, with normalised text.
   * @param project - the module index.
   * @returns its scan.
   */
  scan: (src: SourceFile, project: ProjectIndex) => Scan;
  /**
   * Tells whether the scan reads a file's text at all.
   *
   * @param src - the source file, with normalised text.
   * @returns false outside every layer (nothing else applying) and for an unreadable encoding.
   */
  reads: (src: SourceFile) => boolean;
  /**
   * Finishes a scan, with the full parse when its findings need it.
   *
   * @param src - the source file, with normalised text.
   * @param scan - its scan.
   * @param project - the module index.
   * @param skip - true when the baseline shortcut skips the confirmation.
   * @returns the confirmed findings.
   */
  confirm: (src: SourceFile, scan: Scan, project: ProjectIndex, skip: boolean) => Confirmed;
  /**
   * Adds the package-shape findings and applies the suppression comments.
   *
   * @param src - the source file, with normalised text.
   * @param confirmed - its confirmed findings.
   * @returns the findings left and the ones suppressed.
   */
  suppressIn: (src: SourceFile, confirmed: Confirmed) => Suppressing;
}

/** How a check of many files runs, besides the files and the index. */
export interface CheckOptions {
  /** Accepted copies by baseline key, when a baseline applies. */
  accepted?: ReadonlyMap<string, number> | undefined;
  /** True for a whole-project run, which adds the import cycles. */
  whole?: boolean | undefined;
  /** True for a per-edit check, where FAPI003 reports one-file findings only. */
  edit?: boolean | undefined;
}

/** One file and its scan. */
interface Scanned {
  src: SourceFile;
  scan: Scan;
}

/**
 * Checks many files in order (see `Engine.check`).
 *
 * @param steps - the engine's per-file steps.
 * @param files - the source files to check.
 * @param project - the project's module index.
 * @param options - the baseline and the kind of run.
 * @returns the violations and the suppressed findings.
 */
export function checkAll(
  steps: FileSteps,
  files: Iterable<SourceFile>,
  project: ProjectIndex,
  options: CheckOptions,
): Checked {
  const scanned = normalized(files).map((src) => ({ src, scan: steps.scan(src, project) }));
  const hidden = hiddenBy(steps.config, scanned, options.accepted);
  return finish(steps, scanned, project, { ...options, hidden });
}

/**
 * Checks many files as `checkAll` does, after handing the parsing to
 * `extract` in two batches: first the text tests and import skeletons of
 * every file the scans read, then the full parses that the confirmations
 * and suppression comments will need. Each batch holds only what neither
 * the cache nor an earlier batch has, every answer is preloaded for its
 * file, and the files are then checked in the same order, so the result is
 * the same as `checkAll`'s.
 *
 * @param steps - the engine's per-file steps.
 * @param files - the source files to check.
 * @param project - the project's module index.
 * @param options - the baseline and the kind of run, and `extract`, which runs
 *   extraction jobs elsewhere.
 * @param options.extract - runs extraction jobs elsewhere.
 * @returns the violations and the suppressed findings.
 */
export async function checkAllWith(
  steps: FileSteps,
  files: Iterable<SourceFile>,
  project: ProjectIndex,
  { extract, ...options }: CheckOptions & { extract: ExtractionBatch },
): Promise<Checked> {
  const sources = normalized(files);
  await steps.extractor.prefetch(sources.filter(steps.reads), "skeleton", extract);
  const scanned = sources.map((src) => ({ src, scan: steps.scan(src, project) }));
  const hidden = hiddenBy(steps.config, scanned, options.accepted);
  const full = scanned.filter(({ src, scan }) => wantsFull(src, scan, hidden.has(src.module)));
  await steps.extractor.prefetch(
    full.map(({ src }) => src),
    "full",
    extract,
  );
  return finish(steps, scanned, project, { ...options, hidden });
}

/**
 * Finds the modules the baseline accepts in full, whose confirming parse a
 * check skips (see `Engine.checkFiles` and `acceptedModules`).
 *
 * @param config - the config, whose `[tool.inwards.rules]` the baseline sees applied.
 * @param scanned - every file with its scan, in order.
 * @param accepted - accepted copies by baseline key, when a baseline applies.
 * @returns the modules whose skeleton findings the baseline hides anyway.
 */
function hiddenBy(
  config: InwardsConfig,
  scanned: readonly Scanned[],
  accepted: ReadonlyMap<string, number> | undefined,
): ReadonlySet<string> {
  if (!accepted) {
    return new Set<string>();
  }
  return acceptedModules(
    scanned.map(({ src, scan }) => ({
      module: src.module,
      found: scan.found && applyRules(scan.found, config.rules),
    })),
    accepted,
  );
}

/**
 * Confirms the scanned files in order, applies their suppressions and the
 * FastAPI cross-file findings, keeps each unassigned-package warning once,
 * adds the import cycles of a whole-project run, and applies
 * `[tool.inwards.rules]` last.
 *
 * @param steps - the engine's per-file steps.
 * @param scanned - every file with its scan, in order.
 * @param project - the project's module index.
 * @param options - the kind of run, and the modules whose confirmation the
 *   baseline shortcut skips (`hiddenBy`).
 * @param options.whole - true for a whole-project run.
 * @param options.edit - true for a per-edit check.
 * @param options.hidden - the modules whose confirmation the baseline shortcut skips.
 * @returns the violations and the suppressed findings.
 */
function finish(
  steps: FileSteps,
  scanned: readonly Scanned[],
  project: ProjectIndex,
  { whole = false, edit = false, hidden }: CheckOptions & { hidden: ReadonlySet<string> },
): Checked {
  const { config } = steps;
  const all: Diagnostic[] = [];
  const suppressed: Suppressed[] = [];
  const warned = new Set<string>();
  const collected: Collected[] = [];
  const sources = scanned.map(({ src }) => src);
  const wired = fastApiFindings(steps.parser, project, sources, { config, edit });
  for (const { src, scan } of scanned) {
    const confirmed = steps.confirm(src, scan, project, hidden.has(src.module));
    const imports = confirmed.imports ?? scan.imports;
    if (imports !== undefined) {
      collected.push({ file: src, imports, exact: confirmed.imports !== undefined });
    }
    const extra = withFound(
      withFastApi(confirmed, src, wired),
      thinEndpointFindings(steps.parser, src, config, project),
    );
    const own = steps.suppressIn(src, extra);
    suppressed.push(...own.suppressed.filter(({ diagnostic }) => !wired.hidden.has(diagnostic)));
    all.push(...keptOnce(own.kept, warned).filter((d) => !wired.hidden.has(d)));
  }
  if (whole) {
    all.push(
      ...projectCycles(collected, {
        modes: config.cycles,
        contexts: config.contexts ?? [],
        fullImports: (file: SourceFile, lastLine: number): readonly ImportRef[] =>
          steps.extractor.importsUpTo(file, lastLine),
      }),
    );
  }
  return {
    diagnostics: applyRules(all, config.rules),
    suppressed: suppressed.flatMap(({ diagnostic, reason }) =>
      applyRules([diagnostic], config.rules).map((d) => ({ diagnostic: d, reason })),
    ),
  };
}
