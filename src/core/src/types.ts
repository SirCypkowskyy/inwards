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
