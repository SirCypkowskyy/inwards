/**
 * @file INW016 `orm-naming` (#297, from #98): ORM table names and the names
 * of datetime and date columns follow the project's scheme, by default the
 * one fastapi-best-practices sets: lower_case_snake singular tables, `_at`
 * for datetimes and `_date` for dates. One finding per name that breaks it,
 * on the name, with the name to use instead. A whole-project run also
 * reports, once, a project whose SQLAlchemy tables have no `MetaData`
 * naming convention, and a project that follows another scheme
 * consistently (`projectFindings`, with `schemes.ts`); the caller decides
 * which runs get them. A file that names no ORM construct is never parsed,
 * and neither is an Alembic migration. I/O-free: the caller supplies the
 * run's trees, the files and the options.
 */
import { stringList } from "../../config/rule-options.ts";
import type { RuleOptions } from "../../config/rule-settings.ts";
import type { Diagnostic, Fix, SourceFile } from "../../contracts/records.ts";
import { diagnostic, RULES } from "../../meta/registry.ts";
import type { FileTrees } from "../shared/module-trees.ts";
import {
  type Models,
  readModels,
  setsNamingConvention,
  type TableName,
  type TimeColumn,
} from "./models.ts";
import { isSnake, singularOf, toSnake, withSuffix } from "./names.ts";
import { type Placed, type SchemeSettings, type Schemes, schemeFindings } from "./schemes.ts";

/** Text that may declare a table or a datetime or date column. */
const MAY_DECLARE =
  /__tablename__|db_table|\bTable\s*\(|\btable\s*=\s*True|\bMapped\b|\bColumn\s*\(|mapped_column|DateTimeField|DateField/u;

/**
 * An Alembic migration script: it imports `alembic` (`from alembic import
 * op`). Its tables and columns record the schema's history, so a rename
 * belongs in the model and a new migration, which the model's own finding
 * asks for. The #182 corpus run found 20 such repeats in Polar's migrations.
 */
const ALEMBIC_MIGRATION = /^(?:from\s+alembic(?:\.\w+)*\s+import|import\s+alembic)\b/mu;

/**
 * Tells whether INW016 reads a file at all: it names a table or column
 * construct and isn't an Alembic migration.
 *
 * @param src - the file, with normalised text.
 * @returns true when the file is worth a parse.
 */
function mayDeclare(src: SourceFile): boolean {
  return MAY_DECLARE.test(src.text) && !ALEMBIC_MIGRATION.test(src.text);
}

/** What INW016 reads from its options, with their defaults. */
type Settings = SchemeSettings;

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
            `If "${table.name}" is singular in fact (a mass noun such as "news"), ask the user to add it to \`allow-tables\` in [tool.inwards.rules.orm-naming]; if the project names all its tables in the plural, ask for \`table-name = "snake"\` there instead. Don't edit [tool.inwards] yourself.`,
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
        span: table.span,
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
      span: table.span,
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
  const head = `${kind} column \`${column.name}\` doesn't end with \`${suffix}\``;
  return [
    diagnostic(RULES.INW016, src, {
      span: column.span,
      message:
        wanted === undefined
          ? `${head}: name it for what it records, ending with \`${suffix}\`.`
          : `${head}: name it \`${wanted}\`.`,
      fix: {
        summary:
          wanted === undefined
            ? `Rename the column \`${column.name}\` after what it records, ending with \`${suffix}\`, such as \`created${suffix}\`.`
            : `Rename the column \`${column.name}\` to \`${wanted}\`.`,
        steps: [
          "Rename it where it is declared, and every attribute access, query and serializer that uses it.",
          `If the column already exists, add a migration that renames it, such as Alembic's \`op.alter_column(<table>, "${column.name}", new_column_name="${wanted ?? `<name>${suffix}`}")\`.`,
        ],
      },
    }),
  ];
}

/**
 * Parses a file and reads its models.
 *
 * @param trees - the run's trees, which parse each text once per run.
 * @param src - the file, with normalised text.
 * @returns its tables and columns.
 */
function modelsOf(trees: FileTrees, src: SourceFile): Models {
  return readModels(trees.treeOf(src), src);
}

/**
 * Checks one file against INW016's naming scheme. The caller decides whether
 * the rule is on for the file; this parses only a file whose text names a
 * table or column construct.
 *
 * @param trees - the run's trees, which parse each text once per run.
 * @param src - the file, with normalised text.
 * @param options - `[tool.inwards.rules.orm-naming]`, if set.
 * @param read - where the file's models are kept for the project-wide findings, when given.
 * @returns the findings in source order, before suppressions and severities apply.
 */
export function checkOrmNaming(
  trees: FileTrees,
  src: SourceFile,
  options: RuleOptions | undefined,
  read?: Map<SourceFile, Models>,
): Diagnostic[] {
  if (!mayDeclare(src)) {
    return [];
  }
  const settings = settingsOf(options);
  const models = modelsOf(trees, src);
  read?.set(src, models);
  const { tables, columns } = models;
  return [
    ...tables.flatMap((table) => checkTable(table, settings, src)),
    ...columns.flatMap((column) => checkColumn(column, settings, src)),
  ].sort((a, b) => a.line - b.line || a.column - b.column);
}

/**
 * Tells whether a file sets a `MetaData` naming convention, parsing it only
 * when its text names one.
 *
 * @param trees - the run's trees, which parse each text once per run.
 * @param src - the file, with normalised text.
 * @returns true when it sets one.
 */
function hasConvention(trees: FileTrees, src: SourceFile): boolean {
  if (!src.text.includes("naming_convention")) {
    return false;
  }
  return setsNamingConvention(trees.treeOf(src), src);
}

/**
 * Builds the project-wide finding for a missing naming convention, on a table.
 *
 * @param src - the file the table is declared in.
 * @param table - the first SQLAlchemy or SQLModel table the rule covers.
 * @returns the finding, with the convention to add.
 */
function conventionFinding(src: SourceFile, table: TableName): Diagnostic {
  return diagnostic(RULES.INW016, src, {
    span: table.span,
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
  });
}

/**
 * Finds INW016's project-wide findings over a whole-project run's files:
 *
 * - SQLAlchemy or SQLModel tables and no `MetaData(naming_convention=...)`
 *   anywhere among the files, on the first such table of the files
 *   `checked` accepts, in the order given. A convention in any file counts,
 *   whether the rule covers that file or not.
 * - A project that follows another naming scheme consistently (`schemes.ts`),
 *   on its first name, with the keys of the per-name findings it replaces.
 *
 * The models come from `read`, which the per-file checks of the same run
 * filled; a file the rule covers and `read` lacks is parsed here.
 *
 * @param trees - the run's trees, which parse each text once per run.
 * @param files - every file of the run, with normalised text.
 * @param options - `[tool.inwards.rules.orm-naming]`, if set.
 * @param scope - which files count, and what was read of them.
 * @param scope.checked - tells whether the rule covers a file.
 * @param scope.read - the models the per-file checks read, by file.
 * @returns the findings, and the per-name findings they replace.
 */
export function projectFindings(
  trees: FileTrees,
  files: readonly SourceFile[],
  options: RuleOptions | undefined,
  scope: { checked: (src: SourceFile) => boolean; read: ReadonlyMap<SourceFile, Models> },
): Schemes {
  const settings = settingsOf(options);
  const tables: Placed<TableName>[] = [];
  const columns: Placed<TimeColumn>[] = [];
  for (const src of files) {
    if (scope.checked(src) && mayDeclare(src)) {
      const models = scope.read.get(src) ?? modelsOf(trees, src);
      tables.push(...models.tables.map((item) => ({ src, item })));
      columns.push(...models.columns.map((item) => ({ src, item })));
    }
  }
  const schemes = schemeFindings(tables, columns, settings);
  const first = tables.find(({ item }) => item.sqlalchemy);
  const wanted =
    first !== undefined &&
    options?.["require-naming-convention"] !== false &&
    !files.some((src) => hasConvention(trees, src));
  return {
    findings: [...(wanted ? [conventionFinding(first.src, first.item)] : []), ...schemes.findings],
    folded: schemes.folded,
  };
}
