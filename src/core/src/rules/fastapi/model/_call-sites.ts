/**
 * @file Finds every call to a first-party module-level function in the
 * project (#391), so the wiring graph can follow
 * `app.include_router(api_router)` inside `def wire(app, api_router)` to
 * what each call passes. Only files whose text spells the function's name
 * are parsed (2 on Polar), and in those the identifiers are walked once; a
 * use that isn't a call, or an import under another name, makes the answer
 * unknown. It reads files and resolves names only through the model's ports.
 */
import type { Node, Tree } from "web-tree-sitter";
import type { SourceFile } from "../../../contracts/records.ts";
import { identifierName } from "../../../python/nodes.ts";
import type { Qualify } from "../../../python/qualify.ts";

/** A call to a first-party function, as `callsTo` found it. */
export interface CallSite {
  readonly call: Node;
  /** Qualifies a name in the calling file. */
  readonly qualify: Qualify;
}

/** The statements a name may appear in without being a use of what it names. */
const IMPORTS: ReadonlySet<string> = new Set([
  "import_statement",
  "import_from_statement",
  "future_import_statement",
]);

/** A file as the model parsed it: its normalised text, imported names and qualifier. */
interface ParsedFile {
  readonly file: SourceFile;
  /** What each imported name refers to. */
  readonly names: ReadonlyMap<string, string>;
  readonly qualify: Qualify;
}

/** What a name resolves to, as far as finding calls needs it. */
type Resolved =
  | { readonly kind: "function"; readonly file: SourceFile; readonly node: Node }
  | { readonly kind: "object" | "class" | "constant" };

/** What finding calls needs from the model. */
export interface CallPorts {
  /** Lists the project's modules. */
  readonly modules: () => Iterable<string>;
  /** Reads a module's file. */
  readonly sourceOf: (module: string) => SourceFile | undefined;
  /** Parses a file once, normalising its text. */
  readonly parse: (src: SourceFile) => ParsedFile;
  /** Gives a parsed file's tree. */
  readonly treeOf: (src: SourceFile) => Tree;
  /** Resolves a qualified name, re-exports followed. */
  readonly resolve: (qualified: string) => Resolved | null;
}

/** Finds and caches each function's calls for one model. */
export class CallSites {
  private readonly ports: CallPorts;
  /** Each function's calls, by qualified name; null when they can't all be known. */
  private readonly calls = new Map<string, readonly CallSite[] | null>();

  /**
   * Wraps the model's ports. Nothing is read yet.
   *
   * @param ports - lists, reads, parses and resolves through the model.
   */
  constructor(ports: CallPorts) {
    this.ports = ports;
  }

  /**
   * Finds every call to a first-party module-level function in the project
   * (#391), so a parameter of it can be followed one hop to what the callers
   * pass. Only files whose text spells the function's name are parsed, and a
   * name counts as a use when it resolves to the function, through re-exports
   * too; a file that imports it under another name makes the answer unknown. A use that isn't a call (`hooks = [wire]`, a method
   * reference, a decorator) means the function may be called from anywhere,
   * so the answer is unknown. Answered once per function.
   *
   * @param qualified - the function's qualified name, e.g. `app.wiring.wire`.
   * @returns the calls with their files' qualifiers, or null when the name
   *   isn't a first-party function, nothing calls it, or a use isn't a call.
   */
  callsTo(qualified: string): readonly CallSite[] | null {
    const known = this.calls.get(qualified);
    if (known !== undefined) {
      return known;
    }
    this.calls.set(qualified, null);
    const found = this.ports.resolve(qualified);
    const local = qualified.slice(qualified.lastIndexOf(".") + 1);
    const sites = found?.kind === "function" ? this.findCalls(found, local) : null;
    const answer = sites === null || sites.length === 0 ? null : sites;
    this.calls.set(qualified, answer);
    return answer;
  }

  /**
   * Scans the project's files that spell a function's name for its uses.
   *
   * @param target - the function's definition.
   * @param target.file - the file that defines it.
   * @param target.node - its `function_definition`.
   * @param local - the name it is defined under.
   * @returns the calls, or null when a use isn't a call.
   */
  private findCalls(target: { file: SourceFile; node: Node }, local: string): CallSite[] | null {
    const spelled = new RegExp(`\\b${local}\\b`, "u");
    const sites: CallSite[] = [];
    for (const module of this.ports.modules()) {
      const src = this.ports.sourceOf(module);
      const parsed = src !== undefined && spelled.test(src.text) ? this.ports.parse(src) : null;
      const found = parsed === null ? [] : this.callsIn(parsed, target, local);
      if (found === null) {
        return null;
      }
      sites.push(...found);
    }
    return sites;
  }

  /**
   * Lists one file's calls to a function.
   *
   * @param parsed - the file's parse.
   * @param target - the function's definition.
   * @param target.file - the file that defines it.
   * @param target.node - its `function_definition`.
   * @param local - the name it is defined under.
   * @returns the calls, or null when the file uses the function another way,
   *   or imports it under another name, whose calls don't spell it.
   */
  private callsIn(
    parsed: ParsedFile,
    target: { file: SourceFile; node: Node },
    local: string,
  ): CallSite[] | null {
    if (this.renamed(parsed, target, local)) {
      return null;
    }
    // One walk over identifiers, only in the few files that spell the name (2 on Polar).
    const sites: CallSite[] = [];
    for (const id of this.ports.treeOf(parsed.file).rootNode.descendantsOfType("identifier")) {
      const ref = id && identifierName(id) === local ? referenceOf(id) : null;
      const name = ref === null ? null : parsed.qualify(ref);
      if (ref === null || name === null || !this.isFunction(name, target)) {
        continue;
      }
      const { parent } = ref;
      if (parent?.type !== "call" || parent.childForFieldName("function")?.id !== ref.id) {
        return null;
      }
      sites.push({ call: parent, qualify: parsed.qualify });
    }
    return sites;
  }

  /**
   * Tells whether a file imports a function under another name, whose calls
   * don't spell the function's name.
   *
   * @param parsed - the file's parse.
   * @param target - the function's definition.
   * @param target.file - the file that defines it.
   * @param target.node - its `function_definition`.
   * @param local - the name it is defined under.
   * @returns true for `from app.wiring import wire as hook`.
   */
  private renamed(
    parsed: ParsedFile,
    target: { file: SourceFile; node: Node },
    local: string,
  ): boolean {
    return [...parsed.names].some(
      ([bound, imported]) =>
        bound !== local && imported.endsWith(`.${local}`) && this.isFunction(imported, target),
    );
  }

  /**
   * Tells whether a qualified name resolves to one function definition.
   *
   * @param name - a qualified name.
   * @param target - the function's definition.
   * @param target.file - the file that defines it.
   * @param target.node - its `function_definition`.
   * @returns true when it is that function.
   */
  private isFunction(name: string, target: { file: SourceFile; node: Node }): boolean {
    const found = this.ports.resolve(name);
    return (
      found?.kind === "function" &&
      found.file.path === target.file.path &&
      found.node.startIndex === target.node.startIndex
    );
  }

  /** Forgets every answer, when the model drops its files. */
  clear(): void {
    this.calls.clear();
  }
}

/**
 * Reads an identifier as a reference to what it names: itself, or the
 * `module.name` attribute it ends. A name that is being defined (a `def` or
 * `class` name, a keyword argument's name), the object of an attribute, or
 * part of an import statement isn't a reference.
 *
 * @param id - an identifier node.
 * @returns the node to qualify, or null when it isn't a reference.
 */
function referenceOf(id: Node): Node | null {
  const { parent } = id;
  const attribute = parent?.type === "attribute";
  const ref = attribute && parent.childForFieldName("attribute")?.id === id.id ? parent : id;
  const holder = ref.parent;
  const defined =
    holder?.childForFieldName("name")?.id === id.id || (attribute && ref.id === id.id);
  let statement: Node | null = ref;
  while (statement !== null && !IMPORTS.has(statement.type) && statement.type !== "module") {
    statement = statement.parent;
  }
  return defined || (statement !== null && IMPORTS.has(statement.type)) ? null : ref;
}
