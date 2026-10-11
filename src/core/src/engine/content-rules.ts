/**
 * @file Runs the per-file content rules for the engine: INW012
 * `thin-endpoint` (through `thin-endpoint.ts`), INW013 `async-blocking`,
 * INW014 `ports-abstract`, INW015 `construct-only-in` and INW016
 * `orm-naming` (through `orm-naming.ts`). Each decides whether a file needs
 * it at all and parses the file itself, and only one whose text may hold a
 * finding; their findings join the file's others before the suppression
 * comments apply. INW012, INW013 and INW015 may read another first-party
 * module through the run's `ContentRun`, which parses each one once per
 * run, and INW013 reads each once per run too (#359). INW016 leaves the
 * tables and columns it read in the run, for the whole-project findings. It
 * also decides that an outward import INW001 reports gets INW001 alone, not
 * INW015 as well. No I/O: the caller
 * supplies the file and the run's first-party modules.
 */
import type { Parser } from "web-tree-sitter";
import type { InwardsConfig } from "../config/parse.ts";
import { ruleLevel } from "../config/rule-settings.ts";
import type { Diagnostic, ImportRef, SourceFile } from "../contracts/records.ts";
import type { ProjectIndex } from "../lookup/project-index.ts";
import { AsyncBlockingRun, checkAsyncBlocking } from "../rules/async-blocking/check.ts";
import { checkConstructOnlyIn } from "../rules/construct-only-in/check.ts";
import type { Models } from "../rules/orm-naming/models.ts";
import { checkPortsAbstract } from "../rules/ports-abstract/check.ts";
import { layerIndexOf, outwardImports } from "../rules/shared/layer-ownership.ts";
import { ModuleTrees } from "../rules/shared/module-trees.ts";
import { checkEncoding } from "../rules/unsupported-encoding.ts";
import { ormNamingFindings } from "./orm-naming.ts";
import { thinEndpointFindings } from "./thin-endpoint.ts";

/**
 * What the content rules share over one run: the first-party modules they
 * follow into, parsed once each, and INW013's view of them. The engine
 * builds one per run (`checkFile`, or a `check` of many files) and calls
 * `dispose()` at its end, which frees every tree.
 */
export class ContentRun {
  readonly trees: ModuleTrees;
  private readonly options: InwardsConfig["rules"];
  /** The files the run checks, from which INW013 decides whether its prefilter pays. */
  private readonly files: readonly SourceFile[];
  private asyncBlocking: AsyncBlockingRun | undefined;
  /**
   * The tables and columns INW016 read from each file it parsed, which a
   * whole-project run's scheme finding reuses (#361). Plain data: it
   * outlives `dispose()`.
   */
  readonly ormModels: Map<SourceFile, Models> = new Map();

  /**
   * Wraps the parser, the project and the config. Nothing is read yet.
   *
   * @param parser - parser with the Python grammar loaded.
   * @param project - the project's module index, which reads the modules.
   * @param config - the project's config, for the rules' options.
   * @param files - the files the run checks; none named by default (one file's check).
   */
  constructor(
    parser: Parser,
    project: ProjectIndex,
    config: InwardsConfig,
    files: readonly SourceFile[] = [],
  ) {
    this.trees = new ModuleTrees(parser, project);
    this.options = config.rules;
    this.files = files;
  }

  /**
   * INW013's options and view of the modules, built when a file first needs them.
   *
   * @returns the same object for the whole run.
   */
  asyncBlockingRun(): AsyncBlockingRun {
    this.asyncBlocking ??= new AsyncBlockingRun(
      this.options?.options?.["async-blocking"],
      this.trees,
      this.files,
    );
    return this.asyncBlocking;
  }

  /** Frees every tree the run parsed; the views handed out are invalid afterwards. */
  dispose(): void {
    this.trees.dispose();
  }
}

/**
 * Finds INW013's findings in a file, whatever layer it is in. Nothing is
 * parsed when the rule is off for the file's module, or when the file's
 * encoding can hide code (INW000 reports it).
 *
 * @param parser - parser with the Python grammar loaded.
 * @param src - the source file, with normalised text.
 * @param config - the project's config, for its rules table.
 * @param run - the run, for the sync helpers a hop leads to.
 * @returns the findings, before suppressions.
 */
function asyncBlockingFindings(
  parser: Parser,
  src: SourceFile,
  config: InwardsConfig,
  run: ContentRun,
): Diagnostic[] {
  const { rules } = config;
  if (ruleLevel("INW013", rules, src.module) === "off" || checkEncoding(src)) {
    return [];
  }
  return checkAsyncBlocking(parser, src, run.asyncBlockingRun());
}

/**
 * Finds INW014's findings in a file. Nothing is parsed when the rule is off
 * for the file's module or the file's encoding can hide code; the rule
 * itself skips a module that isn't a port module.
 *
 * @param parser - parser with the Python grammar loaded.
 * @param src - the source file, with normalised text.
 * @param config - the project's config: its rules table, and its layers for the fix.
 * @returns the findings, before suppressions.
 */
function portsAbstractFindings(
  parser: Parser,
  src: SourceFile,
  config: InwardsConfig,
): Diagnostic[] {
  const { rules, layers } = config;
  if (ruleLevel("INW014", rules, src.module) === "off" || checkEncoding(src)) {
    return [];
  }
  return checkPortsAbstract(parser, src, { options: rules?.options?.["ports-abstract"], layers });
}

/**
 * Finds INW015's findings in a file a layer owns; a module no layer owns,
 * such as a test or a script, builds adapters on purpose. Nothing is parsed
 * when the rule is off for the file's module or the file's encoding can hide
 * code (INW000 reports it). An import INW001 reports as outward gets INW001
 * alone, unless INW001 is off for the module.
 *
 * @param parser - parser with the Python grammar loaded.
 * @param src - the source file, with normalised text.
 * @param config - the project's config: its rules table and layers.
 * @param project - the run's first-party modules, for the role modules and re-exports.
 * @returns the findings, before suppressions.
 */
function constructOnlyInFindings(
  parser: Parser,
  src: SourceFile,
  config: InwardsConfig,
  project: ModuleTrees,
): Diagnostic[] {
  const { rules, layers } = config;
  const off = ruleLevel("INW015", rules, src.module) === "off";
  if (off || layerIndexOf(src.module, layers) === -1 || checkEncoding(src)) {
    return [];
  }
  const inw001 = ruleLevel("INW001", rules, src.module) !== "off";
  /**
   * Tells whether INW001 reports an import, so INW015 leaves it alone.
   *
   * @param ref - an import of a role module.
   * @returns true when INW001 is on and the import points outward.
   */
  function deferred(ref: ImportRef): boolean {
    return inw001 && outwardImports(src, [ref], layers).length > 0;
  }
  const options = rules?.options?.["construct-only-in"];
  return checkConstructOnlyIn(parser, src, options, { project, deferred });
}

/**
 * Finds the content rules' findings in a file: INW012's, INW013's, INW014's, INW015's, then INW016's.
 *
 * @param parser - parser with the Python grammar loaded.
 * @param src - the source file, with normalised text.
 * @param config - the project's config: its rules table and layers.
 * @param run - the run's first-party modules, for INW012's handlers registered from another module, INW013's helpers one hop away and INW015's role modules.
 * @returns the findings, before suppressions.
 */
export function contentFindings(
  parser: Parser,
  src: SourceFile,
  config: InwardsConfig,
  run: ContentRun,
): Diagnostic[] {
  return [
    ...thinEndpointFindings(parser, src, config, run.trees),
    ...asyncBlockingFindings(parser, src, config, run),
    ...portsAbstractFindings(parser, src, config),
    ...constructOnlyInFindings(parser, src, config, run.trees),
    ...ormNamingFindings(parser, src, config, run.ormModels),
  ];
}
