/**
 * @file The engine: parses a file, runs the rules over it, then applies inline
 * suppressions and `[tool.inwards.rules]`. It also decides which rule wins when
 * several would report the same import, and when the full parse can be skipped
 * (the prescan, the baseline shortcut). Adapters build one with `Engine.create`
 * per config and call `checkFile` or `checkFiles`.
 */
import type { Parser } from "web-tree-sitter";
import type { InwardsConfig } from "../config/parse.ts";
import { type LibraryDeny, libraryDenies } from "../config/rule-options.ts";
import { applyRules, ruleLevel } from "../config/rule-settings.ts";
import type {
  Diagnostic,
  ExtractionBatch,
  ExtractionCache,
  ImportRef,
  SourceFile,
} from "../contracts/records.ts";
import type { ProjectFiles, ProjectIndex } from "../lookup/project-index.ts";
import {
  createPythonParser,
  type GrammarBinaries,
  normalizeSource,
  parsePython,
} from "../python/parser.ts";
import { checkContextDependencies } from "../rules/context-independence.ts";
import { checkDynamicImports, extractDynamicImports } from "../rules/dynamic-import/imports.ts";
import { checkLayers } from "../rules/layer-dependency.ts";
import { shapeFindings } from "../rules/package-shape/shape.ts";
import { checkPublicApi } from "../rules/public-api-only.ts";
import { checkLibraries, coversModule, type LibraryInputs } from "../rules/pure-domain.ts";
import { layerIndexOf, outwardImports } from "../rules/shared/layer-ownership.ts";
import { mentionsSuppression, suppress } from "../rules/suppression-comment.ts";
import {
  checkUnassignedImports,
  indexEvidence,
  unassignedWarning,
} from "../rules/unassigned-module/imports.ts";
import { checkUnknownImports } from "../rules/unknown-first-party.ts";
import { checkEncoding } from "../rules/unsupported-encoding.ts";
import {
  type CheckOptions,
  checkAll,
  checkAllWith,
  type FileSteps,
  type Suppressing,
} from "./batch.ts";
import { Extractor } from "./extraction.ts";
import { fastApiFindings, withFastApi } from "./fastapi.ts";
import { moduleIndex } from "./module-index.ts";
import {
  type Checked,
  type Confirmed,
  ordered,
  type Route,
  type Scan,
  withFound,
} from "./stages.ts";
import { thinEndpointFindings } from "./thin-endpoint.ts";

export type { Checked } from "./stages.ts";

/** The whole engine surface. Adapters (CLI, LSP) call this and nothing deeper. */
export class Engine {
  private readonly parser: Parser;
  private readonly config: InwardsConfig;
  private readonly extractor: Extractor;
  /** INW005's inputs beyond the layers: the uv workspace's member packages (its wording) and `deny`. */
  private readonly libraryInputs: { workspace: ReadonlySet<string>; deny: readonly LibraryDeny[] };

  /**
   * Stores a ready parser, a validated config and the extraction helper.
   * Private: `Engine.create` is the only way in, because loading the grammar is async.
   *
   * @param parser - tree-sitter parser with the Python grammar already set.
   * @param config - layers and root read from `[tool.inwards]`.
   * @param options - optional inputs, see `create`.
   * @param options.cache - where extractions are kept between checks, if anywhere.
   * @param options.workspacePackages - the uv workspace members' import packages.
   */
  private constructor(
    parser: Parser,
    config: InwardsConfig,
    options: { cache?: ExtractionCache; workspacePackages?: ReadonlySet<string> },
  ) {
    this.parser = parser;
    this.config = config;
    this.extractor = new Extractor(parser, options.cache);
    const deny = libraryDenies(config.rules?.options?.["pure-domain"]);
    this.libraryInputs = { workspace: options.workspacePackages ?? new Set(), deny };
  }

  /**
   * Builds an engine from the grammar bytes an adapter supplies.
   * Initialises the tree-sitter runtime and loads the Python grammar once;
   * every later check reuses that parser.
   *
   * With `options.cache`, what the engine reads out of a file's text (the
   * import skeleton, the full parse's static imports, the suppression
   * comments) is kept there and reused while the text is unchanged (#56).
   * Results never differ with or without it.
   *
   * `options.workspacePackages` names the top-level import packages of the
   * uv workspace the project belongs to. It changes only INW005's wording:
   * an import of one is a "workspace package", not a "library" (#203).
   *
   * @param wasm - the tree-sitter runtime and Python grammar as WASM bytes.
   * @param config - layers and root read from `[tool.inwards]`.
   * @param options - optional inputs.
   * @param options.cache - where extractions are kept between checks.
   * @param options.workspacePackages - the uv workspace members' import packages; none by default.
   * @returns an engine ready to check files.
   */
  static async create(
    wasm: GrammarBinaries,
    config: InwardsConfig,
    options: { cache?: ExtractionCache; workspacePackages?: ReadonlySet<string> } = {},
  ): Promise<Engine> {
    return new Engine(await createPythonParser(wasm), config, options);
  }

  /**
   * Checks one file against every rule.
   * The package shape (INW007) comes first and reads only the path. Then only
   * the import skeleton is parsed. Violations are rare, so the full parse runs
   * only to confirm one (or when the prescan declines the file), and not even
   * then when a baseline accepts them all (see `checkFiles`).
   *
   * The text is normalised first (BOM dropped, lone \r turned into \n), so
   * reported lines and columns match what an editor shows. A file in a layer
   * that declares an encoding Inwards can't read faithfully gets one INW000
   * diagnostic instead of a check (see `rules/unsupported-encoding.ts`).
   *
   * The skeleton keeps import statements only, so it can't see
   * `importlib.import_module("...")` or `exec("import ...")`. A file in a layer
   * whose text names a loader (`mentionsDynamicImport`) skips the skeleton and
   * gets the full parse, which also looks for dynamic imports (INW011).
   *
   * A file outside every layer isn't parsed unless contexts are declared:
   * besides its shape, it gets at most an INW006 warning naming its package.
   * With contexts, every file is parsed, since any of them may import a
   * context (INW002, INW003); outside the layers it gets that warning and
   * the context rules. A file that INW005's `deny` option covers is parsed
   * too, layer or not (#219).
   *
   * Inline suppression comments then hide the findings they cover and add
   * INW009 for the ones that are invalid or unused (see `rules/suppression-comment.ts`).
   * `[tool.inwards.rules]` applies last: findings of rules that are off are
   * dropped, the rest get their configured severity (see `applyRules`).
   *
   * FAPI001 and FAPI002 run only when on and the text mentions FastAPI, and
   * INW012 only when on for the file's module and the text may hold an
   * endpoint (`engine/thin-endpoint.ts`).
   *
   * @param file - the source file as read by the adapter.
   * @param project - the project's module index (see `index`).
   * @returns the violations found, empty when the file is clean.
   */
  checkFile(file: SourceFile, project: ProjectIndex): Diagnostic[] {
    const src = { ...file, text: normalizeSource(file.text) };
    const wired = fastApiFindings(this.parser, project, [src], { config: this.config, edit: true });
    const confirmed = withFound(
      withFastApi(this.confirm(src, this.scan(src, project), project), src, wired),
      thinEndpointFindings(this.parser, src, this.config),
    );
    const kept = this.suppressIn(src, confirmed).kept.filter((d) => !wired.hidden.has(d));
    return applyRules(kept, this.config.rules);
  }

  /**
   * Applies the text rules that need no full parse, see `checkFile`.
   *
   * @param src - the source file, with normalised text.
   * @param project - the module index (INW006, INW010).
   * @returns the findings so far, and what the full parse would still have to do.
   */
  private scan(src: SourceFile, project: ProjectIndex): Scan {
    const route = this.route(src);
    if (route.kind === "outside") {
      const warning = unassignedWarning(src, this.config, indexEvidence(project));
      return { found: warning ? [warning] : [], exact: true, dynamic: false };
    }
    if (route.kind === "unreadable") {
      return { found: [route.found], exact: true, dynamic: false };
    }
    const { dynamic } = route;
    const fast = route.skeleton ? this.extractor.skeleton(src) : null;
    const found = fast ? this.importFindings(src, fast, project) : null;
    // Outside every layer, the unassigned-package warning needs no confirmation.
    const unsettled = this.layered(src) ? found : found?.filter((d) => d.code !== "INW006");
    return { found, exact: unsettled?.length === 0, dynamic, ...(fast ? { imports: fast } : {}) };
  }

  /**
   * Decides how `scan` reads a file, from its module and text alone: not at
   * all (outside every layer, with no contexts and no `deny` covering it),
   * not at all because its encoding can't be read (INW000), or with the
   * prescan unless a loader or a suppression comment sends it to the full parse.
   *
   * @param src - the source file, with normalised text.
   * @returns the route, with the INW000 finding or what the read needs.
   */
  private route(src: SourceFile): Route {
    if (this.outside(src)) {
      return { kind: "outside" };
    }
    const unreadable = checkEncoding(src);
    if (unreadable) {
      return { kind: "unreadable", found: unreadable };
    }
    const dynamic = this.extractor.mentionsLoader(src);
    // A file with a suppression comment gets the full parse, which also reads the comments.
    return { kind: "read", dynamic, skeleton: !(dynamic || mentionsSuppression(src.text)) };
  }

  /**
   * Tells whether the scan leaves a file unread: outside every layer, with
   * no contexts declared and no `deny` of INW005 covering it.
   *
   * @param src - the source file.
   * @returns true when only its unassigned-package warning can apply.
   */
  private outside(src: SourceFile): boolean {
    const { contexts } = this.config;
    return !(this.layered(src) || contexts || coversModule(this.libraryInputs.deny, src.module));
  }

  /**
   * Tells whether a layer owns a file.
   *
   * @param src - the source file.
   * @returns true when one of the configured layers owns its module.
   */
  private layered(src: SourceFile): boolean {
    return layerIndexOf(src.module, this.config.layers) !== -1;
  }

  /**
   * Gathers what INW005 needs besides the file and the layers.
   *
   * @param project - the module index, for first-party lookups.
   * @returns the lookup, the uv workspace's member packages and `deny`.
   */
  private librariesIn(project: ProjectIndex): LibraryInputs {
    return { ownerOf: project.ownerOf, ...this.libraryInputs };
  }

  /**
   * Tells whether INW002 reports undeclared dependencies, so INW003 leaves
   * them alone; with INW002 off, INW003 still holds such imports to the
   * public modules.
   *
   * @returns true unless `[tool.inwards.rules]` turns INW002 off.
   */
  private defersToInw002(): boolean {
    return ruleLevel("INW002", this.config.rules) !== "off";
  }

  /**
   * Adds the package-shape findings to a file's confirmed ones and applies
   * its suppression comments (see `rules/suppression-comment.ts`).
   *
   * @param src - the source file, with normalised text.
   * @param confirmed - its confirmed findings, and its comments if the full parse read them.
   * @returns the findings left, INW009 included, and the ones suppressed.
   */
  private suppressIn(src: SourceFile, confirmed: Confirmed): Suppressing {
    const found = [...shapeFindings(src, this.config), ...confirmed.found];
    // Read the comments here, through the cache, rather than let suppress() parse.
    const needed =
      confirmed.comments === undefined &&
      mentionsSuppression(src.text) &&
      !found.some((d) => d.code === "INW000");
    const comments = needed ? this.extractor.full(src).comments : confirmed.comments;
    return suppress(
      this.parser,
      src,
      comments === undefined ? { found } : { found, comments },
      this.config.rules,
    );
  }

  /**
   * Finishes a scan: exact findings stand, anything else gets the full parse,
   * unless `skip` says the baseline hides every skeleton finding anyway.
   *
   * @param src - the source file, with normalised text.
   * @param scan - its scan.
   * @param project - the module index (INW006, INW010).
   * @param skip - true to return the skeleton's findings unconfirmed.
   * @returns the violations found, and the suppression comments when the full parse read them.
   */
  private confirm(src: SourceFile, scan: Scan, project: ProjectIndex, skip = false): Confirmed {
    if (scan.found && (scan.exact || skip)) {
      return { found: scan.found };
    }
    return this.fullCheck(src, scan.dynamic, project);
  }

  /**
   * Applies the rules that look at import statements: INW001, INW002, INW005, INW006 and INW010.
   * An import of a module that doesn't exist gets INW010 alone, not INW006
   * as well, and one that climbs above the top-level package (empty target)
   * reaches no other rule. An outward import gets INW001 alone, even when its
   * module doesn't exist either. INW002 is independent of the layer rules: an
   * import can break a layer and a context boundary at once. A file outside
   * every layer gets only INW002, INW003, INW005's prefix denies and its
   * unassigned-package warning.
   *
   * @param file - the source file.
   * @param imports - its imports.
   * @param project - the module index.
   * @returns the violations found.
   */
  private importFindings(
    file: SourceFile,
    imports: readonly ImportRef[],
    project: ProjectIndex,
  ): Diagnostic[] {
    const { layers, contexts = [] } = this.config;
    const across = [
      ...checkContextDependencies(file, imports, contexts, project.ownerOf),
      ...checkPublicApi(file, imports, project, { contexts, defer: this.defersToInw002() }),
    ];
    const resolved = imports.filter((ref) => ref.target !== "");
    const libraries = checkLibraries(file, resolved, layers, this.librariesIn(project));
    if (!this.layered(file)) {
      const warning = unassignedWarning(file, this.config, indexEvidence(project));
      return [...(warning ? [warning] : []), ...libraries, ...across];
    }
    // INW001's fix deletes an outward import; "create the module" would contradict it.
    const outward = new Set(outwardImports(file, imports, layers).map((o) => o.ref));
    const unknown = checkUnknownImports(
      file,
      imports.filter((ref) => !outward.has(ref)),
      project,
      this.config,
    );
    const existing = resolved.filter((ref) => !unknown.missing.has(ref));
    return [
      ...checkLayers(file, resolved, layers),
      ...libraries,
      ...checkUnassignedImports(file, existing, layers, {
        ownerOf: project.ownerOf,
        evidence: indexEvidence(project),
      }),
      ...unknown.found,
      ...across,
    ];
  }

  /**
   * Checks a file against a full parse, the exact path.
   * Diagnostics come back in source order, static and dynamic imports mixed.
   *
   * @param file - the source file, with normalised text.
   * @param dynamic - true to look for dynamic imports as well (INW011).
   * @param project - the module index.
   * @returns the violations found, and the suppression comments of a file that mentions them.
   */
  private fullCheck(file: SourceFile, dynamic: boolean, project: ProjectIndex): Confirmed {
    if (!dynamic) {
      const { imports, comments } = this.extractor.full(file);
      return { ...ordered(file, this.importFindings(file, imports, project), comments), imports };
    }
    const { layers } = this.config;
    const tree = parsePython(this.parser, file.text);
    try {
      const { imports, comments } = this.extractor.fromTree(file, tree);
      const found = this.importFindings(file, imports, project);
      // Dynamic imports are never cached: they depend on other files (ownerOf).
      const refs = extractDynamicImports(this.parser, tree, file, project.ownerOf);
      const readable = refs.filter((ref) => ref.unreadable === null && ref.target !== "");
      const { contexts = [] } = this.config;
      found.push(
        ...checkContextDependencies(file, readable, contexts, project.ownerOf),
        ...checkPublicApi(file, readable, project, { contexts, defer: this.defersToInw002() }),
        ...checkLibraries(file, readable, layers, this.librariesIn(project)),
      );
      if (this.layered(file)) {
        found.push(
          ...checkDynamicImports(file, refs, layers),
          ...checkUnassignedImports(file, readable, layers, {
            ownerOf: project.ownerOf,
            evidence: indexEvidence(project),
          }),
        );
      }
      return { ...ordered(file, found, comments), imports: [...imports, ...readable] };
    } finally {
      tree.delete(); // WASM memory is not garbage collected
    }
  }

  /**
   * Builds the project's module index, the input `checkFile` and `checkFiles`
   * take. Free: nothing is listed or read until a rule asks (see
   * `ProjectIndex`). The reverse-import map reads imports skeleton-first,
   * like `checkFile`.
   *
   * @param files - the adapter's view of the files under the config root.
   * @returns a lazy index that lists and reads only when a rule asks.
   */
  index(files: ProjectFiles): ProjectIndex {
    return moduleIndex(files, this.extractor, this.parser);
  }

  /**
   * Checks many files and concatenates their violations.
   * Order follows the input, so a sorted file list gives sorted output. The
   * INW006 warning for an unassigned package is kept once, on its first file.
   *
   * With `accepted`, the baseline's copies by key (see `baselineKey`), a
   * module the baseline hides in full skips the confirming parse: every file
   * of it is scanned first, and if the skeleton's findings, false positives
   * included, add up to no more than the accepted copies of each key, the
   * real ones do too, so the adapter's baseline hides them all either way.
   * Those findings are returned unconfirmed. See `acceptedModules`, which
   * sees the findings after `[tool.inwards.rules]`, as the baseline does.
   *
   * `[tool.inwards.rules]` applies after the INW006 warnings are deduplicated,
   * so a configured severity doesn't change how many copies are kept.
   *
   * @param files - the source files to check.
   * @param project - the project's module index (see `index`).
   * @param accepted - accepted copies by baseline key, when a baseline applies.
   * @returns every violation across all files, baselined ones included.
   */
  checkFiles(
    files: Iterable<SourceFile>,
    project: ProjectIndex,
    accepted?: ReadonlyMap<string, number>,
  ): Diagnostic[] {
    return this.check(files, project, accepted).diagnostics;
  }

  /**
   * `checkFiles`, plus the findings inline suppression comments hid, for the
   * adapters that count or report them (the CLI: summary, SARIF, run log,
   * and the hooks' `agent-suppressions`). Suppressions apply per file,
   * before the INW006 warnings are deduplicated; the suppressed findings get
   * `[tool.inwards.rules]` too, so a rule that is off has none.
   *
   * @param files - the source files to check.
   * @param project - the project's module index (see `index`).
   * @param accepted - accepted copies by baseline key, when a baseline applies.
   * @param options - `whole: true` when the files are the whole project, which
   *   adds the import cycles among them (INW004, `engine/cycles.ts`); `edit: true`
   *   for a per-edit check, where FAPI003 reports one-file findings only.
   * @param options.whole - true for a whole-project run.
   * @param options.edit - true for a per-edit check.
   * @returns the violations, as `checkFiles` returns them, and the suppressed findings.
   */
  check(
    files: Iterable<SourceFile>,
    project: ProjectIndex,
    accepted?: ReadonlyMap<string, number>,
    options: { whole?: boolean; edit?: boolean } = {},
  ): Checked {
    return checkAll(this.steps(), files, project, { accepted, ...options });
  }

  /**
   * `check`, with the parsing handed to `extract` in two batches (#61):
   * first the text tests and import skeletons the scans will read, then the
   * full parses the confirmations and suppression comments will need (see
   * `checkAllWith`). The result is what `check` returns; a job the batch
   * leaves unanswered, or a batch that fails, is computed here as `check`
   * would, and any error it meets surfaces as it would there.
   *
   * @param files - the source files to check.
   * @param project - the project's module index (see `index`).
   * @param options - what `check` takes besides the files and the index.
   * @param options.accepted - accepted copies by baseline key, when a baseline applies.
   * @param options.whole - true for a whole-project run.
   * @param options.edit - true for a per-edit check.
   * @param extract - runs extraction jobs elsewhere, such as on worker threads.
   * @returns what `check` returns for the same arguments.
   */
  checkWith(
    files: Iterable<SourceFile>,
    project: ProjectIndex,
    options: CheckOptions,
    extract: ExtractionBatch,
  ): Promise<Checked> {
    return checkAllWith(this.steps(), files, project, { ...options, extract });
  }

  /**
   * Hands the per-file steps to `batch.ts`, which orders them over many files.
   *
   * @returns the engine's config, parser and extractor, and its steps bound to it.
   */
  private steps(): FileSteps {
    return {
      config: this.config,
      parser: this.parser,
      extractor: this.extractor,
      scan: (src: SourceFile, project: ProjectIndex): Scan => this.scan(src, project),
      reads: (src: SourceFile): boolean => !this.outside(src) && checkEncoding(src) === null,
      confirm: (src: SourceFile, scan: Scan, project: ProjectIndex, skip: boolean): Confirmed =>
        this.confirm(src, scan, project, skip),
      suppressIn: (src: SourceFile, confirmed: Confirmed): Suppressing =>
        this.suppressIn(src, confirmed),
    };
  }
}
