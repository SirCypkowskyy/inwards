/**
 * @file The records the FastAPI model hands to the FAPI rules: apps and
 * routers, path operations, wiring edges, exception handlers, and one file's
 * worth of them, plus what the readers in this folder pass each other. Plain
 * data holding syntax nodes, which stay valid until the model that made them
 * is disposed; no behaviour lives here.
 */
import type { Node } from "web-tree-sitter";
import type { SourceFile } from "../../contracts/records.ts";
import type { CallSyntax, Qualify, Value } from "./values.ts";

/** A name bound to `FastAPI(...)` or `APIRouter(...)`, with the constructor call. */
export interface FastApiObject extends CallSyntax {
  readonly kind: "app" | "router";
  /** The qualified name, e.g. `app.routers.users.router`. */
  readonly name: string;
  /** The name as bound in the file, e.g. `router`. */
  readonly local: string;
  /** False when the assignment sits in a function or class, e.g. an app factory. */
  readonly topLevel: boolean;
}

/** A path operation: `@router.get("/path", ...)` on a function, or `@app.api_route(...)`. */
export interface PathOperation extends CallSyntax {
  /** The qualified name of the app or router it is declared on. */
  readonly receiver: string;
  /** The decorator's attribute, e.g. `get` or `api_route`. */
  readonly decorator: string;
  /** Lower-case HTTP methods, or `unknown` when `methods=` isn't a literal list. */
  readonly methods: readonly string[] | "unknown";
  /** The path argument, or null when the call doesn't give one. */
  readonly path: Value | null;
  /** The decorated `function_definition` node. */
  readonly function: Node;
  /** The function's name. */
  readonly name: string;
}

/** An `include_router(target, ...)` or `mount(path, target)` call. */
export interface Wiring extends CallSyntax {
  readonly kind: "include" | "mount";
  /** The qualified name of the app or router the call is made on. */
  readonly receiver: string;
  /** The qualified name of the router or app included, or null when it isn't a name. */
  readonly target: string | null;
  /** The mount path, or `prefix=` of an inclusion; null when not given. */
  readonly path: Value | null;
  /**
   * When the target is the variable of an enclosing `for` loop over a list or
   * tuple literal (`for r in [a.router, b.router]: app.include_router(r)`),
   * the qualified names of the literal's items, null for an item that isn't a
   * name; empty otherwise.
   */
  readonly loopTargets: readonly (string | null)[];
}

/** An exception handler an app registers, and the status codes its responses set. */
export interface ExceptionHandler {
  /** The qualified name of the app. */
  readonly app: string;
  readonly via: "decorator" | "add_exception_handler" | "exception_handlers";
  /** The exception class (a name) or the status code (an int) handled. */
  readonly exception: Value;
  /** The handler's qualified name, or null when it isn't a name. */
  readonly handler: string | null;
  /** The handler's `function_definition` when it is in the same file. */
  readonly function: Node | null;
  /** The literal `status_code=` of each response the handler returns, when its function is known. */
  readonly statusCodes: readonly number[];
  /** The registering call: the decorator's, `add_exception_handler`, or `FastAPI(...)`. */
  readonly node: Node;
}

/** An `on_event` decorator or an `add_event_handler` call: the deprecated startup and shutdown hooks. */
export interface EventHandlerUse extends CallSyntax {
  /** The qualified name of the app or router it is registered on. */
  readonly receiver: string;
  readonly via: "on_event" | "add_event_handler";
  /** The event argument (`"startup"` or `"shutdown"`), or null when the call doesn't give one. */
  readonly event: Value | null;
}

/** What one file holds, as the FAPI rules see it. */
export interface FastApiFile {
  readonly path: string;
  readonly module: string;
  readonly objects: readonly FastApiObject[];
  readonly operations: readonly PathOperation[];
  readonly wiring: readonly Wiring[];
  readonly handlers: readonly ExceptionHandler[];
  readonly events: readonly EventHandlerUse[];
}

/** What reading one file needs besides its tree. */
export interface Context {
  readonly file: SourceFile;
  /** Qualifies a name through the file's imports. */
  readonly qualify: Qualify;
  /** The file's module-level functions, by name. */
  readonly functions: ReadonlyMap<string, Node>;
}

/** One handler registration as written, before it becomes an `ExceptionHandler`. */
export interface Registration {
  readonly app: string;
  readonly via: ExceptionHandler["via"];
  readonly node: Node;
  readonly exception: Node | null;
  /** A name, or the decorated `function_definition`. */
  readonly handler: Node | null;
}
