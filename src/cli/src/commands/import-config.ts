/**
 * @file `inwards import-config [FILE] [--write]`: converts import-linter
 * contracts into a `[tool.inwards]` table. It finds the import-linter config
 * the way `lint-imports` does (`setup.cfg`, then `.importlinter`, then
 * `pyproject.toml` in the cwd) unless FILE names one, prints the table on
 * stdout and the per-contract report on stderr, or with `--write` appends the
 * table to the `pyproject.toml` beside that file.
 *
 * It never overwrites an existing `[tool.inwards]`, and checks that the table
 * parses before printing or writing it. The mapping itself lives in
 * `init/import-linter/`; this module only reads, picks the root and writes.
 */
import { basename, dirname, join, resolve } from "node:path";
import { ConfigError, declaresInwards, parseConfig } from "@inwards/core";
import { convert } from "../init/import-linter/convert.ts";
import { type LinterConfig, readIni, readToml } from "../init/import-linter/read.ts";
import { renderReport, renderToml } from "../init/import-linter/render.ts";
import { separator } from "../init/style.ts";
import { shown, sourceRoot } from "../init/target.ts";
import { print } from "../platform/print.ts";
import type { AppDeps } from "./deps.ts";

/** Where `lint-imports` looks, in its order: the INI files first. */
const CANDIDATES = ["setup.cfg", ".importlinter", "pyproject.toml"];

/** A converted table, ready to print or write. */
interface Converted {
  /** The `[tool.inwards]` TOML. */
  table: string;
  /** The per-contract report. */
  report: string;
  /** The pyproject.toml beside the import-linter config, and its text if it exists. */
  pyproject: { path: string; text: string | undefined };
}

/**
 * Runs `inwards import-config`.
 *
 * @param deps - the platform, init's TOML parser and file writer.
 * @param args - the positionals after the command: at most one, the import-linter config.
 * @param opts - the options that apply.
 * @param opts.write - `--write`: append the table to the pyproject.toml beside the config.
 * @param opts.config - `--config`, which this command refuses: FILE names its input.
 * @param usage - the usage text, printed for unexpected arguments.
 * @returns 0 once printed or written; 2 for bad arguments, without a usable
 *   import-linter config, or when pyproject.toml already has `[tool.inwards]`.
 * @throws when a file can't be read or written.
 */
export function importConfigCommand(
  deps: AppDeps,
  args: readonly string[],
  opts: { write?: boolean | undefined; config?: string | undefined },
  usage: string,
): number {
  const { io } = deps;
  if (args.length > 1 || opts.config !== undefined) {
    return print(io.streams, usage, 2);
  }
  const result = converted(deps, args[0]);
  if (typeof result === "string") {
    return print(io.streams, `inwards import-config: ${result}`, 2);
  }
  if (opts.write !== true) {
    io.streams.out(result.table);
    io.streams.err(`${result.report}\n`);
    return 0;
  }
  const problem = writeTable(deps, result);
  if (problem !== undefined) {
    return print(io.streams, `inwards import-config: ${problem}`, 2);
  }
  io.streams.err(`${result.report}\n`);
  const where = shown(io.runtime.cwd, result.pyproject.path);
  return print(io.streams, `inwards import-config: wrote [tool.inwards] to ${where}.`, 0);
}

/**
 * Finds, reads and converts the import-linter config, and checks the result parses.
 *
 * @param deps - probes and reads files, parses TOML, knows the cwd.
 * @param file - the file named on the command line, if any.
 * @returns the table and report, or why there are none.
 * @throws when a file can't be read.
 */
function converted(deps: AppDeps, file: string | undefined): Converted | string {
  const { io } = deps;
  const found = findLinterConfig(deps, file);
  if (typeof found === "string") {
    return found;
  }
  const conversion = convert(found.config);
  if (typeof conversion === "string") {
    return conversion;
  }
  const project = dirname(found.path);
  const path = join(project, "pyproject.toml");
  const text = io.probe.kind(path) === "file" ? io.read.text(path) : undefined;
  const first = found.config.rootPackages[0] ?? conversion.draft.layers[0]?.[0]?.modules[0] ?? "";
  const root = sourceRoot({ ...io, toml: deps.init.toml }, project, first, text ?? "");
  const table = renderToml(conversion.draft, { source: basename(found.path), root });
  const check = parsed(table);
  if (check instanceof ConfigError) {
    return `the converted table doesn't parse (${check.message}); please report this with your import-linter config.`;
  }
  const report = renderReport(conversion.outcomes, shown(io.runtime.cwd, found.path));
  return { table, report, pyproject: { path, text } };
}

/**
 * Appends the table to pyproject.toml, one blank line after the rest, in the
 * file's own line endings. Refuses when there is no pyproject.toml, when it
 * already configures Inwards, or when the result wouldn't read back as the table.
 *
 * @param deps - the platform and init's file writer.
 * @param result - the table and the pyproject.toml to add it to.
 * @returns undefined once written, or why it wasn't.
 * @throws when the file can't be written.
 */
function writeTable(deps: AppDeps, result: Converted): string | undefined {
  const { path, text } = result.pyproject;
  const where = shown(deps.io.runtime.cwd, path);
  if (text === undefined) {
    return `there is no ${where} to write to; run without --write and save the table yourself.`;
  }
  if (declaresInwards(text)) {
    return `${where} already has [tool.inwards], and import-config never overwrites it. Run without --write and merge the table by hand.`;
  }
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const after = `${text}${separator(text, eol)}${result.table.replaceAll("\n", eol)}`;
  if (JSON.stringify(parsed(after)) !== JSON.stringify(parsed(result.table))) {
    return `could not add [tool.inwards] to ${where} safely; add this table by hand:\n${result.table}`;
  }
  deps.init.files.write(path, after);
  return undefined;
}

/**
 * Finds and reads the import-linter config.
 *
 * @param deps - probes and reads files, parses TOML, knows the cwd.
 * @param file - the file named on the command line, if any.
 * @returns the file and its config, or why there is none.
 * @throws when a file can't be read.
 */
function findLinterConfig(
  deps: AppDeps,
  file: string | undefined,
): { path: string; config: LinterConfig } | string {
  const { io } = deps;
  const paths =
    file === undefined
      ? CANDIDATES.map((name) => join(io.runtime.cwd, name))
      : [resolve(io.runtime.cwd, file)];
  for (const path of paths) {
    if (io.probe.kind(path) !== "file") {
      continue;
    }
    const text = io.read.text(path);
    const config = path.endsWith(".toml") ? readToml(deps.init.toml(text)) : readIni(text);
    if (typeof config === "string") {
      return `${shown(io.runtime.cwd, path)}: ${config}`;
    }
    if (config !== undefined) {
      return { path, config };
    }
  }
  return file === undefined
    ? `no import-linter config in ${CANDIDATES.join(", ")} here.`
    : `${file}: no such file, or no [importlinter] or [tool.importlinter] section in it.`;
}

/**
 * Parses a config, keeping the parts the conversion writes, so two texts can be compared.
 *
 * @param text - TOML holding `[tool.inwards]`.
 * @returns the parsed root, layers, contexts and ignores, or the config error.
 * @throws when parsing fails with anything but a ConfigError.
 */
function parsed(text: string): object | ConfigError {
  try {
    const { layers, contexts, ignore, root } = parseConfig(text);
    return { layers, contexts, ignore, root };
  } catch (err) {
    if (err instanceof ConfigError) {
      return err;
    }
    throw err;
  }
}
