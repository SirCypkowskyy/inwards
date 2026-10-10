/**
 * @file FAPI001 `endpoint-metadata` (#183): a path operation in the OpenAPI
 * schema that lacks metadata the project requires: a summary or docstring, a
 * response model, an explicit status code on some methods, fields in each
 * `responses=` entry, and, when turned on, tags and an `operation_id`. One
 * finding per endpoint, on the decorator, lists everything missing.
 *
 * Unknown means silent: a decorator with `**kwargs` is skipped whole, and
 * tags that could come from an inclusion Inwards can't place count as given.
 * Nothing here overlaps Ruff's `FAST` rules, which look at redundant models,
 * `Depends` without `Annotated`, and unused path parameters.
 */
import type { Node } from "web-tree-sitter";
import type { RuleOptions } from "../../config/rule-settings.ts";
import type { Diagnostic, SourceFile } from "../../contracts/records.ts";
import { diagnostic, RULES } from "../../meta/registry.ts";
import { namedChildren } from "../../python/nodes.ts";
import type { Qualify } from "../../python/qualify.ts";
import { joined } from "../shared/words.ts";
import { flag, list } from "./options.ts";
import { hiddenBy, placementOf } from "./placement.ts";
import type { FastApiProject } from "./project.ts";
import type { FastApiFile, FastApiObject, PathOperation } from "./records.ts";
import { statusCode } from "./status.ts";
import { decoratorSpan, decoratorText } from "./syntax.ts";
import type { Value } from "./values.ts";

/** FAPI001's options, with their defaults filled in. */
interface Options {
  readonly requireSummary: "summary-or-docstring" | "summary" | false;
  readonly requireResponseModel: boolean;
  readonly requireStatusCode: readonly string[];
  readonly requireResponseFields: readonly string[];
  readonly requireTags: boolean;
  readonly requireOperationId: boolean;
}

/** One missing piece: how the message names it, and what the fix adds. */
interface Gap {
  readonly noun: string;
  readonly add: string;
}

/** A response class FastAPI can't build a schema from, as a return annotation. */
const RESPONSE_CLASS = /^(?:fastapi|starlette)(?:\.responses)?\.\w*Response$/u;

/** The status code the fix suggests for a method, when the project requires one. */
const SUGGESTED: Readonly<Record<string, string>> = { post: "201", delete: "204" };

/** No Content: a route that answers with it has no body, so it needs no response model. */
const NO_CONTENT = 204;

/**
 * Reads FAPI001's options table.
 *
 * @param raw - `[tool.inwards.rules.endpoint-metadata]`, validated.
 * @returns the options, defaults filled in.
 */
function optionsOf(raw: RuleOptions | undefined): Options {
  const summary = raw?.["require-summary"];
  return {
    requireSummary: summary === "summary" || summary === false ? summary : "summary-or-docstring",
    requireResponseModel: flag(raw, "require-response-model", true),
    requireStatusCode: list(raw, "require-status-code", ["post", "delete"]),
    requireResponseFields: list(raw, "require-response-fields", ["description"]),
    requireTags: flag(raw, "require-tags", false),
    requireOperationId: flag(raw, "require-operation-id", false),
  };
}

/**
 * Reports the path operations of one file that lack required metadata.
 *
 * @param src - the file.
 * @param file - its FastAPI records.
 * @param scope - the project lookups.
 * @param raw - the rule's options table, if any.
 * @returns one FAPI001 diagnostic per such operation.
 */
export function checkEndpointMetadata(
  src: SourceFile,
  file: FastApiFile,
  scope: FastApiProject,
  raw: RuleOptions | undefined,
): Diagnostic[] {
  const options = optionsOf(raw);
  const qualify = scope.model.qualifierOf(file);
  return file.operations.flatMap((op) => {
    const object = scope.objectOf(op.receiver);
    if (op.splat || hiddenBy(op) || object === null || qualify === null || hiddenBy(object)) {
      return [];
    }
    const gaps = gapsOf(op, { object, scope, qualify, options });
    const placed = gaps.length > 0 && object.kind === "router" ? placementOf(object, scope) : null;
    const shown = gaps.filter(
      (g) => g.noun !== "tags" || placed?.tagged === false || object.kind === "app",
    );
    return shown.length === 0 || placed?.hidden ? [] : [report(op, src, shown)];
  });
}

/**
 * Lists what one operation lacks. Tags count as missing here when the
 * operation and its own router have none; the caller then asks what sits above.
 *
 * @param op - the operation.
 * @param ctx - what the check needs.
 * @param ctx.object - the app or router it is declared on.
 * @param ctx.scope - the project lookups.
 * @param ctx.qualify - qualifies names in its file.
 * @param ctx.options - the rule's options.
 * @returns the gaps, in the order the message lists them.
 */
function gapsOf(
  op: PathOperation,
  ctx: { object: FastApiObject; scope: FastApiProject; qualify: Qualify; options: Options },
): Gap[] {
  const { scope, qualify, options } = ctx;
  const gaps = keywordGaps(op, ctx.object, options);
  gaps.push(...fieldGaps(op.keywords.get("responses")?.value, options.requireResponseFields));
  const code = op.keywords.get("status_code")?.value;
  const noContent = code !== undefined && statusCode(code, (n) => scope.constant(n)) === NO_CONTENT;
  const annotated = usableReturn(op.function, qualify, scope);
  if (
    options.requireResponseModel &&
    !(op.keywords.has("response_model") || noContent || annotated)
  ) {
    gaps.push({ noun: "response model", add: "a return annotation or `response_model=...`" });
  }
  return gaps;
}

/**
 * Lists the keywords one operation lacks: summary, status code, operation
 * id and tags.
 *
 * @param op - the operation.
 * @param object - the app or router it is declared on.
 * @param options - the rule's options.
 * @returns the gaps, in the order the message lists them.
 */
function keywordGaps(op: PathOperation, object: FastApiObject, options: Options): Gap[] {
  const { keywords } = op;
  const gaps: Gap[] = [];
  const docstring = options.requireSummary === "summary-or-docstring" && hasDocstring(op.function);
  if (options.requireSummary !== false && !(keywords.has("summary") || docstring)) {
    const or = options.requireSummary === "summary" ? "" : " (or a docstring)";
    gaps.push({ noun: "summary", add: `\`summary="..."\`${or}` });
  }
  const methods = op.methods === "unknown" ? [] : op.methods;
  const method = methods.find((m) => options.requireStatusCode.includes(m));
  if (method !== undefined && !keywords.has("status_code")) {
    gaps.push({
      noun: "explicit status code",
      add: `\`status_code=${SUGGESTED[method] ?? "..."}\``,
    });
  }
  if (options.requireOperationId && !keywords.has("operation_id")) {
    gaps.push({ noun: "operation_id", add: `\`operation_id="${op.name}"\`` });
  }
  if (
    options.requireTags &&
    !(keywords.has("tags") || object.keywords.has("tags") || object.splat)
  ) {
    gaps.push({ noun: "tags", add: "`tags=[...]` (here or on its router)" });
  }
  return gaps;
}

/**
 * Lists the `responses=` entries that lack a required field.
 *
 * @param responses - the keyword's value, if given.
 * @param required - the fields every entry needs.
 * @returns one gap per entry, none when the value or an entry isn't a literal dict.
 */
function fieldGaps(responses: Value | undefined, required: readonly string[]): Gap[] {
  const entries = responses?.kind === "dict" ? responses.entries : [];
  return entries.flatMap(([key, entry]) => {
    const fields =
      entry.kind === "dict" && entry.spread.length === 0
        ? entry.entries.flatMap(([k]) => (k.kind === "str" ? [k.value] : []))
        : null;
    const lacking = fields === null ? [] : required.filter((f) => !fields.includes(f));
    let label = key.kind === "int" ? String(key.value) : "";
    if (key.kind === "str") {
      label = `"${key.value}"`;
    }
    if (lacking.length === 0 || label === "") {
      return [];
    }
    const quoted = lacking.map((f) => `"${f}"`);
    return [
      {
        noun: `${joined(quoted)} in responses[${label}]`,
        add: `${joined(quoted)} to responses[${label}]`,
      },
    ];
  });
}

/**
 * Tells whether a function starts with a docstring.
 *
 * @param fn - a `function_definition` node.
 * @returns true when its first statement is a string.
 */
function hasDocstring(fn: Node): boolean {
  const body = fn.childForFieldName("body");
  const [first] = body ? namedChildren(body) : [];
  const [expr] = first?.type === "expression_statement" ? namedChildren(first) : [];
  return expr?.type === "string" || expr?.type === "concatenated_string";
}

/**
 * Tells whether a function's return annotation gives FastAPI a response
 * model: present, and not `Response` or a subclass of it.
 *
 * @param fn - a `function_definition` node.
 * @param qualify - qualifies names in its file.
 * @param scope - resolves first-party classes.
 * @returns true for a usable annotation.
 */
function usableReturn(fn: Node, qualify: Qualify, scope: FastApiProject): boolean {
  const type = fn.childForFieldName("return_type");
  const [expr] = type ? namedChildren(type) : [];
  if (!expr) {
    return false;
  }
  const name = expr.type === "identifier" || expr.type === "attribute" ? qualify(expr) : null;
  if (name === null) {
    return true;
  }
  const bases = scope.lineage(name)?.external ?? [];
  return !(RESPONSE_CLASS.test(name) || [...bases].some((b) => RESPONSE_CLASS.test(b)));
}

/**
 * Builds the finding for one operation.
 *
 * @param op - the operation.
 * @param src - its file.
 * @param gaps - what it lacks.
 * @returns the diagnostic, on the decorator.
 */
function report(op: PathOperation, src: SourceFile, gaps: readonly Gap[]): Diagnostic {
  const decorator = `\`${decoratorText(op)}\``;
  const model = gaps.find((g) => g.noun === "response model");
  const keywords = gaps.filter((g) => g !== model).map((g) => g.add);
  let add = `Add ${joined(keywords)} to ${decorator}`;
  if (model && keywords.length > 0) {
    add = `${add}, and ${model.add}`;
  } else if (model) {
    add = `Add ${model.add} to ${decorator}`;
  }
  const method =
    op.methods === "unknown" ? "" : `${op.methods.map((m) => m.toUpperCase()).join(", ")} `;
  const path = op.path?.kind === "str" ? op.path.value : "";
  return diagnostic(RULES.FAPI001, src, {
    span: decoratorSpan(op),
    message: `\`${op.name}\` (${method}${path}) has no ${joined(
      gaps.map((g) => g.noun),
      "or",
    )} in its OpenAPI metadata.`,
    fix: {
      summary: `Declare the missing OpenAPI metadata on ${decorator}.`,
      steps: [
        `${add}.`,
        "Write a summary that says what the endpoint does, not the function name; declare the model the endpoint really returns.",
        "If the project doesn't want this metadata, ask the user to change [tool.inwards.rules.endpoint-metadata]; don't edit [tool.inwards] yourself.",
      ],
    },
  });
}
