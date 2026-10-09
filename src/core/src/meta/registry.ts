/**
 * @file The rule registry: every rule's code, name, default severity, one-line
 * summary and docs link, in one place. Rule modules build their diagnostics
 * with `diagnostic()` and reporters list rules from `RULES`, so adding a rule
 * touches only its own module and this file. Whether a rule reports by default
 * lives here too; which rules a project turns on is `config/rule-settings.ts`.
 */

import type { Diagnostic, Fix, Severity, SourceFile, Span } from "../contracts/records.ts";
import { DOCS_BASE } from "./product.ts";

/** What every consumer (diagnostics, SARIF, docs) needs to know about a rule. */
export interface RuleMeta {
  /**
   * Stable code, e.g. `INW001`: `INW` or a family prefix such as `FAPI`, plus
   * three digits. Agents and suppressions refer to it.
   */
  code: string;
  /** Kebab-case name, e.g. `layer-dependency`. */
  name: string;
  severity: Severity;
  /**
   * Whether the rule reports without being asked to. An `"off"` (opt-in) rule
   * reports only when `[tool.inwards.rules]` lists it in `extend-select` or
   * `select` (#181).
   */
  default: "on" | "off";
  /** One sentence for SARIF `shortDescription` and rule listings. */
  summary: string;
  /** The rule's own docs page, `docs/chapters/rules/<code>.md` on the site. */
  docs: string;
}

/** Codes of every registered rule. */
type RuleCode =
  | "INW000"
  | "INW001"
  | "INW002"
  | "INW003"
  | "INW004"
  | "INW005"
  | "INW006"
  | "INW007"
  | "INW008"
  | "INW009"
  | "INW010"
  | "INW011"
  | "FAPI001"
  | "FAPI002"
  | "FAPI003"
  | "FAPI005";

/**
 * The URL of a rule's docs page. Diagnostics (text, JSON, SARIF `helpUri`,
 * LSP `codeDescription`) link straight to it; a test checks the page exists.
 *
 * @param code - the rule's code.
 * @returns the page's URL, with the trailing slash the site's directory URLs use.
 */
function page(code: RuleCode): string {
  return `${DOCS_BASE}/rules/${code}/`;
}

/** Each entry's `code` must equal its key, so the registry can't drift. */
export const RULES: { readonly [Code in RuleCode]: RuleMeta & { readonly code: Code } } = {
  INW000: {
    code: "INW000",
    name: "unsupported-encoding",
    severity: "error",
    default: "on",
    summary: "The file's declared encoding can hide imports.",
    docs: page("INW000"),
  },
  INW001: {
    code: "INW001",
    name: "layer-dependency",
    severity: "error",
    default: "on",
    summary: "Dependencies must point toward inner layers.",
    docs: page("INW001"),
  },
  INW002: {
    code: "INW002",
    name: "context-independence",
    severity: "error",
    default: "on",
    summary: "A bounded context imports another context only when it declares it in depends-on.",
    docs: page("INW002"),
  },
  INW003: {
    code: "INW003",
    name: "public-api-only",
    severity: "error",
    default: "on",
    summary: "Code outside a bounded context imports only the context's public modules.",
    docs: page("INW003"),
  },
  INW004: {
    code: "INW004",
    name: "import-cycles",
    severity: "error",
    default: "on",
    summary: "Modules, or bounded contexts, don't import each other in a cycle.",
    docs: page("INW004"),
  },
  INW005: {
    code: "INW005",
    name: "pure-domain",
    severity: "error",
    default: "on",
    summary: "A layer imports only the third-party and standard-library modules its config allows.",
    docs: page("INW005"),
  },
  INW006: {
    code: "INW006",
    name: "unassigned-module",
    severity: "error",
    default: "on",
    summary: "First-party code must belong to a layer, and every layer prefix must match modules.",
    docs: page("INW006"),
  },
  INW007: {
    code: "INW007",
    name: "package-shape",
    severity: "error",
    default: "on",
    summary:
      "A package holds only the members its configured shape allows, and names stay where they belong.",
    docs: page("INW007"),
  },
  INW008: {
    code: "INW008",
    name: "missing-member",
    severity: "error",
    default: "on",
    summary: "A package holds every member its configured shape requires.",
    docs: page("INW008"),
  },
  INW009: {
    code: "INW009",
    name: "suppression-comment",
    severity: "error",
    default: "on",
    summary:
      "An inline suppression names rules that can be suppressed, gives a reason, and hides a finding.",
    docs: page("INW009"),
  },
  INW010: {
    code: "INW010",
    name: "unknown-first-party",
    severity: "error",
    default: "on",
    summary: "An imported first-party module must exist.",
    docs: page("INW010"),
  },
  INW011: {
    code: "INW011",
    name: "dynamic-import",
    severity: "error",
    default: "on",
    summary:
      "Dynamic imports (importlib, __import__, runpy, exec) must point toward inner layers too.",
    docs: page("INW011"),
  },
  // The FastAPI family (#186): opt-in, with its own prefix. The checks land in
  // #183 and #184; FAPI004 is reserved until the #185 spike says go.
  FAPI001: {
    code: "FAPI001",
    name: "endpoint-metadata",
    severity: "error",
    default: "off",
    summary: "A FastAPI path operation declares the OpenAPI metadata the project requires.",
    docs: page("FAPI001"),
  },
  FAPI002: {
    code: "FAPI002",
    name: "undocumented-error-response",
    severity: "error",
    default: "off",
    summary: "A FastAPI path operation declares every error status code it can produce.",
    docs: page("FAPI002"),
  },
  FAPI003: {
    code: "FAPI003",
    name: "router-wiring",
    severity: "error",
    default: "off",
    summary:
      "Every APIRouter with routes is included in an app, and no routers include each other in a cycle.",
    docs: page("FAPI003"),
  },
  FAPI005: {
    code: "FAPI005",
    name: "route-shadowing",
    severity: "error",
    default: "off",
    summary:
      "No FastAPI path operation is shadowed by an earlier one with the same method, so every route can be reached.",
    docs: page("FAPI005"),
  },
};

/**
 * Looks a rule up by its code or its kebab-case name. Reads `RULES` on every
 * call rather than a map built at load time, so a test can register a rule of
 * its own.
 *
 * @param key - a code such as `INW001`, or a name such as `layer-dependency`.
 * @returns the rule, or undefined when no registered rule has that code or name.
 */
export function ruleFor(key: string): RuleMeta | undefined {
  return Object.values<RuleMeta>(RULES).find((rule) => rule.code === key || rule.name === key);
}

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
