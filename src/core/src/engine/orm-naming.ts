/**
 * @file Runs INW016 `orm-naming` for the engine: the per-file name checks,
 * which `content-rules.ts` adds to each file's findings, and the
 * project-wide findings, which only a whole-project run adds (`batch.ts`),
 * as it does the import cycles: a project without a `MetaData` naming
 * convention, and a project that follows another naming scheme
 * consistently, whose one finding replaces the per-name ones (#361). Nothing is parsed while the rule is off, nor a file
 * whose encoding can hide code (INW000 reports it), and a file the run
 * parsed for another rule is not parsed again. No I/O: the caller supplies
 * the files and the run's trees.
 */
import type { InwardsConfig } from "../config/parse.ts";
import { ruleLevel } from "../config/rule-settings.ts";
import type { Diagnostic, SourceFile } from "../contracts/records.ts";
import { checkOrmNaming, projectFindings } from "../rules/orm-naming/check.ts";
import type { Models } from "../rules/orm-naming/models.ts";
import { foldKey } from "../rules/orm-naming/schemes.ts";
import type { FileTrees } from "../rules/shared/module-trees.ts";
import { checkEncoding } from "../rules/unsupported-encoding/index.ts";

/**
 * Tells whether INW016 checks a file: on for its module, and an encoding Inwards can read.
 *
 * @param src - the source file, with normalised text.
 * @param config - the project's config, for its rules table.
 * @returns true when the rule covers the file.
 */
function covers(src: SourceFile, config: InwardsConfig): boolean {
  return ruleLevel("INW016", config.rules, src.module) !== "off" && checkEncoding(src) === null;
}

/**
 * Finds INW016's per-file findings, whatever layer the file is in.
 *
 * @param trees - the run's trees, which parse each text once per run.
 * @param src - the source file, with normalised text.
 * @param config - the project's config, for its rules table.
 * @param read - where the models the check reads are kept, by file, for `ormProjectFindings`.
 * @returns the findings, before suppressions.
 */
export function ormNamingFindings(
  trees: FileTrees,
  src: SourceFile,
  config: InwardsConfig,
  read: Map<SourceFile, Models>,
): Diagnostic[] {
  return covers(src, config)
    ? checkOrmNaming(trees, src, config.rules?.options?.["orm-naming"], read)
    : [];
}

/** INW016's project-wide findings, and the per-name findings they replace. */
export interface OrmProject {
  readonly findings: Diagnostic[];
  /**
   * Tells whether a finding is a per-name INW016 finding that a project-wide one replaces.
   *
   * @param d - any finding of the run.
   * @returns true when the run drops it.
   */
  readonly replaced: (d: Diagnostic) => boolean;
}

/**
 * Finds INW016's project-wide findings over a whole-project run's files:
 * no `MetaData(naming_convention=...)` among them while a file the rule
 * covers has a table, and the naming schemes the project follows instead
 * of the configured one.
 *
 * @param trees - the run's trees, which parse each text once per run.
 * @param files - every file of the run, with normalised text, in order.
 * @param config - the project's config, for its rules table.
 * @param read - the models the per-file checks read, by file; a file missing here is read from the run's trees.
 * @returns the findings, and which per-name findings they replace.
 */
export function ormProjectFindings(
  trees: FileTrees,
  files: readonly SourceFile[],
  config: InwardsConfig,
  read: ReadonlyMap<SourceFile, Models>,
): OrmProject {
  if (ruleLevel("INW016", config.rules) === "off") {
    return { findings: [], replaced: () => false };
  }
  const readable = files.filter((src) => checkEncoding(src) === null);
  const { findings, folded } = projectFindings(
    trees,
    readable,
    config.rules?.options?.["orm-naming"],
    { checked: (src: SourceFile): boolean => covers(src, config), read },
  );
  return {
    findings,
    replaced: (d: Diagnostic): boolean =>
      d.code === "INW016" && folded.has(foldKey(d.file, d.line, d.column)),
  };
}
