/**
 * @file Reads the table names and the datetime and date columns one parsed
 * module declares, for INW016. Tables: SQLAlchemy's `__tablename__` and
 * `Table("name", ...)`, the name SQLModel derives for a `table=True` class
 * without one (the class name, lower-cased), and Django's `Meta.db_table`.
 * Columns: `Mapped[datetime]` and `Mapped[date]` annotations (through
 * `Optional`, unions and `| None`), `mapped_column` and `Column` with a
 * `DateTime`, `TIMESTAMP` or `Date` type, a SQLModel table class's
 * `datetime` and `date` fields, and Django's `DateTimeField` and
 * `DateField`. A column's name is the one the database gets: the string a
 * call passes (`mapped_column("created", DateTime)`, `db_column=`), else the
 * attribute's. Only string literals and same-file constants count as names.
 * It also tells whether the module sets a `MetaData` naming convention. It
 * owns no tree and decides nothing: `check.ts` holds the names to the scheme.
 */
import type { Node, Tree } from "web-tree-sitter";
import type { SourceFile } from "../../contracts/records.ts";
import { argumentAt, literalString } from "../../python/literals.ts";
import { identifierName, keywordOf, namedChildren } from "../../python/nodes.ts";
import { importedNames } from "../../python/parser.ts";
import { qualifierFor } from "../../python/qualify.ts";
import { moduleAliases, type TypeContext } from "../shared/annotations.ts";
import {
  calleeOf,
  columnTypeKind,
  DJANGO_FIELDS,
  keywordValue,
  lastSegment,
  mappedKind,
  ORM_ROOTS,
  pythonKind,
  type TimeKind,
} from "./types.ts";

/** One table name a module declares. */
export interface TableName {
  /** The node the finding points at: the string, or the class name SQLModel derives from. */
  readonly node: Node;
  readonly name: string;
  /** The class name, when SQLModel derives the table name from it. */
  readonly derivedFrom?: string;
  /** True for a SQLAlchemy or SQLModel table, which a `MetaData` naming convention covers. */
  readonly sqlalchemy: boolean;
}

/** One datetime or date column a module declares. */
export interface TimeColumn {
  /** The node the finding points at: the name string, or the attribute. */
  readonly node: Node;
  readonly name: string;
  readonly kind: TimeKind;
}

/** What INW016 reads from one module. */
export interface Models {
  readonly tables: readonly TableName[];
  readonly columns: readonly TimeColumn[];
}

/** One module, read for INW016. */
interface Reading {
  readonly context: TypeContext;
  readonly tables: TableName[];
  readonly columns: TimeColumn[];
  /** The `Column` and `mapped_column` calls a class body already read. */
  readonly handled: Set<number>;
}

/**
 * Reads a `Column(...)` or `mapped_column(...)` call: the name it passes, if
 * any, and its type. A string first argument is the name, and the type follows it.
 *
 * @param call - the `call` node.
 * @param context - the module's qualifier.
 * @returns the name node and value, and the type's kind.
 */
function columnCall(
  call: Node,
  context: TypeContext,
): { name?: { node: Node; value: string }; kind: TimeKind | undefined } {
  const first = argumentAt(call, 0, "");
  const value = literalString(first);
  const typeArg = argumentAt(call, value === null ? 0 : 1, "") ?? keywordValue(call, "type_");
  const kind = columnTypeKind(typeArg, context);
  return value !== null && first ? { name: { node: first, value }, kind } : { kind };
}

/**
 * Tells whether a class statement opens with `table=True` among its bases, as SQLModel table classes do.
 *
 * @param cls - a `class_definition` node.
 * @returns true for `class Hero(SQLModel, table=True)`.
 */
function isTableClass(cls: Node): boolean {
  const bases = cls.childForFieldName("superclasses");
  return (bases ? namedChildren(bases) : []).some(
    (arg) =>
      arg.type === "keyword_argument" &&
      keywordOf(arg) === "table" &&
      arg.childForFieldName("value")?.type === "true",
  );
}

/**
 * Lists the assignments directly in a class body.
 *
 * @param body - the class's `block`.
 * @returns the `assignment` nodes, plain and annotated.
 */
function assignmentsIn(body: Node): Node[] {
  return namedChildren(body).flatMap((statement) => {
    const inner = statement.type === "expression_statement" ? namedChildren(statement)[0] : null;
    return inner?.type === "assignment" ? [inner] : [];
  });
}

/**
 * Reads Django's `class Meta: db_table = "..."` inside a model class.
 *
 * @param body - the model class's `block`.
 * @param reading - where the table goes.
 */
function readMeta(body: Node, reading: Reading): void {
  for (const meta of namedChildren(body)) {
    const name = meta.childForFieldName("name");
    const block = meta.childForFieldName("body");
    if (!(meta.type === "class_definition" && name && identifierName(name) === "Meta" && block)) {
      continue;
    }
    for (const assignment of assignmentsIn(block)) {
      const left = assignment.childForFieldName("left");
      const right = assignment.childForFieldName("right");
      const value = literalString(right);
      if (left?.type === "identifier" && identifierName(left) === "db_table" && right && value) {
        reading.tables.push({ node: right, name: value, sqlalchemy: false });
      }
    }
  }
}

/**
 * Reads the column a class-body call declares, if it is one: `Column`,
 * `mapped_column` or a Django date field.
 *
 * @param call - the assignment's value.
 * @param attribute - the attribute it is assigned to.
 * @param annotation - the attribute's annotation, if any.
 * @param reading - where the column goes.
 * @returns true when the call declares a column, whatever its type.
 */
function readColumnCall(
  call: Node,
  attribute: Node,
  annotation: Node | null,
  reading: Reading,
): boolean {
  const { context } = reading;
  const callee = calleeOf(call, context);
  const orm = lastSegment(callee, ORM_ROOTS);
  if (orm === "Column" || orm === "mapped_column") {
    reading.handled.add(call.id);
    const read = columnCall(call, context);
    const kind =
      read.kind ?? (orm === "mapped_column" ? mappedKind(annotation, context) : undefined);
    if (kind) {
      const { node, value } = read.name ?? { node: attribute, value: identifierName(attribute) };
      reading.columns.push({ node, name: value, kind });
    }
    return true;
  }
  const django = DJANGO_FIELDS.get(lastSegment(callee, ["django.db.models."]) ?? "");
  if (django) {
    const column = keywordValue(call, "db_column");
    const value = literalString(column);
    const named = value !== null && column ? { node: column, value } : undefined;
    const { node, value: name } = named ?? { node: attribute, value: identifierName(attribute) };
    reading.columns.push({ node, name, kind: django });
    return true;
  }
  return false;
}

/**
 * Tells whether a SQLModel field's value leaves its column to the annotation:
 * no value, or a `Field(...)` without `sa_column`.
 *
 * @param value - the assignment's value, if any.
 * @param context - the module's qualifier.
 * @returns true when the annotation decides the column's type.
 */
function plainField(value: Node | null, context: TypeContext): boolean {
  if (value === null) {
    return true;
  }
  return (
    value.type === "call" &&
    calleeOf(value, context) === "sqlmodel.Field" &&
    keywordValue(value, "sa_column") === null
  );
}

/**
 * Reads one assignment in a class body: `__tablename__`, or a column.
 *
 * @param assignment - an `assignment` node directly in the class body.
 * @param table - true in a SQLModel `table=True` class, whose plain fields are columns.
 * @param reading - where the table or column goes.
 * @returns true when it assigns `__tablename__`, whatever the value.
 */
function readAssignment(assignment: Node, table: boolean, reading: Reading): boolean {
  const left = assignment.childForFieldName("left");
  const right = assignment.childForFieldName("right");
  const annotation = assignment.childForFieldName("type");
  if (left?.type !== "identifier") {
    return false;
  }
  if (identifierName(left) === "__tablename__") {
    const value = literalString(right);
    if (right && value !== null) {
      reading.tables.push({ node: right, name: value, sqlalchemy: true });
    }
    return true;
  }
  if (right?.type === "call" && readColumnCall(right, left, annotation, reading)) {
    return false;
  }
  const { context } = reading;
  const field = table && annotation !== null && plainField(right, context);
  const kind =
    mappedKind(annotation, context) ??
    (field && annotation ? pythonKind(annotation, context) : undefined);
  if (kind) {
    reading.columns.push({ node: left, name: identifierName(left), kind });
  }
  return false;
}

/**
 * Reads one class: its `__tablename__`, the table SQLModel derives for it,
 * its Django `Meta.db_table`, and its datetime and date columns.
 *
 * @param cls - a `class_definition` node.
 * @param reading - where the tables and columns go.
 */
function readClass(cls: Node, reading: Reading): void {
  const body = cls.childForFieldName("body");
  const className = cls.childForFieldName("name");
  if (!(body && className)) {
    return;
  }
  const table = isTableClass(cls);
  const named = assignmentsIn(body)
    .map((assignment) => readAssignment(assignment, table, reading))
    .includes(true);
  readMeta(body, reading);
  if (table && !named) {
    const derivedFrom = identifierName(className);
    const name = derivedFrom.toLowerCase();
    reading.tables.push({ node: className, name, derivedFrom, sqlalchemy: true });
  }
}

/**
 * Reads a call outside a class body's own columns: `Table("name", ...)`,
 * and a `Column("name", DateTime)` that passes its name.
 *
 * @param call - a `call` node.
 * @param reading - where the table or column goes.
 */
function readCall(call: Node, reading: Reading): void {
  if (reading.handled.has(call.id)) {
    return;
  }
  const last = lastSegment(calleeOf(call, reading.context), ORM_ROOTS);
  if (last === "Table") {
    const first = argumentAt(call, 0, "");
    const value = literalString(first);
    if (first && value !== null) {
      reading.tables.push({ node: first, name: value, sqlalchemy: true });
    }
  } else if (last === "Column" || last === "mapped_column") {
    const { name, kind } = columnCall(call, reading.context);
    if (name && kind) {
      reading.columns.push({ node: name.node, name: name.value, kind });
    }
  }
}

/**
 * Builds the qualifier and aliases for one parsed module.
 *
 * @param tree - the module's tree.
 * @param src - the module's file.
 * @returns its type context.
 */
function contextOf(tree: Tree, src: SourceFile): TypeContext {
  const names = importedNames(tree, src);
  return { qualify: qualifierFor(names, src.module), aliases: moduleAliases(tree.rootNode) };
}

/**
 * Reads a parsed module's tables and datetime and date columns, in source order.
 *
 * @param tree - the module's tree, which the caller frees.
 * @param src - the module's file, with normalised text.
 * @returns its tables and columns.
 */
export function readModels(tree: Tree, src: SourceFile): Models {
  const reading: Reading = {
    context: contextOf(tree, src),
    tables: [],
    columns: [],
    handled: new Set(),
  };
  const root = tree.rootNode;
  for (const cls of root.descendantsOfType("class_definition")) {
    if (cls) {
      readClass(cls, reading);
    }
  }
  for (const call of root.descendantsOfType("call")) {
    if (call) {
      readCall(call, reading);
    }
  }
  return { tables: reading.tables, columns: reading.columns };
}

/**
 * Tells whether a parsed module sets a naming convention on a `MetaData`:
 * `MetaData(naming_convention=...)` from SQLAlchemy or SQLModel, or an
 * assignment to `<something>.naming_convention`, as in
 * `SQLModel.metadata.naming_convention = {...}`.
 *
 * @param tree - the module's tree, which the caller frees.
 * @param src - the module's file.
 * @returns true when it sets one.
 */
export function setsNamingConvention(tree: Tree, src: SourceFile): boolean {
  const context = contextOf(tree, src);
  const root = tree.rootNode;
  const viaCall = root.descendantsOfType("call").some((call) => {
    const metadata = call && lastSegment(calleeOf(call, context), ORM_ROOTS) === "MetaData";
    return metadata === true && keywordValue(call, "naming_convention") !== null;
  });
  return (
    viaCall ||
    root.descendantsOfType("assignment").some((assignment) => {
      const left = assignment?.childForFieldName("left");
      const attribute = left?.type === "attribute" ? left.childForFieldName("attribute") : null;
      return attribute ? identifierName(attribute) === "naming_convention" : false;
    })
  );
}
