/**
 * @file FAPI008 `duplicate-operation-id` (#227): two path operations that one
 * app serves with the same literal `operation_id=` give a generated client
 * two methods with one name, and FastAPI only warns ("Duplicate Operation
 * ID") when it builds the schema at runtime. Every operation reachable from
 * an app (or from a router no app includes) is grouped by its id; each one
 * after the first is reported on its decorator, naming the first with file
 * and line. The same id on the operations of two different apps is fine.
 *
 * It reads the route lists FAPI005 reads (`route-list.ts`): the app and
 * router graph flattened through `include_router`. Unknown means silent: an
 * id that isn't a string literal, a `**kwargs` that may hide one, and an
 * operation left out of the schema (`include_in_schema=False`) are skipped.
 * An app-wide `generate_unique_id_function` changes nothing, as an explicit
 * `operation_id=` overrides it.
 */
import type { Diagnostic, SourceFile } from "../../contracts/records.ts";
import { diagnostic, RULES } from "../../meta/registry.ts";
import type { FastApiProject } from "./project.ts";
import type { FastApiFile, PathOperation } from "./records.ts";
import { fileRoutes, graphRoutes, type Route } from "./route-list.ts";
import { decoratorSpan, decoratorText } from "./syntax.ts";

/** An operation that repeats the id of an earlier one. */
interface Repeat {
  readonly route: Route;
  readonly first: Route;
  readonly id: string;
}

/**
 * Reads an operation's explicit id.
 *
 * @param op - the path operation.
 * @returns the id when `operation_id=` is a string literal, the operation is
 *   in the schema, and no `**kwargs` may hide another; otherwise null.
 */
function operationId(op: PathOperation): string | null {
  const id = op.keywords.get("operation_id")?.value;
  const schema = op.keywords.get("include_in_schema")?.value;
  const hidden = schema?.kind === "bool" && !schema.value;
  return op.splat || hidden || id?.kind !== "str" ? null : id.value;
}

/**
 * Finds the operations of one list that repeat an id an earlier one has.
 *
 * @param list - the routes of one app or top-level router, in order.
 * @param reported - the operations already reported, which a later list skips; added to in place.
 * @returns the repeats, in list order.
 */
function repeatsIn(list: readonly Route[], reported: Set<PathOperation>): Repeat[] {
  const firsts = new Map<string, Route>();
  const found: Repeat[] = [];
  for (const route of list) {
    const id = operationId(route.op);
    const first = id === null ? undefined : firsts.get(id);
    if (id === null) {
      continue;
    }
    if (first === undefined) {
      firsts.set(id, route);
    } else if (first.op !== route.op && !reported.has(route.op)) {
      reported.add(route.op);
      found.push({ route, first, id });
    }
  }
  return found;
}

/**
 * Finds the operations that repeat an earlier id in their app, each once.
 *
 * @param lists - route lists, one per app or top-level router, each in the order it holds them.
 * @returns the repeats, in list order.
 */
function repeats(lists: readonly (readonly Route[])[]): Repeat[] {
  const reported = new Set<PathOperation>();
  return lists.flatMap((list) => repeatsIn(list, reported));
}

/**
 * Builds the finding for a repeated id.
 *
 * @param repeat - the operation, the first one with the id, and the id.
 * @param repeat.route - the operation that repeats the id.
 * @param repeat.first - the first operation with it.
 * @param repeat.id - the shared operation_id.
 * @param src - the file the repeating operation is in.
 * @returns the diagnostic, on its decorator.
 */
function report({ route, first, id }: Repeat, src: SourceFile): Diagnostic {
  const other = `\`${decoratorText(first.op)}\` at ${first.file.path}:${decoratorSpan(first.op).line}`;
  return diagnostic(RULES.FAPI008, src, {
    span: decoratorSpan(route.op),
    message: `\`${decoratorText(route.op)}\` uses operation_id "${id}", which ${other} already uses: a generated client gets two methods with one name, and FastAPI only warns when it builds the schema.`,
    fix: {
      summary: "Give each operation its own operation_id.",
      steps: [
        `Rename the operation_id of this one, or of ${other}, so no two operations of the app share one.`,
        "If the ids should come from the function names, drop the explicit operation_id= and set generate_unique_id_function on the app instead.",
        "Don't change an id a published client already uses without telling the user: it renames the client's method.",
      ],
    },
  });
}

/**
 * Checks one file's operations against the ones above them on the same
 * router, which needs no other file.
 *
 * @param file - the file's FastAPI records.
 * @param src - the file, for the diagnostics.
 * @param scope - this check's FastAPI lookups.
 * @returns the file's findings.
 */
export function checkFileOperationIds(
  file: FastApiFile,
  src: SourceFile,
  scope: FastApiProject,
): Diagnostic[] {
  return repeats(fileRoutes(file, scope)).map((found) => report(found, src));
}

/**
 * Checks the whole project: every operation the checked files hold against
 * the others reachable from the same app.
 *
 * @param scope - this check's FastAPI lookups.
 * @param checked - the checked files, by path.
 * @returns the findings in the checked files.
 */
export function checkGraphOperationIds(
  scope: FastApiProject,
  checked: ReadonlyMap<string, SourceFile>,
): Diagnostic[] {
  return repeats(graphRoutes(scope)).flatMap((found) => {
    const src = checked.get(found.route.file.path);
    return src === undefined ? [] : [report(found, src)];
  });
}
