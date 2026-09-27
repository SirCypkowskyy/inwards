/**
 * @file The engine: parses a file, runs the rules over it, then applies inline
 * suppressions and `[tool.inwards.rules]`. It also decides which rule wins when
 * several would report the same import, and when the full parse can be skipped
 * (the prescan, the baseline shortcut). Adapters build one with `Engine.create`
 * per config and call `checkFile` or `checkFiles`.
 */
import type { Parser } from "web-tree-sitter";
import { acceptedModules } from "../baseline/accepted.ts";
import type { InwardsConfig } from "../config/parse.ts";
import { applyRules, ruleLevel } from "../config/rule-settings.ts";
import type {
  Diagnostic,
  ExtractionCache,
  ImportRef,
  SourceFile,
  Suppressed,
  SuppressionComment,
} from "../contracts/records.ts";
import { type ProjectFiles, ProjectIndex } from "../lookup/project-index.ts";
import { topLevelBindings } from "../python/bindings.ts";
import {
  createPythonParser,
  type GrammarBinaries,
  normalizeSource,
  parsePython,
} from "../python/parser.ts";
import { checkContextDependencies } from "../rules/context-independence.ts";
import {
  checkDynamicImports,
  extractDynamicImports,
  mentionsDynamicImport,
} from "../rules/dynamic-import/imports.ts";
import { checkLayers } from "../rules/layer-dependency.ts";
import { shapeFindings } from "../rules/package-shape/shape.ts";
import { checkPublicApi } from "../rules/public-api-only.ts";
import { checkLibraries } from "../rules/pure-domain.ts";
import { layerIndexOf, outwardImports } from "../rules/shared/layer-ownership.ts";
import { mentionsSuppression, suppress } from "../rules/suppression-comment.ts";
import { checkUnassignedImports, unassignedWarning } from "../rules/unassigned-module/imports.ts";
import { checkUnknownImports } from "../rules/unknown-first-party.ts";
import { checkEncoding } from "../rules/unsupported-encoding.ts";
import { Extractor } from "./extraction.ts";

/** A file after the prescan, before any full parse. */
interface Scan {
  /** The findings so far; null when the prescan was skipped or refused the file. */
  found: Diagnostic[] | null;
  /** True when `found` is final and needs no full parse. */
  exact: boolean;
  /** True when the full parse must also look for dynamic imports (INW011). */
  dynamic: boolean;
}

/** A file's findings after the full parse, if it ran, and its suppression comments. */
interface Confirmed {
  found: Diagnostic[];
  /** Read from the full parse of a file that mentions `inwards: ignore`; absent otherwise. */
  comments?: SuppressionComment[];
}

/** What `check` returns: the findings to report, and the ones inline suppressions hid. */
export interface Checked {
  diagnostics: Diagnostic[];
  suppressed: Suppressed[];
}

/** The whole engine surface. Adapters (CLI, LSP) call this and nothing deeper. */
export class Engine {
  private readonly parser: Parser;
  private readonly config: InwardsConfig;
  private readonly extractor: Extractor;

  /**
   * Stores a ready parser, a validated config and the extraction helper.
   * Private: `Engine.create` is the only way in, because loading the grammar is async.
   *
   * @param parser - tree-sitter parser with the Python grammar already set.
   * @param config - layers and root read from `[tool.inwards]`.
   * @param cache - where extractions are kept between checks, if anywhere.
   */
  private constructor(parser: Parser, config: InwardsConfig, cache: ExtractionCache | undefined) {
    this.parser = parser;
    this.config = config;
    this.extractor = new Extractor(parser, cache);
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
   * @param wasm - the tree-sitter runtime and Python grammar as WASM bytes.
   * @param config - layers and root read from `[tool.inwards]`.
   * @param options - optional inputs.
   * @param options.cache - where extractions are kept between checks.
   * @returns an engine ready to check files.
   */
  static async create(
    wasm: GrammarBinaries,
    config: InwardsConfig,
    options: { cache?: ExtractionCache } = {},
  ): Promise<Engine> {
    return new Engine(await createPythonParser(wasm), config, options.cache);
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
   * the context rules.
   *
   * Inline suppression comments then hide the findings they cover and add
   * INW009 for the ones that are invalid or unused (see `rules/suppression-comment.ts`).
   * `[tool.inwards.rules]` applies last: findings of rules that are off are
   * dropped, the rest get their configured severity (see `applyRules`).
   *
   * @param file - the source file as read by the adapter.
   * @param project - the project's module index (see `index`).
   * @returns the violations found, empty when the file is clean.
   */
  checkFile(file: SourceFile, project: ProjectIndex): Diagnostic[] {
    const src = { ...file, text: normalizeSource(file.text) };
    const { kept } = this.suppressIn(src, this.confirm(src, this.scan(src, project), project));
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
    const layered = this.layered(src);
    if (!(layered || this.config.contexts)) {
      const warning = unassignedWarning(src, this.config);
      return { found: warning ? [warning] : [], exact: true, dynamic: false };
    }
    const unreadable = checkEncoding(src);
    if (unreadable) {
      return { found: [unreadable], exact: true, dynamic: false };
    }
    const dynamic = mentionsDynamicImport(src.text);
    // A file with a suppression comment gets the full parse, which also reads the comments.
    const fast = dynamic || mentionsSuppression(src.text) ? null : this.extractor.skeleton(src);
    const found = fast ? this.importFindings(src, fast, project) : null;
    // Outside every layer, the unassigned-package warning needs no confirmation.
    const unsettled = layered ? found : found?.filter((d) => d.code !== "INW006");
    return { found, exact: unsettled?.length === 0, dynamic };
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
  private suppressIn(
    src: SourceFile,
    confirmed: Confirmed,
  ): { kept: Diagnostic[]; suppressed: Suppressed[] } {
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
   * every layer gets only INW002 and its unassigned-package warning.
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
    if (!this.layered(file)) {
      const warning = unassignedWarning(file, this.config);
      return warning ? [warning, ...across] : across;
    }
    // INW001's fix deletes an outward import; "create the module" would contradict it.
    const outward = new Set(outwardImports(file, imports, layers).map((o) => o.ref));
    const unknown = checkUnknownImports(
      file,
      imports.filter((ref) => !outward.has(ref)),
      project,
      this.config.generated,
    );
    const resolved = imports.filter((ref) => ref.target !== "");
    const existing = resolved.filter((ref) => !unknown.missing.has(ref));
    return [
      ...checkLayers(file, resolved, layers),
      ...checkLibraries(file, resolved, layers, project.ownerOf),
      ...checkUnassignedImports(file, existing, layers, project.ownerOf),
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
      return ordered(file, this.importFindings(file, imports, project), comments);
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
      );
      if (this.layered(file)) {
        found.push(
          ...checkDynamicImports(file, refs, layers),
          ...checkLibraries(file, readable, layers, project.ownerOf),
          ...checkUnassignedImports(file, readable, layers, project.ownerOf),
        );
      }
      return ordered(file, found, comments);
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
    return new ProjectIndex(
      files,
      (file) => {
        const src = { ...file, text: normalizeSource(file.text) };
        return this.extractor.skeleton(src) ?? this.extractor.full(src).imports;
      },
      (file) => {
        const tree = parsePython(this.parser, normalizeSource(file.text));
        try {
          return topLevelBindings(tree, file.path.endsWith(".pyi"));
        } finally {
          tree.delete(); // WASM memory is not garbage collected
        }
      },
    );
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
   * @returns the violations, as `checkFiles` returns them, and the suppressed findings.
   */
  check(
    files: Iterable<SourceFile>,
    project: ProjectIndex,
    accepted?: ReadonlyMap<string, number>,
  ): Checked {
    const { rules } = this.config;
    const scanned = [...files].map((file) => {
      const src = { ...file, text: normalizeSource(file.text) };
      return { src, scan: this.scan(src, project) };
    });
    const hidden = accepted
      ? acceptedModules(
          scanned.map(({ src, scan }) => ({
            module: src.module,
            found: scan.found && applyRules(scan.found, rules),
          })),
          accepted,
        )
      : new Set<string>();
    const all: Diagnostic[] = [];
    const suppressed: Suppressed[] = [];
    const warned = new Set<string>();
    for (const { src, scan } of scanned) {
      const skip = hidden.has(src.module);
      const own = this.suppressIn(src, this.confirm(src, scan, project, skip));
      suppressed.push(...own.suppressed);
      for (const found of own.kept) {
        // An unused-suppression warning (INW009) names no place: each comment is its own.
        const once =
          found.severity === "warning" && found.code !== "INW009" ? found.message : undefined;
        if (once === undefined || !warned.has(once)) {
          all.push(found);
        }
        if (once !== undefined) {
          warned.add(once);
        }
      }
    }
    return {
      diagnostics: applyRules(all, rules),
      suppressed: suppressed.flatMap(({ diagnostic, reason }) =>
        applyRules([diagnostic], rules).map((d) => ({ diagnostic: d, reason })),
      ),
    };
  }
}

/**
 * Orders a full parse's findings and attaches the comments when the file may
 * hold a suppression, as suppress() expects.
 *
 * @param file - the source file, with normalised text.
 * @param found - the findings, in any order.
 * @param comments - the file's suppression comments.
 * @returns the findings in source order, with the comments when they matter.
 */
function ordered(file: SourceFile, found: Diagnostic[], comments: SuppressionComment[]): Confirmed {
  found.sort((a, b) => a.line - b.line || a.column - b.column);
  return mentionsSuppression(file.text) ? { found, comments } : { found };
}
