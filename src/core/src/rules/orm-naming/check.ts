/**
 * @file INW016 `orm-naming` (#297, from #98): ORM table names and the names
 * of datetime and date columns follow the project's scheme, by default the
 * one fastapi-best-practices sets: lower_case_snake singular tables, `_at`
 * for datetimes and `_date` for dates. One finding per name that breaks it,
 * on the name, with the name to use instead. A whole-project run also
 * reports, once, a project whose SQLAlchemy tables have no `MetaData`
 * naming convention (`conventionFinding`); the caller decides which runs
 * get it. A file that names no ORM construct is never parsed. I/O-free: the
 * caller supplies the parser, the files and the options.
 */
import type { Node, Parser } from "web-tree-sitter";
import { stringList } from "../../config/rule-options.ts";
import type { RuleOptions } from "../../config/rule-settings.ts";
import type { Diagnostic, Fix, SourceFile, Span } from "../../contracts/records.ts";
import { diagnostic, RULES } from "../../meta/registry.ts";
import { parsePython } from "../../python/parser.ts";
import {
  type Models,
  readModels,
  setsNamingConvention,
  type TableName,
  type TimeColumn,
} from "./models.ts";
import { isSnake, singularOf, toSnake, withSuffix } from "./names.ts";

/** Text that may declare a table or a datetime or date column. */
const MAY_DECLARE =
  /__tablename__|db_table|\bTable\s*\(|\btable\s*=\s*True|\bMapped\b|\bColumn\s*\(|mapped_column|DateTimeField|DateField/u;

/** Text that may declare a SQLAlchemy or SQLModel table, which a naming convention covers. */
const MAY_DECLARE_TABLE = /__tablename__|\bTable\s*\(|\btable\s*=\s*True/u;

/** What INW016 reads from its options, with their defaults. */
interface Settings {
  readonly tableName: "snake" | "snake_singular" | false;
  readonly datetimeSuffix: string | false;
  readonly dateSuffix: string | false;
  readonly allowTables: ReadonlySet<string>;
}

/**
 * Reads one suffix option.
 *
 * @param value - the stored value, if any.
 * @param fallback - the default.
 * @returns the suffix, or false when the check is off.
 */
function suffixOf(value: RuleOptions[string], fallback: string): string | false {
  return typeof value === "string" || value === false ? value : fallback;
}

/**
 * Reads INW016's options, with fastapi-best-practices' scheme as the default.
 *
 * @param options - `[tool.inwards.rules.orm-naming]`, if set.
 * @returns the scheme to hold names to.
 */
function settingsOf(options: RuleOptions | undefined): Settings {
  const table = options?.["table-name"];
  return {
    tableName: table === "snake" || table === false ? table : "snake_singular",
    datetimeSuffix: suffixOf(options?.["datetime-suffix"], "_at"),
    dateSuffix: suffixOf(options?.["date-suffix"], "_date"),
    allowTables: new Set(stringList(options?.["allow-tables"]) ?? []),
  };
}

/**
 * Spans a node.
 *
 * @param node - the name's node.
 * @returns the 1-based span.
 */
function spanOf(node: Node): Span {
  return {
    line: node.startPosition.row + 1,
    column: node.startPosition.column + 1,
    endLine: node.endPosition.row + 1,
    endColumn: node.endPosition.column + 1,
  };
}

/**
 * Writes the fix for a table name.
 *
 * @param table - the table whose name breaks the scheme.
 * @param wanted - the name to use.
 * @param plural - true when the name is plural, false when it isn't snake case.
 * @returns the summary and steps.
 */
function tableFix(table: TableName, wanted: string, plural: boolean): Fix {
  const where =
    table.derivedFrom === undefined
      ? `Change the name where it is written to "${wanted}": \`__tablename__\`, the first argument of \`Table(...)\`, or \`db_table\`.`
      : `Set \`__tablename__ = "${wanted}"\` on \`${table.derivedFrom}\`, or rename the class.`;
  return {
    summary: `Rename the table "${table.name}" to "${wanted}".`,
    steps: [
      where,
      `If the table already exists, add a migration that renames it, such as Alembic's \`op.rename_table("${table.name}", "${wanted}")\`, and update raw SQL that names it.`,
      ...(plural
        ? [
            `If "${table.name}" is singular in fact (a mass noun such as "news"), ask the user to add it to \`allow-tables\` in [tool.inwards.rules.orm-naming]. Don't edit [tool.inwards] yourself.`,
          ]
        : []),
    ],
  };
}

/**
 * Checks one table name against the scheme.
 *
 * @param table - the table name and where it is written.
 * @param settings - the scheme.
 * @param src - the file, for the finding's path and module.
 * @returns the finding, or none.
 */
function checkTable(table: TableName, settings: Settings, src: SourceFile): Diagnostic[] {
  if (settings.tableName === false || settings.allowTables.has(table.name)) {
    return [];
  }
  const label =
    table.derivedFrom === undefined
      ? `Table name "${table.name}"`
      : `Table name "${table.name}", which SQLModel derives from the class name \`${table.derivedFrom}\`,`;
  if (!isSnake(table.name)) {
    const wanted = toSnake(table.name);
    return [
      diagnostic(RULES.INW016, src, {
        span: spanOf(table.node),
        message: `${label} isn't lower_case_snake: "${wanted}".`,
        fix: tableFix(table, wanted, false),
      }),
    ];
  }
  const singular = settings.tableName === "snake_singular" ? singularOf(table.name) : undefined;
  if (singular === undefined) {
    return [];
  }
  return [
    diagnostic(RULES.INW016, src, {
      span: spanOf(table.node),
      message: `${label} is plural; this project names tables in the singular: "${singular}".`,
      fix: tableFix(table, singular, true),
    }),
  ];
}

/**
 * Checks one datetime or date column's name against its suffix.
 *
 * @param column - the column's database name, kind and node.
 * @param settings - the scheme.
 * @param src - the file, for the finding's path and module.
 * @returns the finding, or none.
 */
function checkColumn(column: TimeColumn, settings: Settings, src: SourceFile): Diagnostic[] {
  const suffix = column.kind === "datetime" ? settings.datetimeSuffix : settings.dateSuffix;
  if (suffix === false || column.name.endsWith(suffix)) {
    return [];
  }
  const kind = column.kind === "datetime" ? "Datetime" : "Date";
  const wanted = withSuffix(column.name, suffix);
  return [
    diagnostic(RULES.INW016, src, {
      span: spanOf(column.node),
      message: `${kind} column \`${column.name}\` doesn't end with \`${suffix}\`: name it \`${wanted}\`.`,
      fix: {
        summary: `Rename the column \`${column.name}\` to \`${wanted}\`.`,
        steps: [
          "Rename it where it is declared, and every attribute access, query and serializer that uses it.",
          `If the column already exists, add a migration that renames it, such as Alembic's \`op.alter_column(<table>, "${column.name}", new_column_name="${wanted}")\`.`,
        ],
      },
    }),
  ];
}

/**
 * Parses a file and reads its models.
 *
 * @param parser - parser with the Python grammar loaded.
 * @param src - the file, with normalised text.
 * @returns its tables and columns.
 */
function modelsOf(parser: Parser, src: SourceFile): Models {
  const tree = parsePython(parser, src.text);
  try {
    return readModels(tree, src);
  } finally {
    tree.delete(); // WASM memory is not garbage collected
  }
}

/**
 * Checks one file against INW016's naming scheme. The caller decides whether
 * the rule is on for the file; this parses only a file whose text names a
 * table or column construct.
 *
 * @param parser - parser with the Python grammar loaded.
 * @param src - the file, with normalised text.
 * @param options - `[tool.inwards.rules.orm-naming]`, if set.
 * @returns the findings in source order, before suppressions and severities apply.
 */
export function checkOrmNaming(
  parser: Parser,
  src: SourceFile,
  options: RuleOptions | undefined,
): Diagnostic[] {
  if (!MAY_DECLARE.test(src.text)) {
    return [];
  }
  const settings = settingsOf(options);
  const { tables, columns } = modelsOf(parser, src);
  return [
    ...tables.flatMap((table) => checkTable(table, settings, src)),
    ...columns.flatMap((column) => checkColumn(column, settings, src)),
  ].sort((a, b) => a.line - b.line || a.column - b.column);
}

/**
 * Tells whether a file sets a `MetaData` naming convention, parsing it only
 * when its text names one.
 *
 * @param parser - parser with the Python grammar loaded.
 * @param src - the file, with normalised text.
 * @returns true when it sets one.
 */
function hasConvention(parser: Parser, src: SourceFile): boolean {
  if (!src.text.includes("naming_convention")) {
    return false;
  }
  const tree = parsePython(parser, src.text);
  try {
    return setsNamingConvention(tree, src);
  } finally {
    tree.delete(); // WASM memory is not garbage collected
  }
}

/**
 * Finds the one project-wide INW016 finding: SQLAlchemy or SQLModel tables
 * and no `MetaData(naming_convention=...)` anywhere among the files. It sits
 * on the first such table of the files `checked` accepts, in the order given.
 * A convention in any file counts, whether the rule covers that file or not.
 *
 * @param parser - parser with the Python grammar loaded.
 * @param files - every file of the run, with normalised text.
 * @param options - `[tool.inwards.rules.orm-naming]`, if set.
 * @param checked - tells whether the rule covers a file.
 * @returns the finding, or none.
 */
export function conventionFinding(
  parser: Parser,
  files: readonly SourceFile[],
  options: RuleOptions | undefined,
  checked: (src: SourceFile) => boolean,
): Diagnostic[] {
  if (options?.["require-naming-convention"] === false) {
    return [];
  }
  if (files.some((src) => hasConvention(parser, src))) {
    return [];
  }
  for (const src of files) {
    const table =
      checked(src) && MAY_DECLARE_TABLE.test(src.text)
        ? modelsOf(parser, src).tables.find((t) => t.sqlalchemy)
        : undefined;
    if (table) {
      return [
        diagnostic(RULES.INW016, src, {
          span: spanOf(table.node),
          message:
            "No `MetaData(naming_convention=...)` in the project, so SQLAlchemy leaves unique, check, foreign key and primary key constraints unnamed and the database picks their names.",
          fix: {
            summary: "Give the declarative base's MetaData a naming convention.",
            steps: [
              'Define the convention once, such as `{"ix": "%(column_0_label)s_idx", "uq": "%(table_name)s_%(column_0_name)s_key", "ck": "%(table_name)s_%(constraint_name)s_check", "fk": "%(table_name)s_%(column_0_name)s_fkey", "pk": "%(table_name)s_pkey"}`.',
              "Pass it to the MetaData every model shares: `metadata = MetaData(naming_convention=...)` on the `DeclarativeBase` subclass, or `SQLModel.metadata.naming_convention = ...` before the first model.",
              "Generate a migration: constraints that exist already keep the names the database gave them until the migration renames them.",
            ],
          },
        }),
      ];
    }
  }
  return [];
}
