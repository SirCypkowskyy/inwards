/**
 * @file Reading the files `[tool.inwards].diagrams` names, for INW017,
 * INW018 and INW019 (ADR-045): a plain entry is one file relative to the config, a glob is
 * walked from its directory before the first wildcard with the CLI's usual
 * skip rules. An entry may climb out of the config's directory with leading
 * `..`, as far as the project root (#413): the git repository or the uv
 * workspace around the config, whichever is outermost (`diagramsRoot`). A
 * check of named files (the PostToolUse hook, the language
 * server, MCP `check_files`, #348) asks `listsDiagram` whether one of them is
 * a listed diagram, which is path text only. The engine decides what the
 * diagrams say (`checkDiagrams`); this module only finds and reads them,
 * through the injected `ProjectIo`, and only when one of the rules is on, so
 * a project that doesn't use diagrams pays nothing.
 */
import { dirname, isAbsolute, join, relative } from "node:path";
import {
  checkDiagrams,
  checkDiagramsRoot,
  type Diagnostic,
  type DiagramSource,
  type DiagramsRoot,
  declaresInwards,
  diagramBase,
  diagramMatches,
  type InwardsConfig,
  parseConfig,
  ruleLevel,
} from "@inwards/core";
import { posix } from "../shared/paths/lexical.ts";
import type { PathProbe } from "../shared/platform/contracts.ts";
import { workspaceMembers, workspaceRoot } from "./_workspace.ts";
import type { ProjectIo } from "./contracts.ts";

/** The rules that read diagrams. */
const DIAGRAM_RULES = ["INW017", "INW018", "INW019"];

/**
 * The file names a diagram usually has: Markdown, Mermaid and PlantUML. The
 * editor and `check_files`' in-memory contents take these; a listed diagram
 * with another name is still checked from disk.
 */
export const DIAGRAM_FILE: RegExp = /\.(?:md|markdown|mmd|mermaid|puml|plantuml|pu|iuml)$/iu;

/**
 * Tells whether a config turns on a rule that reads diagrams.
 *
 * @param config - the parsed config.
 * @returns true when it lists diagrams and INW017, INW018 or INW019 is on.
 */
function diagramsOn(config: InwardsConfig): boolean {
  return (
    (config.diagrams ?? []).length > 0 &&
    DIAGRAM_RULES.some((code) => ruleLevel(code, config.rules) !== "off")
  );
}

/**
 * Finds the project root a config's `diagrams` may climb to with `..`
 * (#413): the top of the git repository (`git rev-parse --show-toplevel`,
 * as `inwards stats` finds it) or the uv workspace root (as `inwards check`
 * finds a member's workspace), whichever sits higher above the config. The
 * config's directory is walked up as written, and git's answer, which has
 * symlinks resolved, is matched against each ancestor's real path, so the
 * count of `..` is the one the lexical path takes.
 *
 * @param io - runs git, probes real paths and reads the pyproject.toml files on the way up.
 * @param configDir - absolute directory of the config's pyproject.toml.
 * @returns how far up the root is and how a config error names it; undefined
 *   outside both a git repository and a uv workspace.
 */
function diagramsRoot(
  io: Pick<ProjectIo, "git" | "probe" | "read" | "toml">,
  configDir: string,
): DiagramsRoot | undefined {
  const top = io.git.run(configDir, ["rev-parse", "--show-toplevel"])?.trim();
  const gitRoot = top ? io.probe.realpath(top) : undefined;
  let workspace: string | undefined;
  try {
    workspace = workspaceRoot(io, configDir)?.dir;
  } catch {
    // A pyproject.toml on the way that can't be read names no workspace.
  }
  let found: DiagramsRoot | undefined;
  for (let dir = configDir, up = 0; ; dir = dirname(dir), up += 1) {
    const climb = up === 0 ? "." : Array.from({ length: up }, () => "..").join("/");
    if (gitRoot !== undefined && io.probe.realpath(dir) === gitRoot) {
      found = { up, name: `the git repository root ("${climb}")` };
    } else if (dir === workspace) {
      found = { up, name: `the uv workspace root ("${climb}")` };
    }
    if (dirname(dir) === dir) {
      return found;
    }
  }
}

/**
 * Checks that a config's `diagrams` stay inside the project root
 * (`diagramsRoot`), which is looked for only when an entry climbs with `..`.
 *
 * @param io - runs git, probes real paths and reads the pyproject.toml files on the way up.
 * @param configPath - absolute path of the pyproject.toml.
 * @param config - its parsed config.
 * @throws {ConfigError} naming the first entry that leaves the root.
 */
export function checkDiagramPaths(
  io: Pick<ProjectIo, "git" | "probe" | "read" | "toml">,
  configPath: string,
  config: InwardsConfig,
): void {
  checkDiagramsRoot(config.diagrams, () => diagramsRoot(io, dirname(configPath)));
}

/**
 * Tells whether a file is one the config's `diagrams` key lists, with a
 * diagram rule on, by path text alone: nothing is read. The path is taken
 * as written, as the whole-project walk takes it; an entry that climbs with
 * `..` matches a file outside the config's directory.
 *
 * @param configPath - absolute path of the pyproject.toml; entries are relative to its directory.
 * @param config - its parsed config.
 * @param file - an absolute file path.
 * @returns true when the diagram rules should check the file.
 */
export function listsDiagram(configPath: string, config: InwardsConfig, file: string): boolean {
  const dir = dirname(configPath);
  const native = relative(dir, file);
  // On Windows a file on another drive gives an absolute path, which no entry names.
  if (!diagramsOn(config) || native === "" || isAbsolute(native)) {
    return false;
  }
  const rel = posix(native);
  return (config.diagrams ?? []).some((entry) => diagramMatches(entry, rel));
}

/**
 * Finds the configs of a uv workspace's members that list a file as a
 * diagram (`configListsDiagram`), for a check of one file whose nearest
 * config isn't the one that lists it: a repository-level page that a
 * member reaches with `..` (#413). Outside a workspace, or when the
 * workspace can't be read, there are none.
 *
 * @param io - probes, reads and parses the pyproject.toml files.
 * @param file - an absolute file path.
 * @returns absolute paths of the members' pyproject.toml files that list it, in path order.
 */
export function workspaceListers(
  io: Pick<ProjectIo, "probe" | "read" | "toml">,
  file: string,
): string[] {
  try {
    return (workspaceMembers(io, dirname(file))?.members ?? [])
      .map((member) => join(member, "pyproject.toml"))
      .filter(
        (config) =>
          io.probe.kind(config) === "file" &&
          declaresInwards(io.read.text(config)) &&
          configListsDiagram(io, config, file),
      );
  } catch {
    return [];
  }
}

/**
 * Tells whether a config file lists a file as a diagram, with a diagram rule
 * on (`listsDiagram`), for a caller that has only the config's path: the
 * PostToolUse hook and the language server, before they check a file that
 * isn't Python. A config that can't be read or parsed answers no; a check of
 * a Python file, or a whole-project run, reports it, and a Markdown edit
 * shouldn't.
 *
 * @param io - reads the config.
 * @param configPath - absolute path of the pyproject.toml the file falls under.
 * @param file - an absolute file path.
 * @returns true when the diagram rules should check the file.
 */
export function configListsDiagram(
  io: Pick<ProjectIo, "read">,
  configPath: string,
  file: string,
): boolean {
  try {
    return listsDiagram(configPath, parseConfig(io.read.text(configPath)), file);
  } catch {
    return false;
  }
}

/**
 * Reads the named files that are listed diagrams, for a check of named
 * paths, each from the given text when there is one.
 *
 * @param io - reads the files.
 * @param files - the listed diagram files, absolute.
 * @param base - directory that report paths are made relative to.
 * @param texts - content to read instead of what is on disk, by absolute path.
 * @returns each file with its report path.
 * @throws when a file without a given text can't be read.
 */
function readNamedDiagrams(
  io: Pick<ProjectIo, "read">,
  files: readonly string[],
  base: string,
  texts: ReadonlyMap<string, string> | undefined,
): DiagramSource[] {
  return files.map((abs) => ({
    path: posix(relative(base, abs)),
    text: texts?.get(abs) ?? io.read.text(abs),
  }));
}

/** The diagram files a config names, and the entries that named none. */
export interface ListedDiagrams {
  sources: DiagramSource[];
  unmatched: string[];
}

/**
 * Finds and reads the diagram files a config lists. Nothing is read when the
 * config lists none or INW017, INW018 and INW019 are all off.
 *
 * @param io - probes, walks and reads the project.
 * @param configPath - absolute path of the pyproject.toml; entries are relative to its directory.
 * @param config - its parsed config.
 * @param where - where report paths start, and the texts to read instead of the disk's.
 * @param where.base - directory that report paths are made relative to.
 * @param where.texts - content to read instead of what is on disk, by absolute
 *   path: the language server's unsaved documents.
 * @returns each matched file once, in path order, with its report path, and
 *   the entries that matched no file.
 * @throws when a matched file can't be read.
 */
export function readDiagrams(
  io: Pick<ProjectIo, "probe" | "walk" | "read">,
  configPath: string,
  config: InwardsConfig,
  { base, texts }: { base: string; texts?: ReadonlyMap<string, string> | undefined },
): ListedDiagrams {
  const entries = config.diagrams ?? [];
  if (!diagramsOn(config)) {
    return { sources: [], unmatched: [] };
  }
  const dir = dirname(configPath);
  const found = new Set<string>();
  const unmatched: string[] = [];
  for (const entry of entries) {
    const files = filesFor(io, dir, entry);
    if (files.length === 0) {
      unmatched.push(entry);
    }
    for (const file of files) {
      found.add(file);
    }
  }
  return { sources: readNamedDiagrams(io, [...found].sort(), base, texts), unmatched };
}

/**
 * Lists the files one entry names.
 *
 * @param io - probes and walks the project.
 * @param dir - the config file's directory.
 * @param entry - a `diagrams` entry.
 * @returns the absolute paths of the files it matches.
 */
function filesFor(io: Pick<ProjectIo, "probe" | "walk">, dir: string, entry: string): string[] {
  const start = diagramBase(entry);
  if (start === undefined) {
    const abs = join(dir, entry);
    return io.probe.kind(abs) === "file" ? [abs] : [];
  }
  const root = join(dir, start);
  if (io.probe.kind(root) !== "dir") {
    return [];
  }
  return io.walk
    .files([root], () => true)
    .filter((abs) => diagramMatches(entry, posix(relative(dir, abs))));
}

/** The config a check of named diagrams reads. */
interface DiagramConfig {
  /** Absolute path of the pyproject.toml. */
  configPath: string;
  /** Its text, for findings about an entry. */
  configText: string;
  config: InwardsConfig;
}

/**
 * Sorts the named targets of a check (#348): a file the config lists as a
 * diagram is checked by INW017 and INW018, as a whole-project run would (the
 * PostToolUse hook, the language server and `check_files` name one); a file
 * named like a diagram (`DIAGRAM_FILE`) that isn't listed is never read as
 * Python, and the check's `notChecked` says why; everything else is walked
 * for Python as before, a named file whatever its extension.
 *
 * @param probe - tells files apart.
 * @param project - the config the targets are checked with.
 * @param targets - the named paths, absolute; undefined for a whole-project run.
 * @returns the listed diagram files, in the order named, and the targets to
 *   walk for Python (undefined for a whole-project run).
 */
export function splitTargets(
  probe: Pick<PathProbe, "kind">,
  project: Pick<DiagramConfig, "configPath" | "config">,
  targets: readonly string[] | undefined,
): { diagrams: string[]; python: string[] | undefined } {
  if (targets === undefined) {
    return { diagrams: [], python: undefined };
  }
  const files = targets.filter((target) => probe.kind(target) === "file");
  const diagrams = files.filter((file) => listsDiagram(project.configPath, project.config, file));
  const skipped = new Set([...diagrams, ...files.filter((file) => DIAGRAM_FILE.test(file))]);
  return { diagrams, python: targets.filter((target) => !skipped.has(target)) };
}

/**
 * Checks named diagram files against the config and the project's modules
 * (INW017, INW018). The modules are asked for only when a diagram was named,
 * so a check of Python files lists nothing more. A `diagrams` entry that
 * matches no file is a whole-project finding, on pyproject.toml, and isn't
 * repeated here.
 *
 * @param io - reads the diagram files.
 * @param project - the config and its text.
 * @param index - lists every first-party module (the check's index, from its listing).
 * @param index.modules - asked once, and only when there is a diagram to check.
 * @param named - the diagrams and how to show them.
 * @param named.files - the listed diagram files, absolute.
 * @param named.base - directory that report paths are made relative to.
 * @param named.texts - content to read instead of what is on disk, by absolute path.
 * @returns the findings in those files.
 * @throws when a diagram without a given text can't be read.
 */
export function checkNamedDiagrams(
  io: Pick<ProjectIo, "read">,
  project: DiagramConfig,
  index: { modules: () => ReadonlySet<string> },
  {
    files,
    base,
    texts,
  }: { files: readonly string[]; base: string; texts: ReadonlyMap<string, string> | undefined },
): Diagnostic[] {
  if (files.length === 0) {
    return [];
  }
  return checkDiagrams(project.config, {
    modules: index.modules(),
    sources: readNamedDiagrams(io, files, base, texts),
    unmatched: [],
    configFile: { path: posix(relative(base, project.configPath)), text: project.configText },
  });
}
