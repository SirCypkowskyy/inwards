/**
 * @file `inwards init --style auto`: finds the project's package, lists its
 * top-level modules through the platform's reader, maps them to layers with
 * `_auto.ts`'s name table, and prints the proposed `[tool.inwards]`. It
 * writes the table only with `--write` or a yes on a terminal; without
 * either and without a terminal it exits 2, so a script never mistakes the
 * proposal for a config. It never overwrites an existing `[tool.inwards]`
 * and never creates a package; the scaffold is the other styles' business.
 */
import { dirname, join } from "node:path";
import { parseConfig, VERSION } from "@inwards/core";
import { print } from "../shared/platform/print.ts";
import { agentChanges, apply, DEFAULT_IGNORE, PRERELEASE } from "./_agents.ts";
import { autoTable, describeProposal, type Member, type Proposal, propose } from "./_auto.ts";
import { printCheck } from "./_report.ts";
import { appendSeparator } from "./_section.ts";
import { STYLE_NAMES } from "./_styles.ts";
import { findTarget, shown, sourceRoot } from "./_target.ts";
import { withBrief } from "./brief/index.ts";
import { AGENTS, type Agent, type Change, type InitContext, type InitFlags } from "./contracts.ts";

/** A module's file extension. */
const PY = ".py";

/** A Python identifier, the only names a module can be imported by. */
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/u;

/** Top-level directories that hold no package of the project's own. */
const NOT_PACKAGES: ReadonlySet<string> = new Set([...DEFAULT_IGNORE, "test", "docs"]);

/** The package found, its config root and its directory. */
interface Found {
  pkg: string;
  root: string;
  dir: string;
}

/** What `--style auto` settled on: the pyproject.toml change, the table, and the mapping. */
interface Planned {
  config: Change;
  table: string;
  /** The mapping in words, printed beside the table. */
  mapping: string;
  proposal: Proposal;
}

/**
 * Runs `inwards init --style auto`: maps the package's modules to layers and
 * prints the table, then writes it with `--write` (or a yes on a terminal),
 * wiring `--agent` and `--brief` as the other styles do.
 *
 * @param ctx - the platform, the check runner and init's writer and picker.
 * @param flags - the parsed options: `--package`, `--agent`, `--launcher`, `--shared`, `--brief`, `--write`.
 * @param dryRun - print every change as a diff instead of writing (`--dry-run`).
 * @returns 0 once written or printed as a diff (or declined on a terminal); 2 for
 *   a usage error, a project it can't map, or a proposal printed without `--write`
 *   where there is no terminal to ask in.
 * @throws when a file can't be read or written, or the check can't run.
 */
export async function autoCommand(
  ctx: InitContext,
  flags: InitFlags,
  dryRun: boolean,
): Promise<number> {
  const { streams, runtime } = ctx.io;
  if (flags.scaffold === true) {
    return print(
      streams,
      "inwards init: --scaffold doesn't go with --style auto, which maps the modules you have.",
      2,
    );
  }
  const planned = plan(ctx, flags.package);
  if (typeof planned === "string") {
    return print(streams, `inwards init: ${planned}`, 2);
  }
  if (!dryRun && flags.write !== true) {
    // The table alone on stdout, so it can be redirected; the words on stderr.
    streams.out(planned.table);
    streams.err(`${planned.mapping}\n`);
    const terminal = runtime.stdinIsTTY && runtime.stdoutIsTTY && !runtime.ci;
    if (!terminal) {
      return print(
        streams,
        "inwards init: nothing written; run it again with --write to add this table to pyproject.toml.",
        2,
      );
    }
    const where = shown(runtime.cwd, planned.config.path);
    if (!(await ctx.init.picker.confirm(`Add this table to ${where}?`))) {
      return 0;
    }
  }
  return await write(ctx, planned, flags, dryRun);
}

/**
 * Finds the project and its package, maps the package's modules, and builds
 * the pyproject.toml change, checking it reads back as the proposed layers.
 *
 * @param ctx - probes, lists and reads files, parses TOML.
 * @param pkgFlag - `--package`, if given.
 * @returns the plan, or why there is none.
 * @throws when a file can't be read or a directory listed.
 */
function plan(ctx: InitContext, pkgFlag: string | undefined): Planned | string {
  const { cwd } = ctx.io.runtime;
  const target = findTarget({ ...ctx.io, toml: ctx.init.toml }, pkgFlag);
  if (typeof target === "string") {
    return target;
  }
  if (target.configured) {
    return `${shown(cwd, target.path)} already has [tool.inwards]; --style never rewrites layers.`;
  }
  const project = dirname(target.path);
  const found = findPackage(ctx, project, { named: target.pkg, text: target.text, flag: pkgFlag });
  if (typeof found === "string") {
    return found;
  }
  const proposal = propose(members(ctx, found.dir));
  if (proposal.layers.length === 0) {
    return `no module in ${shown(cwd, found.dir)} has a name the --style auto table knows (core, models, crud, services, api...). Pick a preset with --style ${STYLE_NAMES.join("|")}.`;
  }
  const eol = target.text.includes("\r\n") ? "\r\n" : "\n";
  const version = VERSION.replace(PRERELEASE, "");
  const table = autoTable(proposal, { ...found, version, ignore: DEFAULT_IGNORE, eol });
  const after = `${target.text}${appendSeparator(target.text, eol)}${table}`;
  if (!readsBack(after, proposal, found.pkg)) {
    return `could not add [tool.inwards] to ${shown(cwd, target.path)} safely; add this table by hand:\n${table}`;
  }
  return {
    config: { path: target.path, before: target.text, after },
    table,
    mapping: `inwards init: --style auto mapped ${shown(cwd, found.dir)}/ to the ${proposal.preset} preset's layers:\n${describeProposal(proposal, found.pkg)}`,
    proposal,
  };
}

/**
 * Writes the table and the agent's wiring (or prints them as a diff), then
 * runs a check and prints its counts.
 *
 * @param ctx - the platform, the check runner and init's writer.
 * @param planned - the change, the mapping and the proposal.
 * @param flags - `--agent`, `--launcher`, `--brief` and `--write`.
 * @param dryRun - print every change as a diff instead of writing.
 * @returns 0 once written or printed; 2 when the wiring or a write fails.
 * @throws when the check can't run on the new config.
 */
async function write(
  ctx: InitContext,
  planned: Planned,
  flags: InitFlags,
  dryRun: boolean,
): Promise<number> {
  const { streams, runtime } = ctx.io;
  const { config, proposal } = planned;
  const agent = AGENTS.find((a): a is Agent => a === flags.agent);
  const wiring = agentEdits(ctx, config, { agent, flags });
  if (typeof wiring === "string") {
    return print(streams, `inwards init: ${wiring}`, 2);
  }
  if (dryRun) {
    return apply(ctx, [config, ...wiring], true);
  }
  const failed = ctx.init.files.writeAll([], config);
  if (failed !== undefined) {
    return print(streams, `inwards init: could not write ${failed}. Nothing was written.`, 2);
  }
  const count = proposal.layers.length;
  const layers = `${count} ${count === 1 ? "layer" : "layers"}`;
  print(streams, `inwards init: wrote ${layers} to ${shown(runtime.cwd, config.path)}.`, 0);
  if (flags.write === true) {
    print(streams, planned.mapping, 0);
  }
  if (wiring.length > 0) {
    const problem = applyWiring(ctx, wiring, agent);
    if (problem !== undefined) {
      return print(streams, `inwards init: ${problem}`, 2);
    }
  }
  await printCheck(ctx, config.path, unmappedHint(proposal.unmapped.length));
  return 0;
}

/**
 * Applies the agent's wiring after the table is written.
 *
 * @param ctx - the platform and init's writer.
 * @param wiring - the edits.
 * @param agent - `--agent`, or undefined when only the brief is written.
 * @returns undefined once applied, or what failed and how to redo it.
 */
function applyWiring(
  ctx: InitContext,
  wiring: Change[],
  agent: Agent | undefined,
): string | undefined {
  try {
    apply(ctx, wiring, false);
    return undefined;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    const rerun = agent === undefined ? "--brief" : `--agent ${agent}`;
    return `the layers are written, but wiring ${agent ?? "the brief"} failed (${reason}); fix that and run \`inwards init ${rerun}\`.`;
  }
}

/**
 * Words the sentence after the check's counts about the modules in no layer.
 *
 * @param left - how many members the name table left out.
 * @returns the sentence with a leading space, or "" when every member is in a layer.
 */
function unmappedHint(left: number): string {
  if (left === 0) {
    return "";
  }
  return ` ${left === 1 ? "One module is" : `${left} modules are`} in no layer yet; the comment under layers lists them.`;
}

/**
 * Works out the agent's wiring and the brief, as the other styles do.
 *
 * @param ctx - the platform and init's TOML parser.
 * @param config - the pyproject.toml change, for the brief.
 * @param opts - the agent and the flags.
 * @param opts.agent - `--agent`, if given.
 * @param opts.flags - `--launcher`, `--shared` and `--brief`.
 * @returns the edits that change something, or why the wiring can't be done.
 * @throws when a file can't be read.
 */
function agentEdits(
  ctx: InitContext,
  config: Change,
  { agent, flags }: { agent: Agent | undefined; flags: InitFlags },
): Change[] | string {
  const project = dirname(config.path);
  const wiring = { agent, launcher: flags.launcher, shared: flags.shared === true };
  const wired = agent === undefined ? [] : agentChanges(ctx, { ...wiring, agent }, project);
  const edits =
    typeof wired === "string" || flags.brief !== true
      ? wired
      : withBrief(ctx.io, wired, { path: config.path, text: config.after });
  return typeof edits === "string" ? edits : edits.filter((c) => c.before !== c.after);
}

/**
 * Finds the package to map: the one `--package` or `[project].name` names
 * when it is on disk, else the only package at the top of the project or in
 * `src/`.
 *
 * @param ctx - probes and lists directories, parses TOML.
 * @param project - the project directory.
 * @param opts - what names the package.
 * @param opts.named - `--package`, or `[project].name` normalised.
 * @param opts.text - the pyproject.toml text, for the build backend.
 * @param opts.flag - `--package` itself: then the named package must exist.
 * @returns the package, its config root and its directory, or why there is none.
 * @throws when a directory can't be listed.
 */
function findPackage(
  ctx: InitContext,
  project: string,
  opts: { named: string | undefined; text: string; flag: string | undefined },
): Found | string {
  const io = { ...ctx.io, toml: ctx.init.toml };
  const { named, text, flag } = opts;
  if (named !== undefined) {
    const root = sourceRoot(io, project, named, text);
    const dir = join(project, root, ...named.split("."));
    if (ctx.io.probe.kind(dir) === "dir") {
      return { pkg: named, root, dir };
    }
    if (flag !== undefined) {
      return `--package ${flag}: there is no ${named.replaceAll(".", "/")}/ in ${shown(ctx.io.runtime.cwd, project) || "."} or its src/.`;
    }
  }
  const candidates = ["", "src"].flatMap((root) =>
    (ctx.io.read.list(join(project, root)) ?? [])
      .filter((entry) => entry.dir && IDENTIFIER.test(entry.name) && !NOT_PACKAGES.has(entry.name))
      .filter(
        (entry) => ctx.io.probe.kind(join(project, root, entry.name, "__init__.py")) === "file",
      )
      .map((entry) => ({
        pkg: entry.name,
        root: root === "" ? "." : root,
        dir: join(project, root, entry.name),
      })),
  );
  const [only] = candidates;
  if (only !== undefined && candidates.length === 1) {
    return only;
  }
  const names = candidates
    .map((c) => c.pkg)
    .sort()
    .join(", ");
  return candidates.length === 0
    ? `found no package (a directory with __init__.py) in ${shown(ctx.io.runtime.cwd, project) || "."} or its src/; name it with --package.`
    : `found several packages (${names}); name the one to map with --package.`;
}

/**
 * Lists a package's top-level members: modules (`.py` files) and
 * subpackages (directories holding `__init__.py` or any `.py` file), leaving
 * out `__init__`, names that can't be imported, and what the config ignores.
 *
 * @param ctx - lists directories.
 * @param dir - the package's directory.
 * @returns the members, unsorted.
 * @throws when a directory can't be listed.
 */
function members(ctx: InitContext, dir: string): Member[] {
  const out = new Map<string, Member>();
  for (const entry of ctx.io.read.list(dir) ?? []) {
    const name =
      entry.file && entry.name.endsWith(".py") ? entry.name.slice(0, -PY.length) : entry.name;
    if (!IDENTIFIER.test(name) || name === "__init__" || DEFAULT_IGNORE.includes(name)) {
      continue;
    }
    if (entry.dir && holdsPython(ctx, join(dir, entry.name))) {
      out.set(name, { name, package: true });
    } else if (entry.file && entry.name.endsWith(".py") && !out.has(name)) {
      out.set(name, { name, package: false });
    }
  }
  return [...out.values()];
}

/**
 * Tells whether a directory holds Python at its top level.
 *
 * @param ctx - lists directories.
 * @param dir - the directory.
 * @returns true when it has a `.py` file.
 * @throws when it can't be listed.
 */
function holdsPython(ctx: InitContext, dir: string): boolean {
  return (ctx.io.read.list(dir) ?? []).some((entry) => entry.file && entry.name.endsWith(".py"));
}

/**
 * Checks that pyproject.toml with the table appended parses to exactly the
 * proposed layers; a `tool` inline table, say, would put it somewhere else.
 *
 * @param after - the new pyproject.toml text.
 * @param proposal - the layers it must hold.
 * @param pkg - the project's import package.
 * @returns true when the layers read back as proposed.
 */
function readsBack(after: string, proposal: Proposal, pkg: string): boolean {
  const want = proposal.layers
    .map((layer) => `${layer.name}=${layer.modules.map((m) => `${pkg}.${m}`).join(",")}`)
    .join(" ");
  try {
    const got = parseConfig(after)
      .layers.map((layer) => `${layer.name}=${layer.modules.join(",")}`)
      .join(" ");
    return got === want;
  } catch {
    return false;
  }
}
