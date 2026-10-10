/**
 * @file What the engine reads out of one file's text, through an optional
 * cache (#56): the prescan's import skeleton, the full parse's static imports,
 * and the suppression comments. Each comes from the adapter's
 * `ExtractionCache` when it holds it, else from a parse, and is stored back.
 * Dynamic imports (INW011) are never cached: whether an imported `eval` could
 * be the builtin depends on other files. Without a cache, every call parses,
 * exactly as before. Extractions computed elsewhere (a worker pool, #61) are
 * preloaded per source file and read before the cache. This module only
 * extracts; the engine keeps every decision (which files get the prescan,
 * confirmation, baseline shortcuts).
 */
import type { Parser, Tree } from "web-tree-sitter";
import type {
  CachedExtraction,
  ExtractionAnswer,
  ExtractionBatch,
  ExtractionCache,
  ExtractionIdentity,
  ExtractionJob,
  ImportRef,
  SourceFile,
  SuppressionComment,
} from "../contracts/records.ts";
import {
  createPythonParser,
  extractImports,
  type GrammarBinaries,
  parsePython,
} from "../python/parser.ts";
import { skeletonImports } from "../python/prescan.ts";
import type { TreeReuse } from "../python/reparse.ts";
import { mentionsDynamicImport } from "../rules/dynamic-import/imports.ts";
import { commentsIn, mentionsSuppression } from "../rules/suppression-comment.ts";

/**
 * The extraction revision: part of every cache identity. Bump it whenever
 * normalisation, encoding interpretation, the prescan, import extraction,
 * module-name resolution, suppression parsing or the rule registry changes
 * what a text yields. `test/engine/extraction-revision.test.ts` fails until
 * it is bumped with them.
 */
export const EXTRACTION_REVISION = "13";

/** The static imports and suppression comments of a full parse. */
export interface FullExtraction {
  imports: ImportRef[];
  comments: SuppressionComment[];
}

/**
 * Runs one extraction job: the same computation the engine does when it
 * extracts a file itself, so a worker's answer can stand in for it. A
 * `"skeleton"` job first tests the text for a loader, as the engine's scan
 * does, and reads the skeleton only when neither a loader nor a suppression
 * comment sends the file to the full parse.
 *
 * @param parser - parser with the Python grammar loaded.
 * @param job - the file, with normalised text, and what to read out of it.
 * @returns the extraction, and for a `"skeleton"` job the loader test's answer.
 */
function extractJob(parser: Parser, job: ExtractionJob): ExtractionAnswer {
  if (job.want === "full") {
    const { imports, comments } = fullExtraction(parser, job.file);
    return { extraction: { full: imports, comments } };
  }
  const dynamic = mentionsDynamicImport(job.file.text);
  if (dynamic || mentionsSuppression(job.file.text)) {
    return { extraction: {}, dynamic };
  }
  return { extraction: { skeleton: skeletonImports(parser, job.file) ?? "refused" }, dynamic };
}

/**
 * Loads the grammar for a thread or process that runs extraction jobs and
 * nothing else (#61): the worker side of an `ExtractionBatch`.
 *
 * @param wasm - the tree-sitter runtime and Python grammar as WASM bytes.
 * @returns a function that runs one job, as `extractJob` does.
 */
export async function createExtractionWorker(
  wasm: GrammarBinaries,
): Promise<(job: ExtractionJob) => ExtractionAnswer> {
  const parser = await createPythonParser(wasm);
  return (job: ExtractionJob): ExtractionAnswer => extractJob(parser, job);
}

/**
 * Parses a whole file for its static imports and suppression comments.
 *
 * @param parser - parser with the Python grammar loaded.
 * @param src - the source file, with normalised text.
 * @param reuse - the last full parse to parse incrementally from (#122), if the caller keeps one.
 * @returns the imports and comments.
 */
function fullExtraction(parser: Parser, src: SourceFile, reuse?: TreeReuse): FullExtraction {
  const tree = reuse ? reuse.parse(parser, src.path, src.text) : parsePython(parser, src.text);
  try {
    return { imports: extractImports(tree, src), comments: commentsIn(tree) };
  } finally {
    tree.delete(); // WASM memory is not garbage collected
  }
}

/** Where an `Extractor` keeps what it computed, both optional. */
export interface ExtractionOptions {
  /** Where extractions are kept between checks. */
  cache?: ExtractionCache;
  /** The last full parse, for an incremental parse of the same file (#122). */
  reuse?: TreeReuse;
}

/** Reads imports and comments out of files, through a cache when there is one. */
export class Extractor {
  private readonly parser: Parser;
  private readonly cache: ExtractionCache | undefined;
  /** The last full parse, kept for an incremental parse of the same file (#122). */
  private readonly reuse: TreeReuse | undefined;
  /** Extractions computed elsewhere for this run's source files, read before the cache. */
  private readonly preloaded = new WeakMap<SourceFile, CachedExtraction>();
  /** The loader test's answers computed elsewhere, by source file. */
  private readonly loaders = new WeakMap<SourceFile, boolean>();

  /**
   * Keeps the parser, the optional cache and the optional kept parse.
   *
   * @param parser - parser with the Python grammar loaded.
   * @param options - where to keep what it computes.
   * @param options.cache - where extractions are kept between checks, if anywhere.
   * @param options.reuse - the last full parse, for an incremental parse of the same file, if kept.
   */
  constructor(parser: Parser, { cache, reuse }: ExtractionOptions) {
    this.parser = parser;
    this.cache = cache;
    this.reuse = reuse;
  }

  /**
   * The prescan's import skeleton of a file.
   *
   * @param src - the source file, with normalised text.
   * @returns the skeleton's imports, or null when the prescan refuses the file.
   */
  skeleton(src: SourceFile): ImportRef[] | null {
    const known = this.lookup(src);
    if (known?.skeleton !== undefined) {
      return known.skeleton === "refused" ? null : known.skeleton;
    }
    const refs = skeletonImports(this.parser, src);
    this.store(src, known, { skeleton: refs ?? "refused" });
    return refs;
  }

  /**
   * The static imports and suppression comments of a full parse, from the
   * cache when it holds both, else from a parse of the file.
   *
   * @param src - the source file, with normalised text.
   * @returns the imports and comments.
   */
  full(src: SourceFile): FullExtraction {
    const known = this.lookup(src);
    if (known?.full !== undefined && known.comments !== undefined) {
      return { imports: known.full, comments: known.comments };
    }
    const { imports, comments } = fullExtraction(this.parser, src, this.reuse);
    // A component the cache already held wins, as `fromTree` keeps it.
    const found = { imports: known?.full ?? imports, comments: known?.comments ?? comments };
    this.store(src, known, { full: found.imports, comments: found.comments });
    return found;
  }

  /**
   * Tells whether a file's extraction already holds a component, from a
   * preload or the cache, so nobody needs to compute it. What the cache
   * holds is kept with the preloads, since the check looks it up again.
   *
   * @param src - the source file, with normalised text.
   * @param want - the component: the skeleton, or the full parse's imports and comments.
   * @returns true when it is known.
   */
  private holds(src: SourceFile, want: ExtractionJob["want"]): boolean {
    const known = this.lookup(src);
    if (known !== undefined && !this.preloaded.has(src)) {
      this.preloaded.set(src, known); // the check reads it next: no second trip to the cache
    }
    return want === "skeleton"
      ? known?.skeleton !== undefined
      : known?.full !== undefined && known.comments !== undefined;
  }

  /**
   * Keeps what was computed elsewhere for one source file of this run, and
   * stores any new extraction in the cache too, as if the engine had computed it.
   *
   * @param src - the source file, with normalised text: the same object the engine checks.
   * @param answer - the components computed, and the loader test's answer if it ran.
   */
  private preload(src: SourceFile, answer: ExtractionAnswer): void {
    if (answer.dynamic !== undefined) {
      this.loaders.set(src, answer.dynamic);
    }
    if (Object.keys(answer.extraction).length === 0) {
      return;
    }
    const known = this.lookup(src);
    const merged = { ...known, ...answer.extraction };
    this.preloaded.set(src, merged);
    this.cache?.set(identityOf(src), merged);
  }

  /**
   * Hands the files whose extraction lacks a component to `extract` and
   * preloads the answers. A failed batch is ignored: the engine computes
   * what it needs itself, and any error it meets then surfaces as without
   * the batch.
   *
   * @param sources - the source files, with normalised text.
   * @param want - the component to compute.
   * @param extract - runs extraction jobs elsewhere.
   */
  async prefetch(
    sources: readonly SourceFile[],
    want: ExtractionJob["want"],
    extract: ExtractionBatch,
  ): Promise<void> {
    const jobs = sources.filter((file) => !this.holds(file, want)).map((file) => ({ file, want }));
    if (jobs.length === 0) {
      return;
    }
    const answers = await extract(jobs).catch((): readonly undefined[] => []);
    jobs.forEach(({ file }, n) => {
      const answer = answers[n];
      if (answer !== undefined) {
        this.preload(file, answer);
      }
    });
  }

  /**
   * Tells whether a file's text names a loader (`mentionsDynamicImport`),
   * from a preloaded answer when there is one.
   *
   * @param src - the source file, with normalised text.
   * @returns true when the file may hold a dynamic import.
   */
  mentionsLoader(src: SourceFile): boolean {
    return this.loaders.get(src) ?? mentionsDynamicImport(src.text);
  }

  /**
   * The static imports of a file whose imports all end by a given line, read
   * from a parse of the text up to that line: much less than the whole file
   * when the imports sit at the top (INW004's confirmation). That text parses
   * without an error only when the cut is outside every string, bracket and
   * continuation, and then Python tokenises it as it does the start of the
   * whole file, so it holds the same imports. Otherwise, the whole file is
   * parsed. Nothing is cached for the text up to the line.
   *
   * @param src - the source file, with normalised text.
   * @param lastLine - the 1-based line where its last import ends.
   * @returns its static imports.
   */
  importsUpTo(src: SourceFile, lastLine: number): readonly ImportRef[] {
    const known = this.lookup(src);
    if (known?.full !== undefined) {
      return known.full;
    }
    const end = lineEnd(src.text, lastLine);
    if (end < src.text.length) {
      const head = { ...src, text: src.text.slice(0, end) };
      const tree = parsePython(this.parser, head.text);
      try {
        if (!tree.rootNode.hasError) {
          return extractImports(tree, head);
        }
      } finally {
        tree.delete(); // WASM memory is not garbage collected
      }
    }
    return this.full(src).imports;
  }

  /**
   * The static imports and suppression comments of a tree the caller parsed
   * for its own reasons (dynamic imports), stored in the cache as well.
   *
   * @param src - the source file, with normalised text.
   * @param tree - its full parse.
   * @param known - what the cache held for it, if the caller looked already.
   * @returns the imports and comments.
   */
  fromTree(
    src: SourceFile,
    tree: Tree,
    known: CachedExtraction | undefined = this.lookup(src),
  ): FullExtraction {
    const imports = known?.full ?? extractImports(tree, src);
    const comments = known?.comments ?? commentsIn(tree);
    if (known?.full === undefined || known.comments === undefined) {
      this.store(src, known, { full: imports, comments });
    }
    return { imports, comments };
  }

  /**
   * Looks a file up in the cache.
   *
   * @param src - the source file, with normalised text.
   * @returns what the cache holds, or undefined without a cache or on a miss.
   */
  private lookup(src: SourceFile): CachedExtraction | undefined {
    return this.preloaded.get(src) ?? this.cache?.get(identityOf(src));
  }

  /**
   * Adds components to a file's cache entry.
   *
   * @param src - the source file, with normalised text.
   * @param known - the entry as last read, if any.
   * @param extra - the components just computed.
   */
  private store(
    src: SourceFile,
    known: CachedExtraction | undefined,
    extra: CachedExtraction,
  ): void {
    const merged = { ...known, ...extra };
    if (this.preloaded.has(src)) {
      this.preloaded.set(src, merged);
    }
    this.cache?.set(identityOf(src), merged);
  }
}

/**
 * Names what a file's extraction depends on.
 *
 * @param src - the source file, with normalised text.
 * @returns its cache identity.
 */
function identityOf(src: SourceFile): ExtractionIdentity {
  return {
    revision: EXTRACTION_REVISION,
    text: src.text,
    module: src.module,
    isPackage: src.isPackage,
  };
}

/**
 * Finds where a line ends, past its newline.
 *
 * @param text - normalised text.
 * @param line - a 1-based line; 0 for none.
 * @returns the offset just after that line's newline, or the text's length.
 */
function lineEnd(text: string, line: number): number {
  let end = 0;
  for (let n = 0; n < line; n += 1) {
    const next = text.indexOf("\n", end);
    if (next === -1) {
      return text.length;
    }
    end = next + 1;
  }
  return end;
}
