/**
 * @file Works out which calls in a file are module loaders, whatever they are called
 * locally. `il.import_module`, `im` and `getattr(importlib, "import_module")`
 * can all be `importlib.import_module`.
 *
 * Names are resolved through imports (`import importlib as il`,
 * `from importlib import import_module as im`, `from builtins import *`),
 * assignments (`load = importlib.import_module`, `im, _ = loader, None`,
 * `a = b = loader`, a walrus), attributes assigned a loader
 * (`self.load = loader`, or `load = loader` in a class body), `getattr(m, "name")`,
 * `m["name"]`, `m.__dict__["name"]`, `vars(m)["name"]`,
 * `functools.partial(loader)`, `__import__("importlib")`, `sys.modules["importlib"]`,
 * `globals()["name"]` or `f.__globals__["name"]`, and a builtin function's
 * `__self__` (the `builtins` module). Names bound inside a literal `exec`
 * source are added by `calls.ts`, which parses it.
 *
 * Function and class scopes are ignored: a name bound anywhere in the file
 * counts everywhere, an attribute name assigned a loader counts on any object,
 * and `exec`, `eval`, `compile` and `__import__` always count as the builtins,
 * even where a module rebinds them. All three can only add findings:
 * `from re import compile` followed by `compile("from shop.infrastructure import x")`
 * is a known false positive.
 */
import type { Node } from "web-tree-sitter";
import { argumentAt, literalString } from "../../python/literals.ts";
import { identifierName, namedChildren } from "../../python/nodes.ts";
import { ATTRIBUTE, assignedNames, walrusName } from "./assignments.ts";
import { importBindings } from "./import-bindings.ts";
import { LOADERS, PARTIAL } from "./loaders.ts";

/** What `globals()` and `f.__globals__` return: the calling module's namespace. */
const GLOBALS = "builtins.globals()";

/**
 * Modules tracked because they lead to a loader (`sys.modules`, `functools.partial`)
 * without holding one themselves.
 */
const NEUTRAL_MODULES: ReadonlySet<string> = new Set(["sys", "functools"]);

/**
 * Tells whether a qualified name is, or may hold, a loader, as opposed to a
 * value under `sys` or `functools`. `computed-source.ts` asks it when deciding
 * whether a value mentions a loader.
 *
 * @param qualified - a name `qualify` returned.
 * @returns false for `sys`, `functools` and anything under them.
 */
export function holdsLoader(qualified: string): boolean {
  return !NEUTRAL_MODULES.has(qualified.split(".")[0] ?? "");
}

/**
 * The only values worth tracking: the loaders, `getattr`, the modules that
 * hold them, and the ways to them through `sys` and `functools`. A closed set
 * keeps `a = a.x` from growing names without end.
 */
const TRACKED: ReadonlySet<string> = new Set([
  ...LOADERS.keys(),
  ...NEUTRAL_MODULES,
  "sys.modules",
  PARTIAL,
  "builtins.getattr",
  "builtins.vars",
  "builtins.globals",
  GLOBALS,
  "builtins",
  "importlib",
  "importlib.util",
  "importlib.machinery",
  "pkgutil",
  "runpy",
]);

/**
 * The builtin functions, whose `__self__` is the `builtins` module:
 * `print.__self__.exec` is `exec`.
 */
const BUILTIN_FUNCTIONS: ReadonlySet<string> = new Set(
  (
    "abs aiter all anext any ascii bin breakpoint callable chr compile delattr dir divmod " +
    "eval exec format getattr globals hasattr hash hex id input isinstance issubclass iter " +
    "len locals max min next oct open ord pow print repr round setattr sorted sum vars __import__"
  ).split(" "),
);

/** Local name to every qualified name it may be bound to. */
export type Bindings = Map<string, Set<string>>;

/**
 * Returns the names every module starts with: the builtins, and the loader
 * modules under their own names.
 *
 * @returns a fresh bindings map.
 */
export function builtinBindings(): Bindings {
  const names: [string, string][] = [
    ["exec", "builtins.exec"],
    ["eval", "builtins.eval"],
    ["compile", "builtins.compile"],
    ["__import__", "builtins.__import__"],
    ["getattr", "builtins.getattr"],
    ["vars", "builtins.vars"],
    ["globals", "builtins.globals"],
    ["__builtins__", "builtins"],
    ["builtins", "builtins"],
    ["importlib", "importlib"],
    ["runpy", "runpy"],
    ["pkgutil", "pkgutil"],
  ];
  return new Map(names.map(([name, qualified]) => [name, new Set([qualified])]));
}

/** Node types `collectBindings` reads; `syntaxOf` collects them in one walk. */
const BINDING_NODES = [
  "import_statement",
  "import_from_statement",
  "assignment",
  "named_expression",
  "call",
];

/**
 * Collects, in one walk of the tree, the nodes the loader search needs:
 * imports and assignments for the bindings, and calls to inspect.
 * One walk instead of four matters: each walk crosses into WASM for every node.
 *
 * @param root - the module node.
 * @returns the matching nodes in source order.
 */
export function syntaxOf(root: Node): Node[] {
  return root.descendantsOfType(BINDING_NODES).flatMap((n) => (n ? [n] : []));
}

/**
 * Collects what each local name may refer to among the loader modules.
 * Reads import statements anywhere in the tree, then assignments and walruses
 * until nothing new is learned (at most one pass per assignment, however the
 * file is written). Only the values in `TRACKED` are kept.
 *
 * @param syntax - the module's nodes, as `syntaxOf` returns them.
 * @param outer - bindings already in effect.
 * @returns a new bindings map; `outer` is not changed.
 */
export function collectBindings(syntax: readonly Node[], outer: Bindings): Bindings {
  const bindings: Bindings = new Map([...outer].map(([name, qs]) => [name, new Set(qs)]));
  const assignments: { name: string; right: Node }[] = [];
  for (const node of syntax) {
    if (node.type === "import_statement" || node.type === "import_from_statement") {
      bindImport(node, bindings);
    } else if (node.type === "assignment") {
      assignments.push(...assignedNames(node));
    } else if (node.type === "named_expression") {
      assignments.push(...walrusName(node));
    }
  }
  for (let pass = 0; pass <= assignments.length; pass += 1) {
    const learned = assignments.map(({ name, right }) =>
      qualify(right, bindings)
        .map((q) => bind(bindings, name, q))
        .includes(true),
    );
    if (!learned.includes(true)) {
      break;
    }
  }
  return bindings;
}

/**
 * Records the names an import statement binds to loaders or loader modules.
 *
 * @param stmt - an `import_statement` or `import_from_statement` node.
 * @param bindings - the map to add to.
 */
function bindImport(stmt: Node, bindings: Bindings): void {
  for (const { local, qualified } of importBindings(stmt)) {
    if (qualified !== null) {
      bind(bindings, local, qualified);
    }
  }
}

/**
 * Adds one possible meaning to a local name, if it is under a loader module.
 *
 * @param bindings - the map to add to.
 * @param name - the local name.
 * @param qualified - what it may refer to, e.g. `importlib.import_module`.
 * @returns true when the map changed.
 */
function bind(bindings: Bindings, name: string, qualified: string): boolean {
  if (!TRACKED.has(qualified)) {
    return false;
  }
  const known = bindings.get(name);
  if (!known) {
    bindings.set(name, new Set([qualified]));
    return true;
  }
  if (known.has(qualified)) {
    return false;
  }
  known.add(qualified);
  return true;
}

/**
 * Lists the qualified names an expression may evaluate to.
 * Understands names, walruses, attributes, `m["name"]`, `m.__dict__["name"]`,
 * `vars(m)["name"]`, `getattr(m, "name")`, `sys.modules["m"]`,
 * `globals()["name"]`, `functools.partial(loader)`, and
 * `importlib.import_module("m")` or `__import__("m")` with literal names.
 *
 * @param node - an expression node.
 * @param bindings - what local names refer to.
 * @returns every qualified name the expression may be, empty when unknown.
 */
export function qualify(node: Node, bindings: Bindings): string[] {
  switch (node.type) {
    case "parenthesized_expression": {
      const [inner] = namedChildren(node);
      return inner ? qualify(inner, bindings) : [];
    }
    case "identifier":
      return [...(bindings.get(identifierName(node)) ?? [])];
    case "named_expression": {
      const value = node.childForFieldName("value");
      return value ? qualify(value, bindings) : [];
    }
    case "attribute": {
      const object = node.childForFieldName("object");
      const attribute = node.childForFieldName("attribute");
      return object && attribute ? attributeOf(object, identifierName(attribute), bindings) : [];
    }
    case "subscript": {
      const value = node.childForFieldName("value");
      const key = literalString(node.childForFieldName("subscript"));
      return value && key !== null
        ? qualify(value, bindings).flatMap((owner) => item(owner, key, bindings))
        : [];
    }
    case "call":
      return qualifyCall(node, bindings);
    default:
      return [];
  }
}

/**
 * Lists what a call expression may return, when it returns a module or a loader.
 *
 * @param call - a `call` node.
 * @param bindings - what local names refer to.
 * @returns the qualified names, empty when the call returns something else.
 */
function qualifyCall(call: Node, bindings: Bindings): string[] {
  const fn = call.childForFieldName("function");
  return fn
    ? qualify(fn, bindings).flatMap((qualified) => returnedBy(qualified, call, bindings))
    : [];
}

/**
 * Lists what one known callee returns for a call, when that is a module or a loader.
 *
 * @param qualified - the callee's qualified name.
 * @param call - the `call` node.
 * @param bindings - what local names refer to.
 * @returns the qualified names returned, empty for any other callee.
 */
function returnedBy(qualified: string, call: Node, bindings: Bindings): string[] {
  const object = argumentAt(call, 0, "");
  switch (qualified) {
    case "builtins.getattr": {
      const attribute = literalString(argumentAt(call, 1, ""));
      return object && attribute !== null ? attributeOf(object, attribute, bindings) : [];
    }
    case "builtins.vars":
      return object ? qualify(object, bindings) : []; // `vars(m)[k]` is `m.k`
    case "builtins.globals":
      return [GLOBALS];
    case PARTIAL: {
      // `partial(loader)` is the loader; with arguments bound it is read as a call (`calls.ts`)
      const list = call.childForFieldName("arguments");
      const bare = list ? namedChildren(list).length === 1 : false;
      return object && bare ? qualify(object, bindings) : [];
    }
    default:
      return moduleReturnedBy(qualified, call);
  }
}

/**
 * Lists the module an `import_module` or `__import__` call returns, for a literal name.
 *
 * @param qualified - the callee's qualified name.
 * @param call - the `call` node.
 * @returns the qualified names returned, empty for any other callee or name.
 */
function moduleReturnedBy(qualified: string, call: Node): string[] {
  const kind = LOADERS.get(qualified);
  const name = literalString(argumentAt(call, 0, "name"));
  if (name === null) {
    return [];
  }
  if (kind === "import_module") {
    return [name];
  }
  // `__import__` returns the leaf with a fromlist, else the top package.
  return kind === "__import__" ? [name, name.split(".")[0] ?? name] : [];
}

/**
 * Lists what `object.name` may be. `m.__dict__` stands for `m` (the subscript
 * appends the key), `__globals__` is the module's namespace, a builtin
 * function's `__self__` is `builtins`, and an attribute name assigned a loader
 * anywhere in the file counts on any object.
 *
 * @param object - the expression before the dot.
 * @param name - the attribute, as written after the dot.
 * @param bindings - what local names refer to.
 * @returns every qualified name the attribute may be.
 */
function attributeOf(object: Node, name: string, bindings: Bindings): string[] {
  const owners = qualify(object, bindings);
  switch (name) {
    case "__dict__":
      return owners;
    case "__globals__":
      return [GLOBALS];
    case "__self__": {
      const builtin =
        (object.type === "identifier" && BUILTIN_FUNCTIONS.has(identifierName(object))) ||
        owners.some((owner) => owner.startsWith("builtins."));
      return builtin ? ["builtins"] : [];
    }
    default:
      return [
        ...owners.map((owner) => `${owner}.${name}`),
        ...(bindings.get(ATTRIBUTE + name) ?? []),
      ];
  }
}

/**
 * Lists what `owner[key]` may be: a module out of `sys.modules`, a name out
 * of the module's namespace, or else `owner.key` (a module's `__dict__` or `vars`).
 *
 * @param owner - a qualified name the subscripted value may be.
 * @param key - the literal key.
 * @param bindings - what local names refer to.
 * @returns the qualified names the item may be.
 */
function item(owner: string, key: string, bindings: Bindings): string[] {
  if (owner === "sys.modules") {
    return [key];
  }
  return owner === GLOBALS ? [...(bindings.get(key) ?? [])] : [`${owner}.${key}`];
}
