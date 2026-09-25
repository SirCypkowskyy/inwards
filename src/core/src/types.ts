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
  /** Fully resolved dotted target, e.g. `shop.infrastructure.db.OrderTable`. */
  target: string;
  /** The import statement exactly as written. */
  statement: string;
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
