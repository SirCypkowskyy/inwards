/**
 * @file The `where_should_this_go` tool: which layer new code belongs in, and
 * what it may import there, from the project's `[tool.inwards]`. Imports are
 * judged by the check itself rather than a second reading of the config: a
 * probe module holding only those imports is checked, in memory, at the
 * module the agent named and at a new module in each layer, so the layers,
 * contexts, library rules and module index all have their say (INW001,
 * INW002, INW003, INW005, INW010). The suggestion is the module the agent
 * named when its imports pass; else the innermost layer where they all pass,
 * or the layer the description points to; with neither, the description
 * alone. Nothing is written; the check and the config reads are injected.
 */
import { dirname, join, relative, resolve } from "node:path";
import {
  ConfigError,
  contextOf,
  type Diagnostic,
  type InwardsConfig,
  layerIndexOf,
  parseConfig,
} from "@inwards/core";
import { posix } from "../paths/lexical.ts";
import { findConfig } from "../project/config-discovery.ts";
import type { ProjectIo } from "../project/contracts.ts";
import { absoluteFrom, failure } from "./answers.ts";
import type { McpCheck, ToolAnswer, WhereInput } from "./contracts.ts";
import { hintOf, leafOf } from "./hints.ts";
import {
  type Blocked,
  type Candidate,
  contextView,
  layerViews,
  type Named,
  prose,
  suggest,
} from "./where-answer.ts";

/** What the tool reads: the check, the working directory, and the config files. */
export interface WhereDeps {
  /** Runs `inwards check` with texts laid over the disk. */
  check: McpCheck;
  /** The server's working directory. */
  cwd: string;
  /** Finds and reads the config. */
  io: Pick<ProjectIo, "probe" | "read">;
}

/** A dotted Python name: identifiers joined by dots. */
const DOTTED = /^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$/u;
/** A name's last part that names a class or a constant rather than a module. */
const CAPITALISED = /^[A-Z]/u;

/** What a run of the tool knows about the project. */
interface Project {
  deps: WhereDeps;
  config: InwardsConfig;
  /** The pyproject.toml, absolute. */
  configPath: string;
  /** The config root, absolute. */
  root: string;
}

/**
 * Writes the import statement a probe module holds for one import. A name
 * whose last part starts with a capital (`shop.domain.order.Order`) is a
 * class or a constant in a module: `from shop.domain.order import Order`, so
 * INW010 asks only for the module, as for the real import. Anything else is
 * a module (`import shop.domain.pricing`), so INW010 reports it when it
 * doesn't exist.
 *
 * @param name - a dotted name.
 * @returns one line of Python, `import ...` or `from ... import ...`.
 */
function statementOf(name: string): string {
  const dot = name.lastIndexOf(".");
  const last = name.slice(dot + 1);
  return dot < 0 || !CAPITALISED.test(last)
    ? `import ${name}`
    : `from ${name.slice(0, dot)} import ${last}`;
}

/**
 * Finds the file a module would be in: its package's `__init__.py` when the
 * package exists, else `<module>.py`.
 *
 * @param project - the config root and the probe.
 * @param module - a dotted module name.
 * @returns the absolute file.
 */
function fileOf(project: Project, module: string): string {
  const base = join(project.root, ...module.split("."));
  return project.deps.io.probe.kind(base) === "dir" ? join(base, "__init__.py") : `${base}.py`;
}

/**
 * Checks a probe module that holds only the imports, at one file, and keeps
 * what the check refused about those imports.
 *
 * @param project - the check and the working directory.
 * @param file - the probe's absolute file.
 * @param imports - the dotted names to import.
 * @returns the refused imports, in the order given.
 * @throws {ConfigError} when the config or its baseline is invalid.
 */
async function probe(
  project: Project,
  file: string,
  imports: readonly string[],
): Promise<Blocked[]> {
  if (imports.length === 0) {
    return [];
  }
  const { check, cwd } = project.deps;
  const text = `${imports.map(statementOf).join("\n")}\n`;
  const { report } = await check([file], new Map([[file, text]]));
  return report.diagnostics
    .filter((d: Diagnostic) => resolve(cwd, d.file) === file && d.line <= imports.length)
    .map((d) => ({ import: imports[d.line - 1] ?? "", code: d.code, message: d.message }));
}

/**
 * Builds the candidates: a new module in each layer's first literal prefix,
 * named after the module or the description, with what the check said
 * about the imports there. A layer with only selectors (`shop.*.domain`)
 * names no one package, so it gets none.
 *
 * @param project - the config and the check.
 * @param leaf - the new module's last name.
 * @param imports - the dotted names to import.
 * @returns one candidate per layer with a literal prefix, innermost first.
 * @throws {ConfigError} when the config or its baseline is invalid.
 */
async function candidatesOf(
  project: Project,
  leaf: string,
  imports: readonly string[],
): Promise<Candidate[]> {
  const candidates: Candidate[] = [];
  for (const layer of project.config.layers) {
    const prefix = layer.modules.find((m) => !m.includes("*"));
    if (prefix === undefined) {
      continue;
    }
    const module = `${prefix}.${leaf}`;
    const file = fileOf(project, module);
    // biome-ignore lint/performance/noAwaitInLoops: one check at a time, as the server runs them all.
    const blocked = await probe(project, file, imports);
    candidates.push({ layer: layer.name, module, file: shown(project, file), blocked });
  }
  return candidates;
}

/**
 * Spells a file for the answer, relative to the working directory.
 *
 * @param project - the working directory.
 * @param file - an absolute file.
 * @returns the path with forward slashes.
 */
function shown(project: Project, file: string): string {
  return posix(relative(project.deps.cwd, file));
}

/**
 * Judges the module the agent named: its layer and context, and its imports there.
 *
 * @param project - the config and the check.
 * @param module - the dotted module.
 * @param imports - the dotted names to import.
 * @returns what the answer says about it.
 * @throws {ConfigError} when the config or its baseline is invalid.
 */
async function judgeNamed(
  project: Project,
  module: string,
  imports: readonly string[],
): Promise<Named> {
  const { layers, contexts } = project.config;
  const file = fileOf(project, module);
  return {
    module,
    file: shown(project, file),
    layer: layers[layerIndexOf(module, layers)]?.name,
    context: contextOf(module, contexts ?? [])?.name,
    blocked: await probe(project, file, imports),
  };
}

/**
 * Checks the arguments' names: the module and every import must be dotted Python names.
 *
 * @param input - the tool's arguments.
 * @returns an error message, or undefined when they are all right.
 */
function problemOf(input: WhereInput): string | undefined {
  const bad = [
    ...(input.module === undefined ? [] : [input.module]),
    ...(input.imports ?? []),
  ].find((name) => !DOTTED.test(name));
  return bad === undefined
    ? undefined
    : `"${bad}" is not a dotted Python name: write modules and imports as \`shop.domain.order\` or \`sqlalchemy\`.`;
}

/**
 * Loads the config that covers a path.
 *
 * @param deps - the config reads and the working directory.
 * @param path - the tool's `path`, if any.
 * @returns the project, or an error message.
 * @throws {ConfigError} when the config is invalid.
 * @throws when a pyproject.toml on the way can't be read.
 */
function projectOf(deps: WhereDeps, path: string | undefined): Project | string {
  const at = absoluteFrom(deps.cwd, path ?? ".");
  const dir = deps.io.probe.kind(at) === "dir" ? at : dirname(at);
  const configPath = findConfig(deps.io, dir);
  if (configPath === undefined) {
    return `No pyproject.toml with [tool.inwards] at or above ${posix(relative(deps.cwd, dir)) || "."}: run \`inwards init\` first, or pass a path inside the project.`;
  }
  const config = parseConfig(deps.io.read.text(configPath));
  return { deps, config, configPath, root: resolve(dirname(configPath), config.root) };
}

/**
 * Runs `where_should_this_go`.
 *
 * @param deps - the check, the working directory and the config reads.
 * @param input - the tool's arguments.
 * @returns the layers, the contexts, the named module judged, one candidate
 *   per layer and the suggestion, as Markdown and as data; an error answer
 *   for a bad name, no config, or a broken one.
 * @throws when a check fails for a reason other than its config.
 */
export async function whereShouldThisGo(deps: WhereDeps, input: WhereInput): Promise<ToolAnswer> {
  const problem = problemOf(input);
  if (problem !== undefined) {
    return failure(problem);
  }
  try {
    const project = projectOf(deps, input.path);
    if (typeof project === "string") {
      return failure(project);
    }
    const imports = [...new Set(input.imports ?? [])];
    const views = layerViews(project.config.layers);
    const hinted = hintOf(project.config.layers, input.description);
    const named =
      input.module === undefined ? undefined : await judgeNamed(project, input.module, imports);
    const leaf = leafOf(input.module, input.description);
    const candidates = await candidatesOf(project, leaf, imports);
    const suggestion = suggest(named, candidates, hinted, imports.length > 0);
    return {
      text: prose(views, named, candidates, suggestion),
      data: {
        config: shown(project, project.configPath),
        layers: views,
        contexts: (project.config.contexts ?? []).map(contextView),
        ...(named === undefined ? {} : { module: named }),
        candidates,
        ...(suggestion === undefined ? {} : { suggestion }),
      },
    };
  } catch (err) {
    if (err instanceof ConfigError) {
      return failure(`config error: ${err.message}`);
    }
    throw err;
  }
}
