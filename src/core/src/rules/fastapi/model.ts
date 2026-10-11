/**
 * @file The FastAPI model every FAPI rule reads (#186): per file, the apps and
 * routers, their path operations, the `include_router` and `mount` edges and
 * the exception handlers (`extract.ts`), with names resolved across files
 * through `ProjectIndex`, which reads each file lazily. The application is
 * never imported or run.
 *
 * A file is read once per text, and only when it mentions FastAPI at all
 * (`mentionsFastApi`) or a name leads to it. Its tree comes from the run's
 * shared trees (`FileTrees`), which parse each text once for every content
 * rule and keep it until the run ends, because the records hand out syntax
 * nodes (a path operation's function, a keyword's value) for the rules to
 * walk. The model reports nothing; deciding what is wrong is the rules' job.
 */
import type { Node } from "web-tree-sitter";
import type { SourceFile } from "../../contracts/records.ts";
import type { ProjectIndex } from "../../lookup/project-index.ts";
import { identifierName, moduleFunctions } from "../../python/nodes.ts";
import { importedNames, normalizeSource } from "../../python/parser.ts";
import { type Qualify, qualifierFor } from "../../python/qualify.ts";
import { type ModuleDefinitions, moduleDefinitions } from "../shared/definitions.ts";
import { type FoundDefinition, RouterKinds } from "../shared/fastapi-routers.ts";
import type { FileTrees } from "../shared/module-trees.ts";
import { extract } from "./extract.ts";
import type { FastApiFile, FastApiObject } from "./records.ts";

/** The text pre-filter: a file that spells none of these holds no FastAPI object or wiring. */
const MENTIONS =
  /fastapi|FastAPI|APIRouter|include_router|exception_handler|on_event|add_event_handler/u;

/** How many re-exports `resolve` follows before it gives up (a re-export cycle ends here). */
const MAX_HOPS = 8;

/**
 * What a qualified name resolves to: an app or router, or a module-level
 * function, class or constant (`NAME = value`, whose `node` is the value).
 * `qualify` qualifies names in the definition's own file.
 */
export type Definition =
  | { readonly kind: "object"; readonly file: FastApiFile; readonly object: FastApiObject }
  | {
      readonly kind: "function" | "class" | "constant";
      readonly file: SourceFile;
      readonly node: Node;
      readonly qualify: Qualify;
    };

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

/** One parsed file, kept until `dispose()`; the run's trees own its tree. */
interface Parsed {
  /** The file, with the normalised text that was parsed. */
  readonly file: SourceFile;
  /** What each imported name refers to. */
  readonly names: ReadonlyMap<string, string>;
  /** Module-level functions by name. */
  readonly functions: ReadonlyMap<string, Node>;
  /** Module-level classes and constants by name. */
  readonly definitions: ModuleDefinitions;
  readonly qualify: Qualify;
}

/**
 * Tells whether a file may hold FastAPI objects or wiring, before any parse.
 *
 * @param text - the file's text.
 * @returns true when it mentions `fastapi`, `FastAPI`, `APIRouter`, `include_router`, `exception_handler`, `on_event` or `add_event_handler`.
 */
export function mentionsFastApi(text: string): boolean {
  return MENTIONS.test(text);
}

/**
 * The project's FastAPI model, built file by file on demand and cached per
 * file. Build one per check with the run's trees and the check's
 * `ProjectIndex`, and call `dispose()` when done. The records hold syntax
 * nodes, so they stay valid only until the run's trees are freed.
 */
export class FastApiModel {
  private readonly trees: FileTrees;
  private readonly project: ProjectIndex;
  private readonly parsed = new Map<string, Parsed>();
  /** Each parsed file's records, by path: null when its text doesn't pass the pre-filter. */
  private readonly models = new Map<string, FastApiFile | null>();
  /** What first-party callees build, so a router class built at run time counts (#358). */
  private readonly kinds = new RouterKinds((qualified) => this.definitionOf(qualified));
  /** Paths whose text came from `fileModel`, the adapter's view, which a disk read must not replace. */
  private readonly pinned = new Set<string>();
  /** Each function's calls `callsTo` found, by qualified name; null when they can't all be known. */
  private readonly calls = new Map<string, readonly CallSite[] | null>();

  /**
   * Wraps the run's trees and a project index. Nothing is read or parsed yet.
   *
   * @param trees - the run's trees, which parse each text once and free it at the run's end.
   * @param project - the project's module index, which reads files on demand.
   */
  constructor(trees: FileTrees, project: ProjectIndex) {
    this.trees = trees;
    this.project = project;
  }

  /**
   * Reads one file's FastAPI records. A file that fails the pre-filter isn't
   * parsed. A new text for the same path replaces the cached parse and frees
   * the old one, whose nodes are then invalid. That text then wins over the
   * one the project index reads for the same path, so an unsaved editor
   * buffer isn't swapped for the file on disk while a rule walks it.
   *
   * @param file - the source file, as the adapter read it.
   * @returns the file's records, or null when its text doesn't mention FastAPI.
   */
  fileModel(file: SourceFile): FastApiFile | null {
    const text = normalizeSource(file.text);
    if (!MENTIONS.test(text)) {
      return null;
    }
    const model = this.recordsOf(this.parse({ ...file, text }, true), file.path);
    this.pinned.add(file.path);
    return model;
  }

  /**
   * Reads a first-party module's records through the project index. A text
   * `fileModel` was given for the same path wins over the one on disk.
   *
   * @param module - a dotted module name.
   * @returns its records, or null when no file holds it or it doesn't mention FastAPI.
   */
  moduleModel(module: string): FastApiFile | null {
    const src = this.project.sourceOf(module);
    const text = src === undefined ? "" : normalizeSource(src.text);
    return src !== undefined && MENTIONS.test(text)
      ? this.recordsOf(this.parse({ ...src, text }), src.path)
      : null;
  }

  /**
   * Gives the name qualifier of a file the model has read.
   *
   * @param file - records the model returned.
   * @returns what qualifies a name node in that file, or null when it isn't parsed.
   */
  qualifierOf(file: FastApiFile): Qualify | null {
    return this.parsed.get(file.path)?.qualify ?? null;
  }

  /**
   * Finds what a qualified name (a record's `receiver`, `target` or
   * `handler`) refers to. Its module comes from `ProjectIndex.ownerOf`, and a
   * name that module imports from elsewhere (a re-export in `__init__.py`) is
   * followed to its own module, up to `MAX_HOPS` times. A file the model
   * already holds is read as it holds it, never re-read from the index, so
   * the nodes `fileModel` handed out stay valid.
   *
   * @param qualified - a qualified name, e.g. `app.routers.users.router`.
   * @returns the app, router or module-level function, or null for a name
   *   that isn't first-party or isn't bound to one of those.
   */
  resolve(qualified: string): Definition | null {
    return this.follow(qualified, (parsed, src, local) => {
      const records = this.recordsOf(parsed, src.path);
      const object = records?.objects.find((o) => o.local === local);
      return records && object
        ? { kind: "object", file: records, object }
        : definitionIn(parsed, src, local);
    });
  }

  /**
   * Finds a first-party module-level function, class or constant without
   * reading any file's FastAPI records, so recognising a router while a
   * file's records are read never reads them again (#358).
   *
   * @param qualified - a qualified name, e.g. `app.routing.APIRouter`.
   * @returns the definition, or null when no first-party module defines it.
   */
  private definitionOf(qualified: string): FoundDefinition | null {
    return this.follow(qualified, (parsed, src, local) => {
      const found = definitionIn(parsed, src, local);
      return found === null ? null : { ...found, name: local };
    });
  }

  /**
   * Walks a qualified name to the module that defines it: its module comes
   * from `ProjectIndex.ownerOf`, and a name that module imports from
   * elsewhere (a re-export in `__init__.py`) is followed to its own module,
   * up to `MAX_HOPS` times. A file the model already holds is read as it
   * holds it, never re-read from the index, so the nodes handed out stay valid.
   *
   * @param qualified - a qualified name.
   * @param pick - finds the definition by its local name in a parsed module.
   * @returns what `pick` found, or null.
   */
  private follow<T>(
    qualified: string,
    pick: (parsed: Parsed, src: SourceFile, local: string) => T | null,
  ): T | null {
    let name = qualified;
    for (let hop = 0; hop < MAX_HOPS; hop += 1) {
      const owner = this.project.ownerOf(name);
      const src = owner === undefined ? undefined : this.project.sourceOf(owner);
      const [head = "", ...rest] =
        src === undefined ? [] : name.slice(src.module.length + 1).split(".");
      if (src === undefined || head === "") {
        return null;
      }
      // A file the check already handed in keeps its text (e.g. as it was at session start).
      const parsed =
        this.parsed.get(src.path) ?? this.parse({ ...src, text: normalizeSource(src.text) });
      const found = rest.length === 0 ? pick(parsed, src, head) : null;
      const next = parsed.names.get(head);
      if (found !== null || next === undefined) {
        return found;
      }
      name = [next, ...rest].join(".");
    }
    return null;
  }

  /**
   * Reads a parsed file's FastAPI records once. They are read after the
   * parse is cached, so a router lookup that leads back into the same file
   * finds its tree instead of parsing it again.
   *
   * @param parsed - the file's parse.
   * @param path - its path.
   * @returns the records, or null when its text doesn't pass the pre-filter.
   */
  private recordsOf(parsed: Parsed, path: string): FastApiFile | null {
    const known = this.models.get(path);
    if (known !== undefined) {
      return known;
    }
    const { qualify, functions, file } = parsed;
    const model = MENTIONS.test(file.text)
      ? extract(this.trees.treeOf(file).rootNode, { file, qualify, functions, kinds: this.kinds })
      : null;
    this.models.set(path, model);
    return model;
  }

  /**
   * Finds every call to a first-party module-level function in the project
   * (#391), so a parameter of it can be followed one hop to what the callers
   * pass. Only files whose text spells the function's name are parsed, and a
   * name counts as a use when it resolves to the function, re-exports and
   * aliases included. A use that isn't a call (`hooks = [wire]`, a method
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
    const found = this.resolve(qualified);
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
    for (const module of this.project.modules) {
      const src = this.project.sourceOf(module);
      const text = src === undefined ? "" : normalizeSource(src.text);
      const parsed = src !== undefined && spelled.test(text) ? this.parse({ ...src, text }) : null;
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
   * @returns the calls, or null when the file uses the function another way.
   */
  private callsIn(
    parsed: Parsed,
    target: { file: SourceFile; node: Node },
    local: string,
  ): CallSite[] | null {
    const sites: CallSite[] = [];
    for (const id of this.trees.treeOf(parsed.file).rootNode.descendantsOfType("identifier")) {
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
   * Tells whether a qualified name resolves to one function definition.
   *
   * @param name - a qualified name.
   * @param target - the function's definition.
   * @param target.file - the file that defines it.
   * @param target.node - its `function_definition`.
   * @returns true when it is that function.
   */
  private isFunction(name: string, target: { file: SourceFile; node: Node }): boolean {
    const found = this.resolve(name);
    return (
      found?.kind === "function" &&
      found.file.path === target.file.path &&
      found.node.startIndex === target.node.startIndex
    );
  }

  /** Drops every file's records; the run's trees, not the model, free the syntax trees. */
  dispose(): void {
    this.parsed.clear();
    this.models.clear();
    this.pinned.clear();
    this.calls.clear();
  }

  /**
   * Reads a file once per text, from the run's tree of it; its FastAPI
   * records are read later, on first use (`recordsOf`).
   *
   * @param file - the source file, with normalised text.
   * @param own - true when the text is the adapter's own (`fileModel`); a
   *   project read then never replaces it.
   * @returns the cached parse.
   */
  private parse(file: SourceFile, own = false): Parsed {
    const cached = this.parsed.get(file.path);
    if (cached && (cached.file.text === file.text || (!own && this.pinned.has(file.path)))) {
      return cached;
    }
    this.models.delete(file.path);
    const tree = this.trees.treeOf(file);
    const names = importedNames(tree, file);
    const functions = moduleFunctions(tree.rootNode);
    const qualify = qualifierFor(names, file.module);
    const definitions = moduleDefinitions(tree.rootNode);
    const parsed = { file, names, functions, definitions, qualify };
    this.parsed.set(file.path, parsed);
    return parsed;
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

/**
 * Looks a name up among one file's module-level functions, classes and
 * constants, in that order.
 *
 * @param parsed - the file's parse.
 * @param src - the file.
 * @param local - the name as bound in the file.
 * @returns the definition, or null when the file defines no such name.
 */
function definitionIn(
  parsed: Parsed,
  src: SourceFile,
  local: string,
): Exclude<Definition, { kind: "object" }> | null {
  const { functions, definitions, qualify } = parsed;
  const fn = functions.get(local);
  const cls = definitions.classes.get(local);
  const constant = definitions.constants.get(local);
  if (fn) {
    return { kind: "function", file: src, node: fn, qualify };
  }
  if (cls) {
    return { kind: "class", file: src, node: cls, qualify };
  }
  return constant ? { kind: "constant", file: src, node: constant, qualify } : null;
}
