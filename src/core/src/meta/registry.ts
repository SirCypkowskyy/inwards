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

/** Codes of every registered rule: INW000 to INW018, and the FAPI family without FAPI004. */
type RuleCode =
  | `INW00${0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9}`
  | `INW01${0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8}`
  | `FAPI00${1 | 2 | 3 | 5 | 6 | 7 | 8 | 9}`;

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
  // Opt-in, and a warning until corpus runs settle its thresholds (#182).
  INW012: {
    code: "INW012",
    name: "thin-endpoint",
    severity: "warning",
    default: "off",
    summary:
      "An HTTP endpoint reads the request, calls one use case and shapes the response; the logic, queries and outgoing calls live in other layers.",
    docs: page("INW012"),
  },
  // Opt-in, the first of #98's role-scoped content rules (#293).
  INW013: {
    code: "INW013",
    name: "async-blocking",
    severity: "error",
    default: "off",
    summary:
      "An async def makes no synchronous database, cache or cloud call: a sync SQLAlchemy Session, redis.Redis, boto3 or a blocking driver stalls the event loop.",
    docs: page("INW013"),
  },
  // Opt-in, a role-scoped content rule from #98 (#295).
  INW014: {
    code: "INW014",
    name: "ports-abstract",
    severity: "error",
    default: "off",
    summary:
      "A port module holds only ABCs and Protocols whose methods have no body; implementations live in adapters.",
    docs: page("INW014"),
  },
  // Opt-in, the role rule that keeps adapters in the composition root (#296).
  INW015: {
    code: "INW015",
    name: "construct-only-in",
    severity: "error",
    default: "off",
    summary:
      "Only the composition root imports and builds the modules of a guarded role, such as the outbound adapters; everything else takes them through a port.",
    docs: page("INW015"),
  },
  // Opt-in, one of #98's role-scoped content rules (#297).
  INW016: {
    code: "INW016",
    name: "orm-naming",
    severity: "error",
    default: "off",
    summary:
      "ORM table names and the names of datetime and date columns follow the project's scheme: lower_case_snake singular tables, _at for datetimes, _date for dates.",
    docs: page("INW016"),
  },
  // Opt-in and a warning: docs drift shouldn't block the Stop gate by default
  // (#332, ADR-045). INW019 is reserved for imports a diagram doesn't draw.
  INW017: {
    code: "INW017",
    name: "diagram-unknown-name",
    severity: "warning",
    default: "off",
    summary:
      "A node in a marked architecture diagram names a layer or context [tool.inwards] declares, and its quoted label a module that exists.",
    docs: page("INW017"),
  },
  INW018: {
    code: "INW018",
    name: "diagram-forbidden-edge",
    severity: "warning",
    default: "off",
    summary:
      "A solid arrow in a marked architecture diagram draws only imports [tool.inwards] allows.",
    docs: page("INW018"),
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
  FAPI006: {
    code: "FAPI006",
    name: "lifespan-events",
    severity: "error",
    default: "off",
    summary:
      "FastAPI apps use a lifespan context manager, not the deprecated on_event handlers, and never both, so every startup and shutdown handler runs.",
    docs: page("FAPI006"),
  },
  FAPI007: {
    code: "FAPI007",
    name: "yield-dependency-swallows",
    severity: "error",
    default: "off",
    summary:
      "A dependency with yield re-raises what its except clauses catch, so an error in the endpoint is not hidden from the server.",
    docs: page("FAPI007"),
  },
  FAPI008: {
    code: "FAPI008",
    name: "duplicate-operation-id",
    severity: "error",
    default: "off",
    summary:
      "No two path operations of one FastAPI app share an explicit operation_id, so generated clients get one method per operation.",
    docs: page("FAPI008"),
  },
  FAPI009: {
    code: "FAPI009",
    name: "depends-called",
    severity: "error",
    default: "off",
    summary:
      "Depends and Security get the dependency function, not the result of calling it at import time.",
    docs: page("FAPI009"),
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
