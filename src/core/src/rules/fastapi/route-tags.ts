/**
 * @file Reads the tags a route class's rule runs on (#392): `tags=` on the
 * path operation, its router and each `include_router` above it, every
 * inclusion path separately, as FastAPI builds the route again with the
 * joined tags at each inclusion. A tag is a string or a first-party enum
 * member holding one (Polar's `APITag.public`, a `StrEnum`); anything else
 * leaves the set open. It reads no file; the project lookups do.
 */
import type { Node } from "web-tree-sitter";
import { identifierName, namedChildren } from "../../python/nodes.ts";
import type { Qualify } from "../../python/qualify.ts";
import type { Definition } from "./model.ts";
import type { FastApiObject, Wiring } from "./records.ts";
import { join, stringText, type TagSet } from "./schema-rule.ts";
import type { Value } from "./values.ts";

/** How many inclusion paths above a router are read before its tags count as unknown. */
const MAX_PATHS = 64;

/** What reading tags needs from the project; `FastApiProject` provides it. */
export interface TagLookups {
  /** Resolves a qualified name to a first-party definition. */
  readonly resolve: (qualified: string) => Definition | null;
  /** Lists the inclusions of a router, or null when one may be missing. */
  readonly edgesTo: (
    router: string,
  ) => readonly { readonly wiring: Wiring; readonly parent: string | null }[] | null;
  /** Resolves an app or router by qualified name. */
  readonly objectOf: (qualified: string) => FastApiObject | null;
}

/** Reads tags for one check, each enum member once. */
export class RouteTags {
  private readonly lookups: TagLookups;
  private readonly enums = new Map<string, string | null>();

  /**
   * Wraps the project lookups. Nothing is read yet.
   *
   * @param lookups - resolves names and inclusions.
   */
  constructor(lookups: TagLookups) {
    this.lookups = lookups;
  }

  /**
   * Lists the tag sets every inclusion path adds above an app or router,
   * its own tags included.
   *
   * @param object - the app or router.
   * @param seen - the routers already on this path, which ends an inclusion cycle.
   * @returns one tag set per path; an open one where a path can't be read.
   */
  tagPaths(object: FastApiObject, seen: ReadonlySet<string>): TagSet[] {
    const own = this.tagsOf(
      object.splat || object.factory ? null : object.keywords.get("tags")?.value,
    );
    if (object.kind === "app" || seen.has(object.name)) {
      return [own];
    }
    const edges = this.lookups.edgesTo(object.name);
    if (edges === null) {
      return [{ values: own.values, open: true }];
    }
    if (edges.length === 0) {
      return [own];
    }
    const next = new Set([...seen, object.name]);
    const paths = edges.flatMap(({ wiring, parent }) => {
      const above = parent === null ? null : this.lookups.objectOf(parent);
      const step = join(own, this.tagsOf(wiring.splat ? null : wiring.keywords.get("tags")?.value));
      return above === null
        ? [{ values: step.values, open: true }]
        : this.tagPaths(above, next).map((path) => join(step, path));
    });
    return paths.length > MAX_PATHS ? [{ values: own.values, open: true }] : paths;
  }

  /**
   * Reads a `tags=` value as string values.
   *
   * @param value - the keyword's value; undefined when absent, null when a splat may set it.
   * @returns the tags, open when one isn't a string or an enum member Inwards can read.
   */
  tagsOf(value: Value | null | undefined): TagSet {
    if (value === undefined) {
      return { values: new Set(), open: false };
    }
    if (value === null || value.kind !== "list") {
      return { values: new Set(), open: true };
    }
    const values = value.items.map((item) => {
      if (item.kind === "str") {
        return item.value;
      }
      return item.kind === "name" ? this.enumValue(item.name) : null;
    });
    const read = values.filter((v): v is string => v !== null);
    return { values: new Set(read), open: read.length < values.length };
  }

  /**
   * Reads a tag written in a route class's condition (`Tag.private in tags`).
   *
   * @param node - the tag as written: a string or a name.
   * @param qualify - qualifies names in the route class's file.
   * @returns its string value, or null when it can't be read.
   */
  tagValue(node: Node, qualify: Qualify): string | null {
    if (node.type === "string") {
      return stringText(node);
    }
    const name = qualify(node);
    return name === null ? null : this.enumValue(name);
  }

  /**
   * Reads the string a first-party enum member holds: `Tag.public` for
   * `class Tag(StrEnum): public = "public"`, which equals that string at run time.
   *
   * @param qualified - the member's qualified name, e.g. `app.tags.Tag.public`.
   * @returns the string, or null when it isn't such a member.
   */
  private enumValue(qualified: string): string | null {
    const known = this.enums.get(qualified);
    if (known !== undefined) {
      return known;
    }
    const cut = qualified.lastIndexOf(".");
    const found = cut < 0 ? null : this.lookups.resolve(qualified.slice(0, cut));
    const member = qualified.slice(cut + 1);
    const body = found?.kind === "class" ? found.node.childForFieldName("body") : null;
    const value = body ? memberString(body, member) : null;
    this.enums.set(qualified, value);
    return value;
  }
}

/**
 * Reads the string a class body assigns to a name, the last assignment winning.
 *
 * @param body - a class body block.
 * @param member - the name, e.g. `public`.
 * @returns the plain string literal assigned, or null when there is none.
 */
function memberString(body: Node, member: string): string | null {
  let value: string | null = null;
  for (const statement of namedChildren(body)) {
    const [assignment] = statement.type === "expression_statement" ? namedChildren(statement) : [];
    const left = assignment?.type === "assignment" ? assignment.childForFieldName("left") : null;
    const right = assignment?.childForFieldName("right");
    if (left?.type === "identifier" && identifierName(left) === member && right) {
      value = stringText(right);
    }
  }
  return value;
}
