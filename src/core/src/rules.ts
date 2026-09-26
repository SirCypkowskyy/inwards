/**
 * The rule registry: every rule's code, name, default severity, one-line
 * summary and docs link, in one place. Rule modules build their diagnostics
 * with `diagnostic()` and reporters list rules from `RULES`, so adding a rule
 * touches only its own module and this file.
 */
import { DOCS_BASE } from "./meta.ts";
import type { Diagnostic, Fix, Severity, SourceFile, Span } from "./types.ts";

/** What every consumer (diagnostics, SARIF, docs) needs to know about a rule. */
export interface RuleMeta {
  /** Stable code, e.g. `INW001`. Agents and suppressions refer to it. */
  code: string;
  /** Kebab-case name, e.g. `layer-dependency`. */
  name: string;
  severity: Severity;
  /** One sentence for SARIF `shortDescription` and rule listings. */
  summary: string;
  docs: string;
}

const CATALOGUE = `${DOCS_BASE}/03-Architecture-C4/#rule-catalogue`;

/** Codes of every registered rule. */
type RuleCode = "INW000" | "INW001" | "INW006" | "INW007" | "INW008" | "INW011";

/** Each entry's `code` must equal its key, so the registry can't drift. */
export const RULES: { readonly [Code in RuleCode]: RuleMeta & { readonly code: Code } } = {
  INW000: {
    code: "INW000",
    name: "unsupported-encoding",
    severity: "error",
    summary: "The file's declared encoding can hide imports.",
    docs: CATALOGUE,
  },
  INW001: {
    code: "INW001",
    name: "layer-dependency",
    severity: "error",
    summary: "Dependencies must point toward inner layers.",
    docs: CATALOGUE,
  },
  INW006: {
    code: "INW006",
    name: "unassigned-module",
    severity: "error",
    summary: "First-party code must belong to a layer, and every layer prefix must match modules.",
    docs: CATALOGUE,
  },
  INW007: {
    code: "INW007",
    name: "package-shape",
    severity: "error",
    summary:
      "A package holds only the members its configured shape allows, and names stay where they belong.",
    docs: CATALOGUE,
  },
  INW008: {
    code: "INW008",
    name: "missing-member",
    severity: "error",
    summary: "A package holds every member its configured shape requires.",
    docs: CATALOGUE,
  },
  INW011: {
    code: "INW011",
    name: "dynamic-import",
    severity: "error",
    summary:
      "Dynamic imports (importlib, __import__, runpy, exec) must point toward inner layers too.",
    docs: CATALOGUE,
  },
};

/** Where a finding is and what it says: the parts a rule module decides. */
export interface Finding {
  span: Span;
  /** What is wrong, in one or two sentences. */
  message: string;
  fix: Fix;
  /** Overrides the rule's default severity, e.g. INW006 warns about a lone dead prefix. */
  severity?: Severity;
}

/**
 * Builds a diagnostic for a rule, filling in what the registry already knows.
 *
 * @param rule - the rule's registry entry.
 * @param file - the file the finding is in.
 * @param finding - where (1-based span), what is wrong, and the repair advice.
 * @returns the complete diagnostic.
 */
export function diagnostic(rule: RuleMeta, file: SourceFile, finding: Finding): Diagnostic {
  const { span, message, fix, severity = rule.severity } = finding;
  return {
    code: rule.code,
    rule: rule.name,
    severity,
    file: file.path,
    module: file.module,
    line: span.line,
    column: span.column,
    endLine: span.endLine,
    endColumn: span.endColumn,
    message,
    fix,
    docs: rule.docs,
  };
}
