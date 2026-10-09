/**
 * @file The error status codes a path operation can produce, for FAPI002, in
 * the rings #183 defines: an `HTTPException` raised or a response returned
 * with a literal code in the endpoint (ring 0); the same in functions and
 * dependencies it calls by name, in its file (ring 1) or imported from another
 * first-party module (ring 2), up to `max-depth` calls; and a raised
 * first-party exception an app handler maps to a literal code, or an
 * `HTTPException` subclass that fixes its code (ring 3).
 *
 * Each code keeps where it comes from, so the finding can name it. A code
 * Inwards can't read is dropped, never guessed. An `except X` around a call
 * or raise drops the codes of first-party exceptions that are `X` or inherit
 * from it; anything else caught isn't subtracted. Methods on injected objects
 * (ring 4) aren't followed.
 */
import type { Node } from "web-tree-sitter";
import { argumentAt } from "../../python/literals.ts";
import { identifierName, namedChildren } from "../../python/nodes.ts";
import { DEPENDS } from "./extract.ts";
import { ownNodes } from "./function-body.ts";
import type { FastApiProject, Lineage } from "./project.ts";
import { statusCode } from "./status.ts";
import { type Qualify, type Value, valueFrom } from "./values.ts";

/** One way an operation produces a status code. */
export interface CodeSource {
  readonly code: number;
  /** Where it comes from, for the message, e.g. "from `load_or_404` at app/orders.py:12". */
  readonly origin: string;
  /** True when it comes from a custom exception an app handler maps (ring 3). */
  readonly handled: boolean;
  /** True for an `HTTPException` raised in the endpoint's own body (ring 0, Ruff FAST004's ground). */
  readonly direct: boolean;
  /** The canonical names of the first-party exception classes raised, for `except` clauses. */
  readonly exceptions: readonly string[];
}

/** A function to read, and where it sits. */
export interface Frame {
  readonly node: Node;
  /** Its name, for the message. */
  readonly name: string;
  readonly path: string;
  readonly qualify: Qualify;
}

/** The names `HTTPException` is imported under. */
const HTTP_EXCEPTIONS: ReadonlySet<string> = new Set([
  "fastapi.HTTPException",
  "fastapi.exceptions.HTTPException",
  "starlette.exceptions.HTTPException",
]);

/** A response class: anything FastAPI or Starlette exports whose name ends in `Response`. */
const RESPONSE_CLASS = /^(?:fastapi|starlette)(?:\.responses)?\.\w*Response$/u;

/** The node types the walk reads. */
const READ: ReadonlySet<string> = new Set(["raise_statement", "return_statement", "call"]);

/** Reads the codes of functions, following calls and dependencies. */
export class CodeWalk {
  private readonly scope: FastApiProject;
  private readonly maxDepth: number;
  /** The functions on the current call path, by node id, which ends recursion. */
  private readonly active = new Set<number>();

  /**
   * Keeps the lookups and the depth limit.
   *
   * @param scope - the project lookups.
   * @param maxDepth - how many calls deep to follow (`max-depth`).
   */
  constructor(scope: FastApiProject, maxDepth: number) {
    this.scope = scope;
    this.maxDepth = maxDepth;
  }

  /**
   * Lists the codes a function can produce: its own raises and returns,
   * then the functions and dependencies it calls, while the depth allows.
   *
   * @param frame - the function.
   * @param depth - how many calls away from the endpoint it is; 0 for the endpoint.
   * @returns the codes with their origins.
   */
  codesOf(frame: Frame, depth: number): CodeSource[] {
    if (this.active.has(frame.node.id)) {
      return [];
    }
    this.active.add(frame.node.id);
    try {
      const found: CodeSource[] = [];
      for (const node of ownNodes(frame.node, READ)) {
        const sources =
          node.type === "call"
            ? this.called(node, frame, depth)
            : this.statement(node, frame, depth);
        const caught = sources.length > 0 ? this.caughtAround(node, frame) : new Set<string>();
        found.push(...sources.filter((s) => !s.exceptions.some((e) => caught.has(e))));
      }
      found.push(...this.parameterDependencies(frame, depth));
      return found;
    } finally {
      this.active.delete(frame.node.id);
    }
  }

  /**
   * Lists the codes of the dependencies a function's parameters declare:
   * `x=Depends(fn)` and `x: Annotated[T, Depends(fn)]`.
   *
   * @param frame - the function.
   * @param depth - its depth.
   * @returns the dependencies' codes.
   */
  private parameterDependencies(frame: Frame, depth: number): CodeSource[] {
    const parameters = frame.node.childForFieldName("parameters");
    return (parameters ? parameters.descendantsOfType("call") : []).flatMap((call) =>
      call ? this.dependency(valueFrom(call, frame.qualify), depth) : [],
    );
  }

  /**
   * Lists the codes of one `Depends(fn)` or `Security(fn)`, one call deeper.
   *
   * @param value - the call as the model reads it.
   * @param depth - the depth of the function that declares it.
   * @returns the dependency's codes, none when it isn't a first-party function.
   */
  dependency(value: Value, depth: number): CodeSource[] {
    const [target] = value.kind === "call" && DEPENDS.has(value.callee ?? "") ? value.args : [];
    return target?.kind === "name" ? this.follow(target.name, depth) : [];
  }

  /**
   * Reads a `raise` or `return` statement.
   *
   * @param node - the `raise_statement` or `return_statement` node.
   * @param frame - the function it is in.
   * @param depth - the function's depth.
   * @returns the codes it produces.
   */
  private statement(node: Node, frame: Frame, depth: number): CodeSource[] {
    const [expr] = namedChildren(node);
    const call = expr?.type === "call" ? expr : null;
    const callee = call ? call.childForFieldName("function") : expr;
    const name = callee ? frame.qualify(callee) : null;
    const at = `${frame.path}:${node.startPosition.row + 1}`;
    if (name === null) {
      return [];
    }
    if (node.type === "return_statement") {
      return call && RESPONSE_CLASS.test(name) ? this.literal(call, -1, { frame, depth, at }) : [];
    }
    if (HTTP_EXCEPTIONS.has(name)) {
      return call ? this.literal(call, 0, { frame, depth, at }) : [];
    }
    const lineage = this.scope.lineage(name);
    return lineage ? this.raised(lineage, call, { frame, at }) : [];
  }

  /**
   * Reads the code of an `HTTPException(...)` raised, or a response returned.
   *
   * @param call - the constructor call.
   * @param index - the code's position for an exception, -1 for a response (keyword only).
   * @param where - where it is.
   * @param where.frame - the function it is in.
   * @param where.depth - that function's depth.
   * @param where.at - `path:line` of the statement.
   * @returns the code, none when it can't be read.
   */
  private literal(
    call: Node,
    index: number,
    { frame, depth, at }: { frame: Frame; depth: number; at: string },
  ): CodeSource[] {
    const code = this.codeArg(call, index, frame);
    const raise = index >= 0;
    let origin = `from \`${frame.name}\` at ${at}`;
    if (depth === 0) {
      origin = `${raise ? "raised" : "returned"} at ${at}`;
    }
    const direct = raise && depth === 0;
    return code === null ? [] : [{ code, origin, handled: false, direct, exceptions: [] }];
  }

  /**
   * Reads a raised first-party exception: an `HTTPException` subclass, or a
   * class an app handler maps to a code (looked up by inheritance, as
   * Starlette does).
   *
   * @param lineage - the raised class and its bases.
   * @param call - the constructor call, when the class is called.
   * @param where - where it is raised.
   * @param where.frame - the function that raises it.
   * @param where.at - `path:line` of the `raise`.
   * @returns the codes, none when the code can't be read or nothing handles it.
   */
  private raised(
    lineage: Lineage,
    call: Node | null,
    { frame, at }: { frame: Frame; at: string },
  ): CodeSource[] {
    const [raised] = lineage.classes;
    const exceptions = lineage.classes.map((c) => c.name);
    const short = raised?.name.split(".").at(-1) ?? "";
    if ([...lineage.external].some((base) => HTTP_EXCEPTIONS.has(base))) {
      const fixed = this.fixedCode(lineage);
      let code = fixed === "inherited" ? null : fixed;
      if (fixed === "inherited" && call) {
        code = this.codeArg(call, 0, frame);
      }
      const origin = `from \`${short}\` raised at ${at}`;
      return code === null ? [] : [{ code, origin, handled: false, direct: false, exceptions }];
    }
    // A third-party base can have a handler Inwards can't see, and a dynamic registration any.
    const foreign = [...lineage.external].some((base) => !this.scope.firstParty(base));
    if (foreign || !this.scope.handlersKnown()) {
      return [];
    }
    for (const cls of lineage.classes) {
      const handler = this.scope.handlerFor(cls.name);
      if (handler !== undefined) {
        const origin = `from \`${short}\` raised at ${at}, handled in ${handler.where}`;
        return (handler.codes ?? []).map((code) => ({
          code,
          origin,
          handled: true,
          direct: false,
          exceptions,
        }));
      }
    }
    return [];
  }

  /**
   * Reads the code an `HTTPException` subclass passes up in its `__init__`
   * (`super().__init__(status_code=404, ...)`), nearest class first.
   *
   * @param lineage - the subclass and its first-party bases.
   * @returns the code, null when an `__init__` passes one Inwards can't read,
   *   or `inherited` when no first-party class defines `__init__`.
   */
  private fixedCode(lineage: Lineage): number | null | "inherited" {
    for (const cls of lineage.classes) {
      const body = cls.node.childForFieldName("body");
      const init = (body ? namedChildren(body) : []).find(
        (n) =>
          n.type === "function_definition" &&
          identifierName(n.childForFieldName("name") ?? n) === "__init__",
      );
      if (init === undefined) {
        continue;
      }
      const up = init.descendantsOfType("call").find((c) => {
        const fn = c?.childForFieldName("function");
        const attr = fn?.type === "attribute" ? fn.childForFieldName("attribute") : null;
        return attr ? identifierName(attr) === "__init__" : false;
      });
      const receiver = up?.childForFieldName("function")?.childForFieldName("object");
      const index = receiver?.type === "call" ? 0 : 1; // super().__init__(code) or Base.__init__(self, code)
      const frame = { node: init, name: "", path: cls.path, qualify: cls.qualify };
      return up ? this.codeArg(up, index, frame) : null;
    }
    return "inherited";
  }

  /**
   * Reads a call to a first-party function, one call deeper.
   *
   * @param call - the `call` node.
   * @param frame - the function it is in.
   * @param depth - that function's depth.
   * @returns the callee's codes, none past `max-depth` or for anything but a first-party function.
   */
  private called(call: Node, frame: Frame, depth: number): CodeSource[] {
    const callee = call.childForFieldName("function");
    const name = callee ? frame.qualify(callee) : null;
    return name === null ? [] : this.follow(name, depth, true);
  }

  /**
   * Follows a name to a first-party function and reads it, if the depth allows.
   *
   * A generator function called by name isn't run by the call (its body runs
   * later, as in a `StreamingResponse`), so it is read only as a dependency.
   *
   * @param name - a qualified name.
   * @param depth - the depth of the caller.
   * @param called - true for a plain call, false for a dependency.
   * @returns the function's codes.
   */
  private follow(name: string, depth: number, called = false): CodeSource[] {
    if (depth >= this.maxDepth) {
      return [];
    }
    const found = this.scope.resolve(name);
    const nameNode = found?.kind === "function" ? found.node.childForFieldName("name") : null;
    if (found?.kind !== "function" || !nameNode) {
      return [];
    }
    if (called && found.node.descendantsOfType("yield").length > 0) {
      return [];
    }
    const frame = {
      node: found.node,
      name: identifierName(nameNode),
      path: found.file.path,
      qualify: found.qualify,
    };
    return this.codesOf(frame, depth + 1);
  }

  /**
   * Reads a status code argument: `status_code=`, or the positional one.
   *
   * @param call - the exception or response constructor call.
   * @param index - the position of the code, or -1 for keyword only.
   * @param frame - the function the call is in, for its names.
   * @returns the code, or null when it isn't given or can't be read.
   */
  private codeArg(call: Node, index: number, frame: Frame): number | null {
    const arg =
      index < 0 ? keywordArg(call, "status_code") : argumentAt(call, index, "status_code");
    return arg ? statusCode(valueFrom(arg, frame.qualify), (n) => this.scope.constant(n)) : null;
  }

  /**
   * Lists the first-party exception classes caught around a node: the
   * `except` clauses of each `try` whose body holds it, up to the function.
   *
   * @param node - a call or statement.
   * @param frame - the function it is in.
   * @returns the canonical names of the classes caught.
   */
  private caughtAround(node: Node, frame: Frame): Set<string> {
    const caught = new Set<string>();
    for (let at: Node | null = node; at && at.id !== frame.node.id; at = at.parent) {
      const { parent } = at;
      if (parent?.type !== "try_statement" || parent.childForFieldName("body")?.id !== at.id) {
        continue;
      }
      for (const clause of namedChildren(parent).filter((c) => c.type === "except_clause")) {
        for (const name of exceptNames(clause)) {
          const cls = this.scope.lineage(frame.qualify(name) ?? "")?.classes[0];
          if (cls) {
            caught.add(cls.name);
          }
        }
      }
    }
    return caught;
  }
}

/**
 * Lists the names an `except` clause catches: `except X`, `except (X, Y)`,
 * with or without `as e`.
 *
 * @param clause - an `except_clause` node.
 * @returns the name and attribute nodes.
 */
function exceptNames(clause: Node): Node[] {
  let value = clause.childForFieldName("value") ?? namedChildren(clause)[0] ?? null;
  if (value?.type === "as_pattern") {
    value = namedChildren(value)[0] ?? null;
  }
  if (!value) {
    return [];
  }
  const names = value.type === "tuple" ? namedChildren(value) : [value];
  return names.filter((n) => n.type === "identifier" || n.type === "attribute");
}

/**
 * Finds a keyword argument's value.
 *
 * @param call - a `call` node.
 * @param keyword - the parameter name, such as `status_code`.
 * @returns the value node, or null when the call doesn't pass it by name.
 */
function keywordArg(call: Node, keyword: string): Node | null {
  return argumentAt(call, Number.MAX_SAFE_INTEGER, keyword);
}
