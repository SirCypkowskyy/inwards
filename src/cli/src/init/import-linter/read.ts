/**
 * @file Reading an import-linter configuration: the `[importlinter]` sections of
 * an INI file (`.importlinter`, `setup.cfg`) or `[tool.importlinter]` of a
 * parsed `pyproject.toml`, into one shape that `convert.ts` maps. It keeps
 * values as import-linter's own reader does (a multi-line INI value is a list,
 * a TOML boolean becomes "True" or "False"), and judges none of them.
 *
 * The INI parser covers what Python's `configparser` does with such a file:
 * sections, `=` or `:` options, indented continuation lines, full-line `#` and
 * `;` comments, and errors on duplicates. It skips `%` interpolation, which
 * module names never need. No I/O: the caller supplies the text.
 */
import { isRecord } from "../../json/guards.ts";

/** One option's value: a single line, or the lines of a multi-line value or TOML array. */
export type OptionValue = string | readonly string[];

/** One import-linter contract, as written. */
export interface LinterContract {
  /** The INI section's id (`importlinter:contract:<id>`) or the TOML `id`, if any. */
  id: string | undefined;
  /** The `name` option, or the id when there is none. */
  name: string;
  /** The `type` option: `layers`, `forbidden`, `independence`, ... */
  type: string;
  /** Every other option, keyed by its lower-case name. */
  options: ReadonlyMap<string, OptionValue>;
}

/** An import-linter configuration: the root packages and the contracts, in file order. */
export interface LinterConfig {
  rootPackages: string[];
  contracts: LinterContract[];
}

const SECTION = "importlinter";
const HEADER = /^\[(?<name>.+)\]$/u;
const OPTION = /^(?<key>[^=:]+?)\s*[=:]\s*(?<value>.*)$/u;
const BOM = /^\uFEFF/u;
const LINE_BREAK = /\r?\n/u;

/** Where the INI parser is: the sections so far, and the section and option it is in. */
interface IniCursor {
  sections: Map<string, Map<string, string>>;
  section: Map<string, string> | undefined;
  /** The option a more indented line continues, and the indent of its first line. */
  option: { key: string; indent: number } | undefined;
}

/**
 * Parses INI text the way `configparser` does for an import-linter file.
 *
 * @param text - the file's text.
 * @returns each section's options (keys lower-cased, lines of a value joined
 *   with `\n`), or an error message naming the line.
 */
export function parseIni(text: string): Map<string, Map<string, string>> | string {
  const cursor: IniCursor = { sections: new Map(), section: undefined, option: undefined };
  for (const [i, line] of text.replace(BOM, "").split(LINE_BREAK).entries()) {
    const problem = iniLine(cursor, line);
    if (problem !== undefined) {
      return `line ${i + 1}: ${problem}`;
    }
  }
  return cursor.sections;
}

/**
 * Reads one INI line: a comment, a blank or continuation line, a section
 * header or an option.
 *
 * @param cursor - the parser's position; changed in place.
 * @param line - the line, without its line break.
 * @returns undefined, or what is wrong with the line.
 */
function iniLine(cursor: IniCursor, line: string): string | undefined {
  const stripped = line.trim();
  if (stripped.startsWith("#") || stripped.startsWith(";")) {
    return undefined;
  }
  const indent = line.length - line.trimStart().length;
  const { section, option } = cursor;
  if (
    section !== undefined &&
    option !== undefined &&
    (stripped === "" || indent > option.indent)
  ) {
    section.set(option.key, `${section.get(option.key) ?? ""}\n${stripped}`);
    return undefined;
  }
  if (stripped === "") {
    return undefined;
  }
  const header = HEADER.exec(stripped)?.groups?.["name"];
  if (header !== undefined) {
    if (cursor.sections.has(header)) {
      return `section [${header}] appears twice.`;
    }
    cursor.section = new Map();
    cursor.sections.set(header, cursor.section);
    cursor.option = undefined;
    return undefined;
  }
  const match = OPTION.exec(stripped)?.groups;
  if (section === undefined || match === undefined) {
    return `expected a [section] or an option, found "${stripped}".`;
  }
  const key = (match["key"] ?? "").trim().toLowerCase();
  if (section.has(key)) {
    return `option "${key}" appears twice in its section.`;
  }
  section.set(key, (match["value"] ?? "").trim());
  cursor.option = { key, indent };
  return undefined;
}

/**
 * Reads import-linter's settings from INI text.
 *
 * @param text - a `.importlinter` or `setup.cfg`.
 * @returns the config, undefined when the file has no `[importlinter]` section, or an error message.
 */
export function readIni(text: string): LinterConfig | undefined | string {
  const sections = parseIni(text);
  if (typeof sections === "string") {
    return sections;
  }
  const session = sections.get(SECTION);
  if (session === undefined) {
    return undefined;
  }
  const contracts = [...sections]
    .filter(([name]) => name.startsWith(`${SECTION}:`))
    .map(([name, options]) => {
      const id = name.split(":").at(-1) ?? name;
      return contract(id, new Map([...options].map(([key, raw]) => [key, iniValue(raw)])));
    });
  return {
    rootPackages: rootPackages(new Map([...session].map(([k, v]) => [k, iniValue(v)]))),
    contracts,
  };
}

/**
 * Reads import-linter's settings from a parsed pyproject.toml.
 *
 * @param doc - the parsed document.
 * @returns the config, or undefined when there is no `[tool.importlinter]` table.
 */
export function readToml(doc: unknown): LinterConfig | undefined {
  const tool = isRecord(doc) ? doc["tool"] : undefined;
  const table = isRecord(tool) ? tool["importlinter"] : undefined;
  if (!isRecord(table)) {
    return undefined;
  }
  const raw = table["contracts"];
  const contracts = (Array.isArray(raw) ? raw : []).filter(isRecord).map((entry, i) => {
    const options = tomlOptions(entry);
    const id = options.get("id");
    options.delete("id");
    return contract(typeof id === "string" ? id : undefined, options, i);
  });
  return { rootPackages: rootPackages(tomlOptions(table)), contracts };
}

/**
 * Turns an INI value into import-linter's form: a list when it spans lines.
 *
 * @param raw - the value as parsed, lines joined with `\n`.
 * @returns the single line, or the lines.
 */
function iniValue(raw: string): OptionValue {
  const value = raw.trim();
  return value.includes("\n") ? value.split("\n") : value;
}

/**
 * Converts a TOML table's values to option values, as import-linter's reader does.
 *
 * @param table - a TOML table: `[tool.importlinter]` or one contract.
 * @returns strings, booleans as "True"/"False", arrays as their items; tables are dropped.
 */
function tomlOptions(table: Record<string, unknown>): Map<string, OptionValue> {
  const options = new Map<string, OptionValue>();
  for (const [key, value] of Object.entries(table)) {
    if (Array.isArray(value)) {
      options.set(key, value.map(String));
    } else if (typeof value === "boolean") {
      options.set(key, value ? "True" : "False");
    } else if (typeof value === "string" || typeof value === "number") {
      options.set(key, String(value));
    }
  }
  return options;
}

/**
 * Builds a contract from its options, taking `name` and `type` out.
 *
 * @param id - the section's or the TOML entry's id, if any.
 * @param options - every option of the contract; `name` and `type` are taken out.
 * @param index - its position, for a contract with neither id nor name.
 * @returns the contract with its name, type and remaining options.
 */
function contract(
  id: string | undefined,
  options: Map<string, OptionValue>,
  index = 0,
): LinterContract {
  const name = options.get("name");
  const type = options.get("type");
  options.delete("name");
  options.delete("type");
  return {
    id,
    name: typeof name === "string" ? name : (id ?? `contract ${index + 1}`),
    type: typeof type === "string" ? type : "",
    options,
  };
}

/**
 * Reads `root_package` or `root_packages`.
 *
 * @param options - the session options.
 * @returns the root packages, blank lines dropped.
 */
function rootPackages(options: ReadonlyMap<string, OptionValue>): string[] {
  return optionList(options, "root_packages") ?? optionList(options, "root_package") ?? [];
}

/**
 * Reads an option as a list of non-blank, trimmed lines, as import-linter's list fields do.
 *
 * @param options - a section's or table's options.
 * @param key - the lower-case option name, such as `source_modules`.
 * @returns the lines, or undefined when the option isn't set.
 */
export function optionList(
  options: ReadonlyMap<string, OptionValue>,
  key: string,
): string[] | undefined {
  const value = options.get(key);
  if (value === undefined) {
    return undefined;
  }
  const lines = typeof value === "string" ? [value] : value;
  return lines.map((line) => line.trim()).filter((line) => line !== "");
}
