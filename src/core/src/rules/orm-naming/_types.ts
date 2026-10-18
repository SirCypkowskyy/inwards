/**
 * @file Reads names and types out of ORM syntax for INW016: which library a
 * qualified name comes from, a keyword argument's value, and whether a
 * SQLAlchemy column type (`DateTime`, `TIMESTAMP`, `Date`), a Python
 * annotation (`datetime`, `date`, through `Optional` and unions) or a
 * `Mapped[...]` annotation stands for a datetime or a date. One node at a
 * time, through the file's qualifier; `models.ts` decides what is a table
 * or a column.
 */
import type { Node } from "web-tree-sitter";
import { keywordOf, namedChildren } from "../../python/nodes.ts";
import { type TypeContext, typesOf } from "../shared/annotations.ts";

/** Whether a column holds a datetime or a date. */
export type TimeKind = "datetime" | "date";

/** The libraries whose `Table`, `Column`, `MetaData` and column types count. */
export const ORM_ROOTS: readonly string[] = ["sqlalchemy.", "sqlmodel."];

/** Column types by their last name segment, as SQLAlchemy and its dialects spell them. */
const COLUMN_TYPES: ReadonlyMap<string, TimeKind> = new Map([
  ["DateTime", "datetime"],
  ["DATETIME", "datetime"],
  ["TIMESTAMP", "datetime"],
  ["Date", "date"],
  ["DATE", "date"],
]);

/** Python types a `Mapped[...]` or SQLModel field annotation maps to a datetime or date column. */
const PYTHON_TYPES: ReadonlyMap<string, TimeKind> = new Map([
  ["datetime.datetime", "datetime"],
  ["pydantic.AwareDatetime", "datetime"],
  ["pydantic.NaiveDatetime", "datetime"],
  ["datetime.date", "date"],
]);

/** Django's date fields, by name. */
export const DJANGO_FIELDS: ReadonlyMap<string, TimeKind> = new Map([
  ["DateTimeField", "datetime"],
  ["DateField", "date"],
]);

/**
 * Finds a keyword argument's value: `sa_column=...` in `Field(sa_column=...)`.
 *
 * @param call - a `call` node.
 * @param keyword - the keyword's name, such as `sa_column`.
 * @returns the value node, or null when the call doesn't pass it by keyword.
 */
export function keywordValue(call: Node, keyword: string): Node | null {
  const list = call.childForFieldName("arguments");
  const arg = (list ? namedChildren(list) : []).find(
    (a) => a.type === "keyword_argument" && keywordOf(a) === keyword,
  );
  return arg?.childForFieldName("value") ?? null;
}

/**
 * Splits a dotted name into its library root and last segment.
 *
 * @param qualified - a qualified name, or null.
 * @param roots - the prefixes that count.
 * @returns the last segment, or undefined when the name starts with none of the roots.
 */
export function lastSegment(
  qualified: string | null,
  roots: readonly string[],
): string | undefined {
  return qualified !== null && roots.some((root) => qualified.startsWith(root))
    ? qualified.slice(qualified.lastIndexOf(".") + 1)
    : undefined;
}

/**
 * Qualifies a call's callee.
 *
 * @param call - a `call` node.
 * @param context - the module's qualifier.
 * @returns the qualified name, or null for a callee that isn't a name or attribute.
 */
export function calleeOf(call: Node, context: TypeContext): string | null {
  const callee = call.childForFieldName("function");
  return callee ? context.qualify(callee) : null;
}

/**
 * Reads the kind of a SQLAlchemy column type: `DateTime`, `sa.DateTime(timezone=True)`.
 *
 * @param node - a type argument, or null.
 * @param context - the module's qualifier.
 * @returns datetime, date, or undefined for any other type.
 */
export function columnTypeKind(node: Node | null, context: TypeContext): TimeKind | undefined {
  const type = node?.type === "call" ? node.childForFieldName("function") : node;
  const last = type ? lastSegment(context.qualify(type), ORM_ROOTS) : undefined;
  return last === undefined ? undefined : COLUMN_TYPES.get(last);
}

/**
 * Reads the kind of a Python type annotation, through `Optional`, unions and `| None`.
 *
 * @param node - an annotation, or a part of one.
 * @param context - the module's qualifier and aliases.
 * @returns datetime, date, or undefined.
 */
export function pythonKind(node: Node, context: TypeContext): TimeKind | undefined {
  const kinds = typesOf(node, context).flatMap((type) => PYTHON_TYPES.get(type) ?? []);
  return kinds[0];
}

/**
 * Reads the kind a `Mapped[...]` annotation declares.
 *
 * @param annotation - an annotation node, or null.
 * @param context - the module's qualifier and aliases.
 * @returns datetime, date, or undefined when it isn't `Mapped` of one.
 */
export function mappedKind(annotation: Node | null, context: TypeContext): TimeKind | undefined {
  const node = annotation?.type === "type" ? namedChildren(annotation)[0] : annotation;
  if (!(node?.type === "subscript" || node?.type === "generic_type")) {
    return undefined;
  }
  const [head, ...rest] = namedChildren(node);
  if (!head || lastSegment(context.qualify(head), ["sqlalchemy."]) !== "Mapped") {
    return undefined;
  }
  const args = rest.flatMap((part) =>
    part.type === "type_parameter" ? namedChildren(part) : [part],
  );
  return args.flatMap((arg) => pythonKind(arg, context) ?? [])[0];
}
