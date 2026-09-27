/**
 * @file What the engine reads out of one file's text, through an optional
 * cache (#56): the prescan's import skeleton, the full parse's static imports,
 * and the suppression comments. Each comes from the adapter's
 * `ExtractionCache` when it holds it, else from a parse, and is stored back.
 * Dynamic imports (INW011) are never cached: whether an imported `eval` could
 * be the builtin depends on other files. Without a cache, every call parses,
 * exactly as before. This module only extracts; the engine keeps every
 * decision (which files get the prescan, confirmation, baseline shortcuts).
 */
import type { Parser, Tree } from "web-tree-sitter";
import type {
  CachedExtraction,
  ExtractionCache,
  ExtractionIdentity,
  ImportRef,
  SourceFile,
  SuppressionComment,
} from "../contracts/records.ts";
import { extractImports, parsePython } from "../python/parser.ts";
import { skeletonImports } from "../python/prescan.ts";
import { commentsIn } from "../rules/suppression-comment.ts";

/**
 * The extraction revision: part of every cache identity. Bump it whenever
 * normalisation, encoding interpretation, the prescan, import extraction,
 * module-name resolution, suppression parsing or the rule registry changes
 * what a text yields. `test/engine/extraction-revision.test.ts` fails until
 * it is bumped with them.
 */
export const EXTRACTION_REVISION = "1";

/** The static imports and suppression comments of a full parse. */
export interface FullExtraction {
  imports: ImportRef[];
  comments: SuppressionComment[];
}

/** Reads imports and comments out of files, through a cache when there is one. */
export class Extractor {
  private readonly parser: Parser;
  private readonly cache: ExtractionCache | undefined;

  /**
   * Keeps the parser and the optional cache.
   *
   * @param parser - parser with the Python grammar loaded.
   * @param cache - where extractions are kept between checks, if anywhere.
   */
  constructor(parser: Parser, cache: ExtractionCache | undefined) {
    this.parser = parser;
    this.cache = cache;
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
    const tree = parsePython(this.parser, src.text);
    try {
      return this.fromTree(src, tree, known);
    } finally {
      tree.delete(); // WASM memory is not garbage collected
    }
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
    return this.cache?.get(identityOf(src));
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
    this.cache?.set(identityOf(src), { ...known, ...extra });
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
