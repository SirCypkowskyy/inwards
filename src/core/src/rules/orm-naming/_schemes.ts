/**
 * @file The project-wide side of INW016's naming check (#361): a project
 * that follows another scheme consistently, such as plural table names or
 * datetime columns ending with `_on`, gets one finding that names its scheme
 * and the option value that matches it, instead of one finding per name. It
 * decides from every table and column a whole-project run read, and says
 * which per-name findings the one finding replaces; the caller drops them.
 * No parsing and no I/O: `check.ts` hands it the names it read.
 */
import type { Diagnostic, Fix, SourceFile, Span } from "../../contracts/records.ts";
import { diagnostic, RULES } from "../../meta/registry.ts";
import type { TableName, TimeColumn } from "./_models.ts";
import { isSnake, singularOf, TIME_SUFFIXES } from "./_names.ts";

/**
 * Fewer names than this aren't a scheme: a project with three plural tables
 * gets three findings, which say as much as one.
 */
const MIN_NAMES = 5;

/**
 * The share of the names that must follow the other scheme. Not all of
 * them: Polar's 104 table names are plural but for six, and those six
 * (`billing_entry`, `organization_review_feedback`, `events_by_timestamp`)
 * pass the singular scheme anyway.
 */
const SHARE = 0.9;

/** `SHARE` as the fix steps write it. */
const PERCENT = "90%";

/** How many names a fix step lists as examples. */
const EXAMPLES = 3;

/** A table or column with the file it is declared in. */
export interface Placed<T extends { readonly span: Span }> {
  readonly src: SourceFile;
  readonly item: T;
}

/** The project-wide findings, and the per-name findings they replace. */
export interface Schemes {
  readonly findings: Diagnostic[];
  /** `foldKey`s of the per-name findings the project-wide ones replace. */
  readonly folded: ReadonlySet<string>;
}

/** The parts of INW016's options the schemes compare against. */
export interface SchemeSettings {
  readonly tableName: "snake" | "snake_singular" | false;
  readonly datetimeSuffix: string | false;
  readonly dateSuffix: string | false;
  readonly allowTables: ReadonlySet<string>;
}

/**
 * The key a per-name finding is matched on: its file and where it starts,
 * which is where its name starts.
 *
 * @param file - the finding's path.
 * @param line - its 1-based line.
 * @param column - its 1-based column.
 * @returns `file:line:column`.
 */
export function foldKey(file: string, line: number, column: number): string {
  return `${file}:${line}:${column}`;
}

/**
 * Tells whether enough of the names follow the other scheme to call it the project's.
 *
 * @param following - how many names follow it.
 * @param total - how many names there are.
 * @returns true at `MIN_NAMES` names or more, with at least `SHARE` of them following it.
 */
function consistent(following: number, total: number): boolean {
  return total >= MIN_NAMES && following >= SHARE * total;
}

/**
 * Lists a few names as examples for a fix step.
 *
 * @param names - the names, in source order.
 * @returns up to three distinct names, quoted and joined.
 */
function examples(names: readonly string[]): string {
  return [...new Set(names)]
    .slice(0, EXAMPLES)
    .map((name) => `\`${name}\``)
    .join(", ");
}

/**
 * Builds the project-wide finding and the keys of the findings it replaces.
 *
 * @param replaced - the names whose own findings it replaces, in source order; never empty.
 * @param message - what the project does, and the option value that matches it.
 * @param fix - the advice.
 * @returns the finding, on the first replaced name, and the keys.
 */
function schemeFinding<T extends { readonly span: Span }>(
  replaced: readonly [Placed<T>, ...Placed<T>[]],
  message: string,
  fix: Fix,
): Schemes {
  const [first] = replaced;
  return {
    findings: [diagnostic(RULES.INW016, first.src, { span: first.item.span, message, fix })],
    folded: new Set(
      replaced.map(({ src, item }) => foldKey(src.path, item.span.line, item.span.column)),
    ),
  };
}

/**
 * Finds a project whose table names are plural, under the singular scheme.
 * Only lower_case_snake names outside `allow-tables` count: a name that isn't
 * snake case keeps its own finding.
 *
 * @param tables - every table the run read, in file order.
 * @param settings - the scheme.
 * @returns the finding and the plural names' keys, or nothing.
 */
function pluralTables(tables: readonly Placed<TableName>[], settings: SchemeSettings): Schemes {
  if (settings.tableName !== "snake_singular") {
    return { findings: [], folded: new Set() };
  }
  const named = tables.filter(
    ({ item }) => isSnake(item.name) && !settings.allowTables.has(item.name),
  );
  const plural = named.filter(({ item }) => singularOf(item.name) !== undefined);
  const [first, ...rest] = plural;
  if (first === undefined || !consistent(plural.length, named.length)) {
    return { findings: [], folded: new Set() };
  }
  return schemeFinding(
    [first, ...rest],
    'This project names its tables in the plural, which the singular scheme reports on every table: `table-name = "snake"` matches it.',
    {
      summary:
        'Ask the user to set `table-name = "snake"` in [tool.inwards.rules.orm-naming], or rename the tables to the singular.',
      steps: [
        `${plural.length} of ${named.length} table names read as plural, such as ${examples(plural.map(({ item }) => item.name))}; INW016 reports them here once instead of on each name.`,
        "If the plural is the project's choice, ask the user to set `table-name = \"snake\"` in [tool.inwards.rules.orm-naming]. Don't edit [tool.inwards] yourself.",
        `To move to the singular instead, rename each table with a migration, such as Alembic's \`op.rename_table\`. Once fewer than ${PERCENT} of the names are plural, each one is reported on its own.`,
      ],
    },
  );
}

/**
 * Finds the suffix most of the names end with instead of the configured one.
 *
 * @param names - the column names.
 * @param total - how many columns of the kind there are.
 * @returns the suffix, or undefined when no one suffix is consistent.
 */
function sharedSuffix(names: readonly string[], total: number): string | undefined {
  return TIME_SUFFIXES.find((suffix) =>
    consistent(names.filter((name) => name.endsWith(suffix) && name !== suffix).length, total),
  );
}

/**
 * Finds a project whose datetime (or date) columns follow another scheme
 * than the configured suffix: another suffix, or none.
 *
 * @param columns - every column of the kind the run read, in file order.
 * @param kind - datetime or date.
 * @param suffix - the configured suffix, or false when the check is off.
 * @returns the finding and the failing columns' keys, or nothing.
 */
function columnScheme(
  columns: readonly Placed<TimeColumn>[],
  kind: TimeColumn["kind"],
  suffix: string | false,
): Schemes {
  const failing = columns.filter(({ item }) => suffix !== false && !item.name.endsWith(suffix));
  const [first, ...rest] = failing;
  if (first === undefined || suffix === false || !consistent(failing.length, columns.length)) {
    return { findings: [], folded: new Set() };
  }
  const names = failing.map(({ item }) => item.name);
  const other = sharedSuffix(names, columns.length);
  const option = `${kind}-suffix = ${other === undefined ? "false" : `"${other}"`}`;
  const message =
    other === undefined
      ? `This project's ${kind} column names don't end with \`${suffix}\` or any other one suffix: \`${option}\` matches it.`
      : `This project ends its ${kind} column names with \`${other}\`, not \`${suffix}\`: \`${option}\` matches it.`;
  return schemeFinding([first, ...rest], message, {
    summary: `Ask the user to set \`${option}\` in [tool.inwards.rules.orm-naming], or rename the columns to end with \`${suffix}\`.`,
    steps: [
      `${failing.length} of ${columns.length} ${kind} column names don't end with \`${suffix}\`, such as ${examples(names)}; INW016 reports them here once instead of on each name.`,
      `If that is the project's choice, ask the user to set \`${option}\` in [tool.inwards.rules.orm-naming]. Don't edit [tool.inwards] yourself.`,
      `To move to \`${suffix}\` instead, rename each column with a migration, such as Alembic's \`op.alter_column(..., new_column_name=...)\`. Once fewer than ${PERCENT} of the names break the scheme, each one is reported on its own.`,
    ],
  });
}

/**
 * Finds the project-wide scheme findings over every table and column a
 * whole-project run read: plural tables, and datetime and date columns
 * that consistently skip the configured suffix.
 *
 * @param tables - every table, in file order.
 * @param columns - every datetime and date column, in file order.
 * @param settings - the configured table scheme, suffixes and allowed tables.
 * @returns the findings, and the keys of the per-name findings they replace.
 */
export function schemeFindings(
  tables: readonly Placed<TableName>[],
  columns: readonly Placed<TimeColumn>[],
  settings: SchemeSettings,
): Schemes {
  const parts = [
    pluralTables(tables, settings),
    columnScheme(
      columns.filter(({ item }) => item.kind === "datetime"),
      "datetime",
      settings.datetimeSuffix,
    ),
    columnScheme(
      columns.filter(({ item }) => item.kind === "date"),
      "date",
      settings.dateSuffix,
    ),
  ];
  return {
    findings: parts.flatMap((part) => part.findings),
    folded: new Set(parts.flatMap((part) => [...part.folded])),
  };
}
