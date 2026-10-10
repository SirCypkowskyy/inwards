/**
 * @file The FastAPI model every FAPI rule reads (#186): per file, the apps and
 * routers, their path operations, the `include_router` and `mount` edges and
 * the exception handlers (`extract.ts`), with names resolved across files
 * through `ProjectIndex`, which reads each file lazily. The application is
 * never imported or run.
 *
 * A file is parsed once per text, and only when it mentions FastAPI at all
 * (`mentionsFastApi`) or a name leads to it. Its tree is kept until
 * `dispose()`, because the records hand out syntax nodes (a path
 * operation's function, a keyword's value) for the rules to walk. The model
 * reports nothing; deciding what is wrong is the rules' job.
 */
import type { Node, Parser, Tree } from "web-tree-sitter";
import type { SourceFile } from "../../contracts/records.ts";
import type { ProjectIndex } from "../../lookup/project-index.ts";
import { importedNames, normalizeSource, parsePython } from "../../python/parser.ts";
import { type Qualify, qualifierFor } from "../../python/qualify.ts";
import { type ModuleDefinitions, moduleDefinitions } from "./definitions.ts";
import { extract, moduleFunctions } from "./extract.ts";
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

/** One parsed file, kept until `dispose()`. */
interface Parsed {
  readonly text: string;
  readonly tree: Tree;
  /** What each imported name refers to. */
  readonly names: ReadonlyMap<string, string>;
  /** Module-level functions by name. */
  readonly functions: ReadonlyMap<string, Node>;
  /** Module-level classes and constants by name. */
  readonly definitions: ModuleDefinitions;
  readonly qualify: Qualify;
  /** Null when the text doesn't pass the pre-filter. */
  readonly model: FastApiFile | null;
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
 * file. Build one per check with the engine's parser and the check's
 * `ProjectIndex`, and call `dispose()` when done: it frees the syntax trees
 * whose nodes the records hold.
 */
export class FastApiModel {
  private readonly parser: Parser;
  private readonly project: ProjectIndex;
  private readonly parsed = new Map<string, Parsed>();
  /** Paths whose text came from `fileModel`, the adapter's view, which a disk read must not replace. */
  private readonly pinned = new Set<string>();

  /**
   * Wraps a parser and a project index. Nothing is read or parsed yet.
   *
   * @param parser - parser with the Python grammar loaded.
   * @param project - the project's module index, which reads files on demand.
   */
  constructor(parser: Parser, project: ProjectIndex) {
    this.parser = parser;
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
    const { model } = this.parse({ ...file, text }, true);
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
    return src !== undefined && MENTIONS.test(text) ? this.parse({ ...src, text }).model : null;
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
      const found = rest.length === 0 ? definitionIn(parsed, src, head) : null;
      const next = parsed.names.get(head);
      if (found !== null || next === undefined) {
        return found;
      }
      name = [next, ...rest].join(".");
    }
    return null;
  }

  /** Frees every syntax tree the model holds; the nodes it handed out are invalid afterwards. */
  dispose(): void {
    for (const { tree } of this.parsed.values()) {
      tree.delete(); // WASM memory is not garbage collected
    }
    this.parsed.clear();
    this.pinned.clear();
  }

  /**
   * Parses a file once per text, and reads its records when it passes the pre-filter.
   *
   * @param file - the source file, with normalised text.
   * @param own - true when the text is the adapter's own (`fileModel`); a
   *   project read then never replaces it.
   * @returns the cached parse.
   */
  private parse(file: SourceFile, own = false): Parsed {
    const cached = this.parsed.get(file.path);
    if (cached && (cached.text === file.text || (!own && this.pinned.has(file.path)))) {
      return cached;
    }
    cached?.tree.delete();
    const tree = parsePython(this.parser, file.text);
    const names = importedNames(tree, file);
    const functions = moduleFunctions(tree.rootNode);
    const qualify = qualifierFor(names, file.module);
    const model = MENTIONS.test(file.text)
      ? extract(tree.rootNode, { file, qualify, functions })
      : null;
    const definitions = moduleDefinitions(tree.rootNode);
    const parsed = { text: file.text, tree, names, functions, definitions, qualify, model };
    this.parsed.set(file.path, parsed);
    return parsed;
  }
}

/**
 * Looks a name up among one file's objects and module-level functions,
 * classes and constants, in that order.
 *
 * @param parsed - the file's parse.
 * @param src - the file.
 * @param local - the name as bound in the file.
 * @returns the definition, or null when the file defines no such name.
 */
function definitionIn(parsed: Parsed, src: SourceFile, local: string): Definition | null {
  const object = parsed.model?.objects.find((o) => o.local === local);
  if (parsed.model && object) {
    return { kind: "object", file: parsed.model, object };
  }
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
