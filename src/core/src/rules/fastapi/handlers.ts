/**
 * @file The exception handlers an app registers, as the FastAPI model records
 * them: from `@app.exception_handler(X)`, `app.add_exception_handler(X, h)`
 * and `FastAPI(exception_handlers={X: h})`, also when the table comes through
 * a name or a `**kwargs` splat, with the literal status codes of the
 * responses each handler returns. A handler defined in another file is
 * recorded by name only; `model.ts` resolves it.
 */
import type { Node } from "web-tree-sitter";
import { identifierName, integerLiteral, keywordOf, namedChildren } from "../../python/nodes.ts";
import { dictKeys, dictsOf, entryOf, splattedDicts } from "./kwargs.ts";
import type { Context, ExceptionHandler, FastApiObject, Registration } from "./records.ts";
import { valueFrom } from "./values.ts";

/** A status constant such as `status.HTTP_404_NOT_FOUND`, which spells its code. */
const STATUS_NAME = /^HTTP_(?<code>\d{3})(?:_|$)/u;

/**
 * Builds a handler record. A handler given by name is looked up among the
 * file's module-level functions; one a decorator decorates comes as its
 * `function_definition`. A handler in another file keeps no function and no
 * status codes here: resolve its name through the model.
 *
 * @param registration - the registration as written.
 * @param context - the file, its qualifier and its functions.
 * @returns the handler record.
 */
export function handlerOf(registration: Registration, context: Context): ExceptionHandler {
  const { app, via, node, exception, handler } = registration;
  const { file, qualify, functions } = context;
  const decorated = handler?.type === "function_definition" ? handler : null;
  const nameNode = decorated ? decorated.childForFieldName("name") : handler;
  const name = nameNode ? qualify(nameNode) : null;
  const local = name?.startsWith(`${file.module}.`) ? name.slice(file.module.length + 1) : "";
  const fn = decorated ?? functions.get(local) ?? null;
  return {
    app,
    via,
    exception: exception ? valueFrom(exception, qualify) : { kind: "unknown" },
    handler: name,
    function: fn,
    statusCodes: fn ? returnedStatusCodes(fn) : [],
    node,
  };
}

/**
 * Reads the handlers an app's constructor registers: `exception_handlers=`
 * given as a dict or a name bound to one, and an `"exception_handlers"` entry
 * in a dict splatted into the call (`FastAPI(**kwargs)`, #242), followed
 * through `kwargs.ts`. A table Inwards can't read gives one handler whose
 * exception is unknown, so the app's handlers count as unknown.
 *
 * @param object - an app or router.
 * @param context - the file, its qualifier and its functions.
 * @returns one handler per table entry, none for a router or an app without tables.
 */
export function constructorHandlers(object: FastApiObject, context: Context): ExceptionHandler[] {
  if (object.kind !== "app") {
    return [];
  }
  const keyword = object.keywords.get("exception_handlers")?.node;
  const tables: (Node | null)[] = keyword ? (dictsOf(keyword) ?? [null]) : [];
  for (const dict of splattedDicts(object.node) ?? [null]) {
    const entry = dict === null ? null : entryOf(dict, "exception_handlers");
    if (dict === null || dictKeys(dict) === null) {
      tables.push(null);
    } else if (entry) {
      tables.push(...(dictsOf(entry) ?? [null]));
    }
  }
  const via: ExceptionHandler["via"] = "exception_handlers";
  const unknown = { app: object.name, via, node: object.node, exception: null, handler: null };
  return tables.flatMap((table) => {
    const entries = table ? namedChildren(table).filter((c) => c.type !== "comment") : [];
    return table === null || entries.some((pair) => pair.type !== "pair")
      ? [handlerOf(unknown, context)]
      : entries.map((pair) => {
          const node = table.id === keyword?.id ? object.node : pair;
          const exception = pair.childForFieldName("key");
          const handler = pair.childForFieldName("value");
          return handlerOf({ app: object.name, via, node, exception, handler }, context);
        });
  });
}

/**
 * Tells whether the `**` splats of an app's constructor set nothing but
 * `exception_handlers`, which `constructorHandlers` reads: the app's other
 * keywords are then all written out, and the splat hides nothing.
 *
 * @param call - the `FastAPI(...)` call.
 * @returns true when every dict the splats can hold has only that key.
 */
export function splatsOnlyHandlers(call: Node): boolean {
  const dicts = splattedDicts(call);
  return dicts?.every((dict) => dictKeys(dict)?.every((k) => k === "exception_handlers")) === true;
}

/**
 * Lists the literal status codes of the responses a handler returns:
 * `return JSONResponse(..., status_code=409)`, or a `status.HTTP_409_*` constant.
 *
 * @param fn - a `function_definition` node.
 * @returns the codes, in source order.
 */
export function returnedStatusCodes(fn: Node): number[] {
  return fn.descendantsOfType("return_statement").flatMap((ret) => {
    const [call] = ret ? namedChildren(ret) : [];
    const list = call?.type === "call" ? call.childForFieldName("arguments") : null;
    const status = (list ? namedChildren(list) : []).find(
      (arg) => arg.type === "keyword_argument" && keywordOf(arg) === "status_code",
    );
    const value = status?.childForFieldName("value");
    const code = value ? statusCode(value) : null;
    return code === null ? [] : [code];
  });
}

/**
 * Reads a status code: an integer literal, or a constant that spells it.
 *
 * @param node - an expression node.
 * @returns the code, or null when the node is neither.
 */
function statusCode(node: Node): number | null {
  const attribute = node.type === "attribute" ? node.childForFieldName("attribute") : null;
  const spelled = attribute ? STATUS_NAME.exec(identifierName(attribute))?.groups?.["code"] : null;
  return spelled ? Number(spelled) : integerLiteral(node);
}
