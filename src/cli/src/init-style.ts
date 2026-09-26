/**
 * `inwards init` for a project with no `[tool.inwards]` yet: `--style` writes
 * a preset's table, `--scaffold` an example package that passes the check,
 * and without flags on a terminal a picker asks for both. Everything is
 * computed and checked before the first write, so a conflict leaves the
 * project as it was.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import process from "node:process";
import { inwardsTable, parseConfig, VERSION } from "@inwards/core";
import {
  AGENTS,
  type Agent,
  agentChanges,
  apply,
  type Change,
  DEFAULT_IGNORE,
  initCommand,
  isAgent,
  isRecord,
  PRERELEASE,
} from "./init.ts";
import { isDir, report } from "./init-report.ts";
import { print } from "./output.ts";
import { posix } from "./paths.ts";
import { pick } from "./picker.ts";
import {
  configTable,
  describeStyles,
  isStyle,
  STYLE_NAMES,
  STYLES,
  type Style,
  type StyleName,
  scaffoldFiles,
} from "./styles.ts";

/** The `init` options main.ts parsed. */
export interface InitFlags {
  agent?: string | undefined;
  style?: string | undefined;
  scaffold?: boolean | undefined;
  package?: string | undefined;
  "list-styles"?: boolean | undefined;
  "dry-run"?: boolean | undefined;
}

/** What to do, once flags or the picker have decided. */
export interface InitPlan {
  style: StyleName | undefined;
  scaffold: boolean;
  agent: Agent | undefined;
}

/** A pyproject.toml found from the cwd, and what init needs to know about it. */
export interface Target {
  path: string;
  text: string;
  /** True when it already has `[tool.inwards]`. */
  configured: boolean;
  /** The import package: `--package`, or `[project].name` normalised; undefined when neither is set. */
  pkg: string | undefined;
}

const PACKAGE_NAME = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/u;
const NAME_SEPARATORS = /[-_.]+/gu;
const HOW = `  inwards init --style ${STYLE_NAMES.join("|")} [--scaffold] [--package NAME] [--agent ${AGENTS.join("|")}] [--dry-run]
  inwards init --agent ${AGENTS.join("|")} [--dry-run]    (the project already has [tool.inwards])
  inwards init --list-styles`;

/**
 * Runs `inwards init` with whatever flags were given: `--list-styles`, the
 * picker (no `--style` and no `--agent`, on a terminal), `--style` with or
 * without `--agent`, or `--agent` alone exactly as before.
 *
 * @param paths - positionals after `init`; there must be none.
 * @param flags - the parsed options.
 * @param usage - the CLI's usage text, for a bad `--agent`.
 * @returns the exit code: 0 done, 2 for a usage error or something init won't overwrite.
 */
export async function initMain(paths: string[], flags: InitFlags, usage: string): Promise<number> {
  const dryRun = flags["dry-run"] === true;
  if (paths.length > 0) {
    return print(usage, 2);
  }
  if (flags["list-styles"] === true) {
    return print(describeStyles(flags.package ?? "<package>"), 0);
  }
  if (flags.agent !== undefined && !isAgent(flags.agent)) {
    return print(`${usage}\n\n--agent must be one of: ${AGENTS.join(", ")}`, 2);
  }
  if (flags.style !== undefined && !isStyle(flags.style)) {
    return print(`inwards init: --style must be one of: ${STYLE_NAMES.join(", ")}`, 2);
  }
  const { agent, style } = flags;
  if (style === undefined && agent !== undefined) {
    return flags.scaffold === true || flags.package !== undefined
      ? print("inwards init: --scaffold and --package need --style.", 2)
      : initCommand(agent, dryRun);
  }
  if (style !== undefined) {
    return await styleCommand({ style, scaffold: flags.scaffold === true, agent }, flags, dryRun);
  }
  return await interactive(flags, dryRun);
}

/**
 * Asks for the style, the scaffold and the agent on a terminal. Without one
 * (stdin or stdout not a TTY, or `CI` set) it never waits for input: it exits
 * 2 at once with the flags and the styles. The prompt library is imported
 * only here, so no other command pays for loading it.
 *
 * @param flags - the parsed options (`--scaffold`, `--package`).
 * @param dryRun - `--dry-run`.
 * @returns the exit code of the chosen init, or 2.
 */
async function interactive(flags: InitFlags, dryRun: boolean): Promise<number> {
  const terminal =
    process.stdin.isTTY === true && process.stdout.isTTY === true && !process.env["CI"];
  if (!terminal) {
    return print(
      `inwards init: choose what to set up; there is no terminal to ask in.\n${HOW}\n\n${describeStyles(flags.package ?? "<package>")}`,
      2,
    );
  }
  const target = findTarget(flags.package);
  if (typeof target === "string") {
    return print(`inwards init: ${target}`, 2);
  }
  if (!target.configured && target.pkg === undefined) {
    return print(noPackage(target.path), 2);
  }
  const plan = await pick(target, flags);
  if (plan === undefined) {
    return 2;
  }
  if (plan.style === undefined) {
    return plan.agent === undefined ? 0 : initCommand(plan.agent, dryRun);
  }
  return await styleCommand({ ...plan, style: plan.style }, flags, dryRun);
}

/**
 * Finds the nearest pyproject.toml above the cwd and reads what init needs.
 *
 * @param pkgFlag - `--package`, if given.
 * @returns the target, or an error message.
 */
function findTarget(pkgFlag: string | undefined): Target | string {
  let dir = process.cwd();
  while (!existsSync(join(dir, "pyproject.toml"))) {
    if (dirname(dir) === dir) {
      return "no pyproject.toml here or above. Create the project first, e.g. `uv init --package app`.";
    }
    dir = dirname(dir);
  }
  const path = join(dir, "pyproject.toml");
  const text = readFileSync(path, "utf8");
  const table = inwardsTable(text);
  if (table === null) {
    return `${path} is not valid TOML; fix it first.`;
  }
  if (pkgFlag !== undefined && !PACKAGE_NAME.test(pkgFlag)) {
    return `--package ${pkgFlag} is not a Python package name.`;
  }
  return { path, text, configured: table !== undefined, pkg: pkgFlag ?? projectPackage(text) };
}

/**
 * Reads `[project].name` and turns it into the import package the way uv
 * does: lowercase, with runs of `-`, `_` and `.` made one `_`.
 *
 * @param text - the pyproject.toml text.
 * @returns the package, or undefined when there is no usable name.
 */
function projectPackage(text: string): string | undefined {
  let doc: unknown;
  try {
    doc = Bun.TOML.parse(text);
  } catch {
    return undefined;
  }
  const project = isRecord(doc) ? doc["project"] : undefined;
  const name = isRecord(project) ? project["name"] : undefined;
  if (typeof name !== "string") {
    return undefined;
  }
  const pkg = name.toLowerCase().replace(NAME_SEPARATORS, "_");
  return PACKAGE_NAME.test(pkg) ? pkg : undefined;
}

/**
 * Writes a preset's `[tool.inwards]`, the example with `--scaffold`, and an
 * agent's wiring with `--agent`, then prints the annotated tree and the
 * result of a check. Refuses (exit 2, nothing written) when the table exists
 * or a file it would create is already there.
 *
 * @param plan - the style, whether to scaffold, and the agent.
 * @param plan.style - the preset.
 * @param flags - `--package`.
 * @param dryRun - print every change as a diff instead of writing.
 * @returns 0 once written (or printed), 2 when init would overwrite something.
 */
async function styleCommand(
  plan: InitPlan & { style: StyleName },
  flags: InitFlags,
  dryRun: boolean,
): Promise<number> {
  const target = findTarget(flags.package);
  if (typeof target === "string") {
    return print(`inwards init: ${target}`, 2);
  }
  if (target.configured) {
    return print(
      `inwards init: ${shown(target.path)} already has [tool.inwards]; --style never rewrites layers. To wire an agent, run \`inwards init --agent ${AGENTS.join("|")}\`.`,
      2,
    );
  }
  if (target.pkg === undefined) {
    return print(noPackage(target.path), 2);
  }
  const style = STYLES[plan.style];
  const project = dirname(target.path);
  const root = sourceRoot(project, target.pkg);
  const config = withTable(target, style, target.pkg, root);
  if (typeof config === "string") {
    return print(`inwards init: ${config}`, 2);
  }
  const files = plan.scaffold ? newFiles(project, style, target.pkg, root) : [];
  const conflicts = files.filter((c) => c.before !== undefined).map((c) => shown(c.path));
  if (conflicts.length > 0) {
    return print(
      `inwards init: --scaffold never overwrites a file, and these exist:\n  ${conflicts.join("\n  ")}\nNothing was written.`,
      2,
    );
  }
  const wiring = plan.agent === undefined ? [] : agentChanges(plan.agent, project);
  if (typeof wiring === "string") {
    return print(`inwards init: ${wiring}`, 2);
  }
  const agentEdits = wiring.filter((c) => c.before !== c.after);
  if (dryRun) {
    return apply([config, ...files, ...agentEdits], true);
  }
  for (const change of [config, ...files]) {
    mkdirSync(dirname(change.path), { recursive: true });
    writeFileSync(change.path, change.after);
  }
  const example = files.length > 0 ? ` and ${files.length} example files` : "";
  print(`inwards init: wrote the ${style.name} preset to ${shown(target.path)}${example}.`, 0);
  if (agentEdits.length > 0) {
    apply(agentEdits, false);
  }
  return await report({ configPath: target.path, style, pkg: target.pkg, root }, plan);
}

/**
 * Says that init can't tell the import package.
 *
 * @param path - the pyproject.toml.
 * @returns the message.
 */
function noPackage(path: string): string {
  return `inwards init: ${shown(path)} has no usable [project].name; name the import package with --package.`;
}

/**
 * Shows a path relative to the cwd, with forward slashes, as the rest of the output does.
 *
 * @param path - an absolute path.
 * @returns the relative path, e.g. `pyproject.toml` or `../pyproject.toml`.
 */
function shown(path: string): string {
  return posix(relative(process.cwd(), path));
}

/**
 * Picks the config root: `src` for a src layout, `.` otherwise.
 *
 * @param project - the project directory.
 * @param pkg - the import package.
 * @returns `src` when the package (or, before it exists, a `src` directory) is there, else `.`.
 */
function sourceRoot(project: string, pkg: string): string {
  const rel = pkg.replaceAll(".", "/");
  if (isDir(join(project, "src", rel))) {
    return "src";
  }
  return !isDir(join(project, rel)) && isDir(join(project, "src")) ? "src" : ".";
}

/**
 * Appends the preset's table to pyproject.toml, one blank line after the
 * rest, in the file's own line endings. The result must parse to exactly the
 * preset's layers; otherwise (a `tool` inline table, say) init stops.
 *
 * @param target - the pyproject.toml.
 * @param style - the preset.
 * @param pkg - the import package.
 * @param root - the config root.
 * @returns the change, or an error message.
 */
function withTable(target: Target, style: Style, pkg: string, root: string): Change | string {
  const { path, text } = target;
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const version = VERSION.replace(PRERELEASE, "");
  const table = configTable(style, { pkg, root, version, ignore: DEFAULT_IGNORE, eol });
  const after = `${text}${separator(text, eol)}${table}`;
  const want = style.layers.map((layer) => `${layer.name}=${pkg}.${layer.module}`).join(" ");
  let got = "";
  try {
    got = parseConfig(after)
      .layers.map((layer) => `${layer.name}=${layer.modules.join(",")}`)
      .join(" ");
  } catch {
    // Reported below: the table didn't land where TOML reads it.
  }
  return got === want
    ? { path, before: text, after }
    : `could not add [tool.inwards] to ${path} safely; add this table by hand:\n${table}`;
}

/**
 * Picks what goes between the end of pyproject.toml and the new table: one blank line.
 *
 * @param text - the file's text.
 * @param eol - its line ending.
 * @returns "", one line ending or two.
 */
function separator(text: string, eol: string): string {
  if (text === "" || text.endsWith(`${eol}${eol}`)) {
    return "";
  }
  return text.endsWith(eol) ? eol : `${eol}${eol}`;
}

/**
 * Lists the scaffold's files as changes. An `__init__.py` that already
 * exists is left out, so a package uv created stays as it is; any other
 * existing file is kept as a conflict (its `before` is set).
 *
 * @param project - the project directory.
 * @param style - the preset.
 * @param pkg - the import package.
 * @param root - the config root.
 * @returns one change per file to create, conflicts included.
 */
function newFiles(project: string, style: Style, pkg: string, root: string): Change[] {
  return [...scaffoldFiles(style, pkg, root)].flatMap(([rel, after]): Change[] => {
    const path = join(project, ...rel.split("/"));
    if (!existsSync(path)) {
      return [{ path, before: undefined, after }];
    }
    return rel.endsWith("/__init__.py")
      ? []
      : [{ path, before: readFileSync(path, "utf8"), after }];
  });
}
