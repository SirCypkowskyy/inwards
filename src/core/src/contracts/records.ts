/**
 * @file The records the engine and its adapters exchange: source files, import
 * references, spans, diagnostics with their fixes, suppressed findings, and the
 * extraction-cache port with the per-file data it holds.
 * Plain data with no behaviour, so every core folder may import it and it
 * imports nothing.
 */
/** 1-based line and column, the convention every editor and SARIF viewer uses. */
export interface Span {
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
}

/** A Python file, already read from disk by whichever adapter runs the engine. */
export interface SourceFile {
  /** Path as the user should see it, relative to the project root. */
  path: string;
  /** Dotted module name, e.g. `shop.domain.order`. */
  module: string;
  /** True for `__init__.py`, which changes how relative imports resolve. */
  isPackage: boolean;
  text: string;
}

/**
 * A Markdown or Mermaid file a `diagrams` entry names, read by the adapter
 * for the diagram rules (INW017, ADR-045).
 */
export interface DiagramSource {
  /** Path as the user should see it. */
  path: string;
  text: string;
}

export interface ImportRef extends Span {
  /**
   * Fully resolved dotted target, e.g. `shop.infrastructure.db.OrderTable`.
   * Empty for a relative import that climbs above the top-level package.
   */
  target: string;
  /** The import statement exactly as written. */
  statement: string;
  /**
   * The resolved `X` of `from X import name`, which must be a module, while
   * `name` may be a submodule or a name `X` defines. Absent when the whole
   * target is a module (`import X`, `from X import *`, dynamic imports).
   */
  from?: string;
}

/** Machine-actionable repair advice. Written for an LLM first, a human second. */
export interface Fix {
  summary: string;
  steps: string[];
}

export type Severity = "error" | "warning";

export interface Diagnostic extends Span {
  code: string;
  rule: string;
  severity: Severity;
  file: string;
  module: string;
  message: string;
  fix: Fix;
  docs: string;
}

/** A finding a suppression comment hid, with the comment's reason. */
export interface Suppressed {
  diagnostic: Diagnostic;
  reason: string;
  /**
   * Set by an adapter's baseline: an entry accepts this finding too, so it
   * stays hidden if the suppression isn't honoured (the hooks' `agent-suppressions`).
   */
  baselined?: boolean;
}

/** One `# inwards: ignore` comment as read. */
export interface SuppressionComment {
  span: Span;
  codes: string[];
  reason: string;
  /** Why it suppresses nothing, one sentence each; empty when it is valid. */
  problems: string[];
}

/**
 * What a cached extraction depends on: the engine's extraction revision and
 * everything about the file that a parse reads. The adapter adds the identity
 * of the grammar it loaded and its own storage format to the key.
 */
export interface ExtractionIdentity {
  /** `EXTRACTION_REVISION`: bumped whenever normalisation, extraction or suppression parsing changes. */
  revision: string;
  /** The normalised text. */
  text: string;
  module: string;
  isPackage: boolean;
}

/**
 * What the engine derives from one file's text alone, component by
 * component. A missing component was never computed; an empty list means
 * computed and empty. Nothing here depends on the config or on other files.
 */
export interface CachedExtraction {
  /**
   * The prescan's import skeleton, or `"refused"` when the prescan declined
   * the file. A file whose text sent it past the prescan was skipped, which
   * isn't cached: the prescan may still run on it later.
   */
  skeleton?: ImportRef[] | "refused";
  /** The static imports of a full parse. Never interchangeable with the skeleton. */
  full?: ImportRef[];
  /** The suppression comments of a full parse. */
  comments?: SuppressionComment[];
}

/**
 * One unit of work that needs nothing but a file's text (#61): its import
 * skeleton, or its full parse's static imports and suppression comments.
 * Plain data, so an adapter can hand it to another thread or process and
 * run it there with `createExtractionWorker`.
 */
export interface ExtractionJob {
  /** The source file, with normalised text. */
  file: SourceFile;
  /**
   * `"skeleton"` for the scan's text tests and the prescan, `"full"` for the
   * full parse's imports and comments.
   */
  want: "skeleton" | "full";
}

/** What running an `ExtractionJob` gives, in the extraction cache's terms. */
export interface ExtractionAnswer {
  /** The components computed; empty for a skeleton job whose file goes to the full parse. */
  extraction: CachedExtraction;
  /** For a `"skeleton"` job: whether the text names a loader, which sends it to the full parse (INW011). */
  dynamic?: boolean;
}

/**
 * Runs extraction jobs somewhere else, such as a pool of worker threads.
 * Each answer is what the engine would have computed itself; an undefined
 * answer (a job that wasn't run, or failed) leaves the job to the engine,
 * which then computes it as it would have without the batch.
 *
 * @param jobs - the jobs, in the engine's order.
 * @returns one answer per job, in the same order.
 */
export type ExtractionBatch = (
  jobs: readonly ExtractionJob[],
) => Promise<readonly (ExtractionAnswer | undefined)[]>;

/**
 * Where an adapter keeps extractions between checks. Synchronous, and
 * allowed to forget: `get` returns undefined for anything missing, stale or
 * unreadable, and `set` may drop an entry. It is acceleration, never a source
 * of truth, so no result may differ with or without it.
 */
export interface ExtractionCache {
  /**
   * Looks up what is known about a file's text.
   *
   * @param identity - the file and the engine's extraction revision.
   * @returns the cached components, or undefined on a miss.
   */
  get: (identity: ExtractionIdentity) => CachedExtraction | undefined;
  /**
   * Stores what is known about a file's text, replacing the previous entry.
   *
   * @param identity - the file and the engine's extraction revision.
   * @param value - every component known so far.
   */
  set: (identity: ExtractionIdentity, value: CachedExtraction) => void;
}
