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
import type { Node, Tree } from "web-tree-sitter";
import type { SourceFile } from "../../../shared/contracts/records.ts";
import type { ProjectIndex } from "../../../shared/lookup/project-index.ts";
import { moduleFunctions } from "../../../shared/python/nodes.ts";
import { importedNames, normalizeSource } from "../../../shared/python/parser.ts";
import { type Qualify, qualifierFor } from "../../../shared/python/qualify.ts";
import { type ModuleDefinitions, moduleDefinitions } from "../../shared/definitions.ts";
import { type FoundDefinition, RouterKinds } from "../../shared/fastapi-routers.ts";
import type { FileTrees } from "../../shared/module-trees.ts";
import { type CallSite, CallSites } from "./_call-sites.ts";
import { extract } from "./_extract.ts";
import type { FastApiFile, FastApiObject } from "./_records.ts";

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
  /** Finds a function's calls across the project, for the graph's parameters (#391). */
  private readonly callSites = new CallSites({
    modules: (): Iterable<string> => this.project.modules,
    sourceOf: (module: string): SourceFile | undefined => this.project.sourceOf(module),
    parse: (src: SourceFile): Parsed => this.parse({ ...src, text: normalizeSource(src.text) }),
    treeOf: (src: SourceFile): Tree => this.trees.treeOf(src),
    resolve: (qualified: string): Definition | null => this.resolve(qualified),
  });

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
      if (src === undefined || head === "" || this.unbound(src, head, rest)) {
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
   * Tells, without parsing a module the model hasn't read, that none of its
   * imports binds a name, so a dotted name through it (`service.list`, where
   * `service` is defined in the module) leads nowhere: only an import would
   * carry the walk on. FAPI002 asks this for nearly every call an endpoint
   * makes, and parsing each service module it names was a quarter of the
   * FastAPI rules' cost on Polar (#395).
   *
   * @param src - the module's file, as the project index reads it.
   * @param head - the name's first segment in that module.
   * @param rest - the segments after it; with none, the module's own definitions count and it must be read.
   * @returns true when the name goes on past `head`, the module is unread and its imports don't bind `head`.
   */
  private unbound(src: SourceFile, head: string, rest: readonly string[]): boolean {
    if (rest.length === 0 || this.parsed.has(src.path)) {
      return false;
    }
    const names = this.trees.boundNames({ ...src, text: normalizeSource(src.text) });
    return names !== undefined && !names.has(head);
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
   * (#391), so a parameter of it can be followed one hop (`call-sites.ts`).
   *
   * @param qualified - the function's qualified name, e.g. `app.wiring.wire`.
   * @returns the calls with their files' qualifiers, or null when they can't all be known.
   */
  callsTo(qualified: string): readonly CallSite[] | null {
    return this.callSites.callsTo(qualified);
  }

  /** Drops every file's records; the run's trees, not the model, free the syntax trees. */
  dispose(): void {
    this.parsed.clear();
    this.models.clear();
    this.pinned.clear();
    this.callSites.clear();
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
