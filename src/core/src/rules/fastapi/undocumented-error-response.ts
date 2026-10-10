/**
 * @file FAPI002 `undocumented-error-response` (#183): a path operation that
 * can produce an error status code its OpenAPI entry doesn't declare. The
 * codes come from `error-codes.ts`, what is declared from the decorator and
 * from `placement.ts`; one finding per endpoint, on the decorator, names each
 * code and where it comes from, so an agent can check the claim.
 *
 * Unknown means silent: a decorator with `**kwargs`, a `responses=` Inwards
 * can't read, or an inclusion it can't place makes the endpoint (or the code)
 * unknown, and nothing is reported for it.
 */
import type { RuleOptions } from "../../config/rule-settings.ts";
import type { Diagnostic, SourceFile } from "../../contracts/records.ts";
import { diagnostic, RULES } from "../../meta/registry.ts";
import { joined } from "../shared/words.ts";
import { type CodeSource, CodeWalk } from "./error-codes.ts";
import { flag } from "./options.ts";
import { declaredBy, hiddenBy, ownPlacement, type Placement, placementOf } from "./placement.ts";
import type { FastApiProject } from "./project.ts";
import type { FastApiFile, PathOperation } from "./records.ts";
import { decoratorSpan, decoratorText } from "./syntax.ts";

/** FAPI002's options, with their defaults filled in. */
interface Options {
  /** The highest code that must be declared: 499 for `4xx`, 599 for `4xx-5xx`. */
  readonly highest: number;
  readonly maxDepth: number;
  readonly reportDirectRaises: boolean;
  readonly handledCountsAsDocumented: boolean;
  readonly explicit422: boolean;
}

/** How many origins a finding lists per code before it says how many more there are. */
const MAX_ORIGINS = 2;

/** The error codes FAPI002 looks at start here. */
const FIRST_ERROR = 400;
const LAST_CLIENT_ERROR = 499;
const LAST_SERVER_ERROR = 599;
/** FastAPI's validation error, which it documents itself for an operation with inputs. */
const VALIDATION_ERROR = 422;
/** How many calls deep FAPI002 follows by default. */
const DEFAULT_DEPTH = 2;

/**
 * Reads FAPI002's options table.
 *
 * @param raw - `[tool.inwards.rules.undocumented-error-response]`, validated.
 * @returns the options, defaults filled in.
 */
function optionsOf(raw: RuleOptions | undefined): Options {
  const depth = raw?.["max-depth"];
  return {
    highest: raw?.["codes"] === "4xx-5xx" ? LAST_SERVER_ERROR : LAST_CLIENT_ERROR,
    maxDepth: typeof depth === "number" ? depth : DEFAULT_DEPTH,
    reportDirectRaises: flag(raw, "report-direct-raises", true),
    handledCountsAsDocumented: flag(raw, "handled-counts-as-documented", false),
    explicit422: raw?.["explicit-422"] === "report",
  };
}

/**
 * Reports the path operations of one file that can produce error codes their
 * OpenAPI entry doesn't declare.
 *
 * @param src - the file.
 * @param file - its FastAPI records.
 * @param scope - the project lookups.
 * @param raw - the rule's options table, if any.
 * @returns one FAPI002 diagnostic per such operation.
 */
export function checkUndocumentedErrors(
  src: SourceFile,
  file: FastApiFile,
  scope: FastApiProject,
  raw: RuleOptions | undefined,
): Diagnostic[] {
  const options = optionsOf(raw);
  return file.operations.flatMap((op) => {
    const missing = undeclared(op, file, { scope, options });
    return missing.size === 0 ? [] : [report(op, src, missing)];
  });
}

/**
 * Finds the codes one operation can produce and doesn't declare.
 *
 * @param op - the path operation.
 * @param file - its file.
 * @param tools - what the check needs.
 * @param tools.scope - the project lookups.
 * @param tools.options - the rule's options.
 * @returns the undeclared codes with their origins, empty when there are none or it's unknown.
 */
function undeclared(
  op: PathOperation,
  file: FastApiFile,
  { scope, options }: { scope: FastApiProject; options: Options },
): Map<number, CodeSource[]> {
  const object = scope.objectOf(op.receiver);
  const own = declaredBy(op, scope);
  if (object === null || own === null || hiddenBy(op)) {
    return new Map();
  }
  const walk = new CodeWalk(scope, options.maxDepth, object);
  // A per-edit check reads the inclusions above a router only for a code its own router misses.
  if (scope.lazy && object.kind === "router") {
    const local = codesBelow(op, file, ownPlacement(object, scope), { scope, walk, options });
    if (local.size === 0) {
      return local;
    }
  }
  return codesBelow(op, file, placementOf(object, scope), { scope, walk, options });
}

/**
 * Finds the codes one operation can produce that neither it nor what sits
 * above it declares.
 *
 * @param op - the path operation.
 * @param file - its file.
 * @param placement - what sits above it.
 * @param tools - what the check needs.
 * @param tools.scope - the project lookups.
 * @param tools.walk - reads the codes of functions.
 * @param tools.options - the rule's options.
 * @returns the undeclared codes with their origins.
 */
function codesBelow(
  op: PathOperation,
  file: FastApiFile,
  placement: Placement,
  { scope, walk, options }: { scope: FastApiProject; walk: CodeWalk; options: Options },
): Map<number, CodeSource[]> {
  const own = declaredBy(op, scope) ?? new Set<string>();
  const qualify = scope.model.qualifierOf(file);
  if (placement.hidden || qualify === null) {
    return new Map();
  }
  const frame = { node: op.function, name: op.name, path: file.path, qualify };
  const decorated = op.keywords.get("dependencies")?.value;
  const dependencies = [
    ...(decorated?.kind === "list" ? decorated.items : []),
    ...placement.dependencies,
  ];
  const sources = [
    ...walk.codesOf(frame, 0),
    ...dependencies.flatMap((d) => walk.dependency(d, 0)),
  ].filter((s) => relevant(s, op, dependencies.length > 0, options));
  const byCode = new Map<number, CodeSource[]>();
  for (const source of sources.filter((s) => !declares(own, placement, s.code))) {
    byCode.set(source.code, [...(byCode.get(source.code) ?? []), source]);
  }
  const handledOnly = [...byCode].filter(([, list]) => list.every((s) => s.handled));
  for (const [code] of options.handledCountsAsDocumented ? handledOnly : []) {
    byCode.delete(code);
  }
  return byCode;
}

/**
 * Tells whether a code is declared, or may be where Inwards can't read.
 *
 * @param own - the keys the decorator declares.
 * @param placement - what sits above the operation.
 * @param code - the status code.
 * @returns true when the decorator or something above declares it, by its
 *   own key, its `4XX` or `5XX` wildcard or `default`, or when what is above is unknown.
 */
function declares(own: ReadonlySet<string>, placement: Placement, code: number): boolean {
  const { responses } = placement;
  const keys = [String(code), `${String(code).slice(0, 1)}XX`, "DEFAULT"];
  return keys.some((k) => own.has(k) || responses === null || responses.has(k));
}

/**
 * Tells whether a code is one the options ask about.
 *
 * @param source - the code and its origin.
 * @param op - the operation.
 * @param dependencies - true when dependencies above or on it take parameters of their own.
 * @param options - the rule's options.
 * @returns true to keep it.
 */
function relevant(
  source: CodeSource,
  op: PathOperation,
  dependencies: boolean,
  options: Options,
): boolean {
  const { code } = source;
  if (
    code < FIRST_ERROR ||
    code > options.highest ||
    (source.direct && !options.reportDirectRaises)
  ) {
    return false;
  }
  // FastAPI documents 422 itself for an operation that takes parameters or a body.
  const parameters = op.function.childForFieldName("parameters");
  const takesInput = dependencies || (parameters !== null && parameters.namedChildCount > 0);
  return !(code === VALIDATION_ERROR && !options.explicit422 && takesInput);
}

/**
 * Builds the finding for one operation.
 *
 * @param op - the operation.
 * @param src - its file.
 * @param missing - the undeclared codes with their origins.
 * @returns the diagnostic, on the decorator.
 */
function report(
  op: PathOperation,
  src: SourceFile,
  missing: ReadonlyMap<number, readonly CodeSource[]>,
): Diagnostic {
  const codes = [...missing.keys()].sort((a, b) => a - b);
  const listed = joined(codes.map(String));
  const traced = joined(codes.map((code) => `${code} (${origins(missing.get(code) ?? [])})`));
  const decorator = decoratorText(op);
  const entries = codes.map((code) => `${code}: {"description": "..."}`).join(", ");
  const neither = codes.length === 1 ? "doesn't declare it" : "declares none of them";
  return diagnostic(RULES.FAPI002, src, {
    span: decoratorSpan(op),
    message: `\`${op.name}\` can return ${listed}, which its OpenAPI entry doesn't declare.`,
    fix: {
      summary: `Declare ${listed} in \`responses=\` on \`${decorator}\`.`,
      steps: [
        `\`${op.name}\` can return ${traced}, but its OpenAPI entry ${neither}.`,
        `Add \`responses={${entries}}\` to the decorator (with a "model" where the error has a body), or to \`APIRouter(...)\` if every route shares them.`,
        "Don't remove the `raise`, and don't catch the error only to silence this finding: clients generated from the schema need to know the error exists.",
      ],
    },
  });
}

/**
 * Describes where a code comes from, a few origins at most.
 *
 * @param sources - the code's origins.
 * @returns the text, e.g. "from `load_or_404` at app/orders.py:12".
 */
function origins(sources: readonly CodeSource[]): string {
  const unique = [...new Set(sources.map((s) => s.origin))];
  const more = unique.length - MAX_ORIGINS;
  const shown = unique.slice(0, MAX_ORIGINS).join("; ");
  return more > 0 ? `${shown}; and ${more} more` : shown;
}
