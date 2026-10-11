/**
 * @file `inwards init`: the setup wizard's entry point. It sorts out the flags
 * (`--list-styles`, `--style`, `--agent`, `--scaffold`, `--package`, `--brief`), asks
 * with the picker on a terminal when nothing was chosen, then writes a
 * preset's `[tool.inwards]`, the example scaffold and an agent's wiring, and
 * prints the annotated tree with a check's result. Everything it touches
 * comes in through the `InitContext`; it refuses rather than overwrites.
 */
import { dirname } from "node:path";
import { parseConfig, VERSION } from "@inwards/core";
import { print } from "../platform/print.ts";
import { agentChanges, apply, DEFAULT_IGNORE, initCommand, PRERELEASE } from "./agents.ts";
import { withBrief } from "./brief.ts";
import {
  AGENTS,
  type Change,
  type InitContext,
  type InitFlags,
  type InitPlan,
  isAgent,
  type Target,
} from "./contracts.ts";
import { STYLES } from "./presets.ts";
import { report, type Setup } from "./report.ts";
import { planScaffold } from "./scaffold.ts";
import { fullModule } from "./shapes.ts";
import { configTable, describeStyles } from "./style-text.ts";
import { expandLayers, isStyle, STYLE_NAMES, type Style, type StyleName } from "./styles.ts";
import { findTarget, noPackage, shown, sourceRoot } from "./target.ts";

const HOW = `  inwards init --style ${STYLE_NAMES.join("|")} [--scaffold] [--package NAME] [--agent ${AGENTS.join("|")}] [--launcher CMD] [--shared] [--brief] [--dry-run]
  inwards init --agent ${AGENTS.join("|")} [--launcher CMD] [--shared] [--brief] [--dry-run]    (the project already has [tool.inwards])
  inwards init --brief [--dry-run]    (only the architecture brief in AGENTS.md)
  inwards init --list-styles`;

/**
 * Runs `inwards init` with whatever flags were given: `--list-styles`, the
 * picker (no `--style`, `--agent` or `--brief`, on a terminal), `--style` with or
 * without `--agent`, `--agent` alone exactly as before, or `--brief` alone.
 *
 * @param ctx - the platform, the check runner and init's writer and picker.
 * @param paths - positionals after `init`; there must be none.
 * @param flags - the parsed options.
 * @param usage - the CLI's usage text, for a bad `--agent`.
 * @returns the exit code: 0 done, 2 for a usage error or something init won't overwrite.
 */
export async function initMain(
  ctx: InitContext,
  paths: string[],
  flags: InitFlags,
  usage: string,
): Promise<number> {
  const dryRun = flags["dry-run"] === true;
  if (paths.length > 0) {
    return print(ctx.io.streams, usage, 2);
  }
  if (flags["list-styles"] === true) {
    return print(ctx.io.streams, describeStyles(flags.package ?? "<package>"), 0);
  }
  if (flags.agent !== undefined && !isAgent(flags.agent)) {
    return print(ctx.io.streams, `${usage}\n\n--agent must be one of: ${AGENTS.join(", ")}`, 2);
  }
  if (flags.style !== undefined && !isStyle(flags.style)) {
    return print(
      ctx.io.streams,
      `inwards init: --style must be one of: ${STYLE_NAMES.join(", ")}`,
      2,
    );
  }
  const { agent, style } = flags;
  const brief = flags.brief === true;
  if (style === undefined && agent !== undefined) {
    return flags.scaffold === true || flags.package !== undefined
      ? print(ctx.io.streams, "inwards init: --scaffold and --package need --style.", 2)
      : initCommand(ctx, { ...startFlags(flags), agent, brief }, dryRun);
  }
  if (style !== undefined) {
    return await styleCommand(
      ctx,
      { style, scaffold: flags.scaffold === true, agent },
      flags,
      dryRun,
    );
  }
  if (brief) {
    return initCommand(
      ctx,
      { agent: undefined, launcher: undefined, shared: false, brief },
      dryRun,
    );
  }
  return await interactive(ctx, flags, dryRun);
}

/**
 * Asks for the style, the scaffold and the agent on a terminal. Without one
 * (stdin or stdout not a TTY, or `CI` set) it never waits for input: it exits
 * 2 at once with the flags and the styles. The prompt library is imported
 * only here, so no other command pays for loading it.
 *
 * @param ctx - the platform, the check runner and init's writer and picker.
 * @param flags - the parsed options (`--scaffold`, `--package`, `--launcher`).
 * @param dryRun - print the changes instead of writing them (`--dry-run`).
 * @returns the exit code of the chosen init, or 2.
 */
async function interactive(ctx: InitContext, flags: InitFlags, dryRun: boolean): Promise<number> {
  const { runtime } = ctx.io;
  const terminal = runtime.stdinIsTTY && runtime.stdoutIsTTY && !runtime.ci;
  if (!terminal) {
    return print(
      ctx.io.streams,
      `inwards init: choose what to set up; there is no terminal to ask in.\n${HOW}\n\n${describeStyles(flags.package ?? "<package>")}`,
      2,
    );
  }
  const target = lookUpTarget(ctx, flags);
  if (typeof target === "number") {
    return target;
  }
  if (!target.configured && target.pkg === undefined) {
    return print(ctx.io.streams, noPackage(ctx.io.runtime.cwd, target.path), 2);
  }
  const plan = await ctx.init.picker.pick(target, flags);
  if (plan === undefined) {
    return 2;
  }
  if (plan.style === undefined) {
    return plan.agent === undefined
      ? 0
      : initCommand(ctx, { ...startFlags(flags), agent: plan.agent, brief: false }, dryRun);
  }
  return await styleCommand(ctx, { ...plan, style: plan.style }, flags, dryRun);
}

/**
 * Writes a preset's `[tool.inwards]`, the example with `--scaffold`, and an
 * agent's wiring with `--agent`, then prints the annotated tree and the
 * result of a check. Refuses (exit 2, nothing written) when the table exists
 * or a file it would create is already there.
 *
 * @param ctx - the platform, the check runner and init's writer and picker.
 * @param plan - the style, whether to scaffold, and the agent.
 * @param plan.style - the preset.
 * @param flags - `--package` and `--launcher`.
 * @param dryRun - print every change as a diff instead of writing.
 * @returns 0 once written (or printed), 2 when init would overwrite something.
 */
async function styleCommand(
  ctx: InitContext,
  plan: InitPlan & { style: StyleName },
  flags: InitFlags,
  dryRun: boolean,
): Promise<number> {
  const target = lookUpTarget(ctx, flags);
  if (typeof target === "number") {
    return target;
  }
  if (target.configured) {
    return print(
      ctx.io.streams,
      `inwards init: ${shown(ctx.io.runtime.cwd, target.path)} already has [tool.inwards]; --style never rewrites layers. To wire an agent, run \`inwards init --agent ${AGENTS.join("|")}\`.`,
      2,
    );
  }
  if (target.pkg === undefined) {
    return print(ctx.io.streams, noPackage(ctx.io.runtime.cwd, target.path), 2);
  }
  const style = STYLES[plan.style];
  const project = dirname(target.path);
  if (project !== ctx.io.runtime.cwd) {
    print(
      ctx.io.streams,
      `inwards init: using ${shown(ctx.io.runtime.cwd, target.path)}, the nearest pyproject.toml above here.`,
      0,
    );
  }
  const root = sourceRoot({ ...ctx.io, toml: ctx.init.toml }, project, target.pkg, target.text);
  const config = withTable(target, style, { pkg: target.pkg, root, scaffold: plan.scaffold });
  if (typeof config === "string") {
    return print(ctx.io.streams, `inwards init: ${config}`, 2);
  }
  const { files, refused } = plan.scaffold
    ? planScaffold(ctx.io.probe, project, { style, pkg: target.pkg, root })
    : { files: [], refused: [] };
  if (refused.length > 0) {
    return print(
      ctx.io.streams,
      `inwards init: --scaffold never replaces an existing file or symlink, or writes outside the project, and these are in the way:\n  ${refused.map((p) => shown(ctx.io.runtime.cwd, p)).join("\n  ")}\nNothing was written.`,
      2,
    );
  }
  const wired =
    plan.agent === undefined
      ? []
      : agentChanges(ctx, { ...startFlags(flags), agent: plan.agent }, project);
  const wiring =
    typeof wired === "string" || flags.brief !== true
      ? wired
      : withBrief(ctx.io, wired, { path: target.path, text: config.after });
  if (typeof wiring === "string") {
    return print(ctx.io.streams, `inwards init: ${wiring}`, 2);
  }
  const agentEdits = wiring.filter((c) => c.before !== c.after);
  if (dryRun) {
    return apply(ctx, [config, ...files, ...agentEdits], true);
  }
  return await commit(ctx, { configPath: target.path, style, pkg: target.pkg, root }, plan, {
    config,
    files,
    agentEdits,
  });
}

/**
 * Writes what `styleCommand` planned: the scaffold's files, then
 * pyproject.toml (all or nothing), then the agent's wiring, and prints the report.
 *
 * @param ctx - the platform, the check runner and init's writer.
 * @param setup - the pyproject.toml, the preset, the package and the config root.
 * @param plan - what was chosen, for the messages and the next steps.
 * @param changes - the config change, the scaffold's files and the agent's edits.
 * @param changes.config - the pyproject.toml change.
 * @param changes.files - the scaffold's files.
 * @param changes.agentEdits - the agent's edits that change something.
 * @returns 0 once written, 2 when a write failed.
 */
async function commit(
  ctx: InitContext,
  setup: Setup,
  plan: InitPlan,
  changes: { config: Change; files: Change[]; agentEdits: Change[] },
): Promise<number> {
  const { config, files, agentEdits } = changes;
  const failed = ctx.init.files.writeAll(files, config);
  if (failed !== undefined) {
    return print(
      ctx.io.streams,
      `inwards init: could not write ${failed}. Nothing was written.`,
      2,
    );
  }
  const example = files.length > 0 ? ` and ${files.length} example files` : "";
  print(
    ctx.io.streams,
    `inwards init: wrote the ${setup.style.name} preset to ${shown(ctx.io.runtime.cwd, config.path)}${example}.`,
    0,
  );
  if (agentEdits.length > 0) {
    try {
      apply(ctx, agentEdits, false);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return print(
        ctx.io.streams,
        `inwards init: the layers are written, but wiring ${plan.agent ?? "the brief"} failed (${reason}); fix that and run \`inwards init ${plan.agent === undefined ? "--brief" : `--agent ${plan.agent}`}\`.`,
        2,
      );
    }
  }
  return await report(ctx, setup, plan);
}

/**
 * Appends the preset's table to pyproject.toml, one blank line after the
 * rest, in the file's own line endings. The result must parse to exactly the
 * preset's layers, templates expanded; otherwise (a `tool` inline table, say) init stops.
 *
 * @param target - the pyproject.toml.
 * @param style - the preset.
 * @param opts - the import package, the config root, and whether the scaffold is written.
 * @param opts.pkg - the import package.
 * @param opts.root - the config root.
 * @param opts.scaffold - add the preset's shapes and contexts, which fit only the scaffold's packages.
 * @returns the change, or an error message.
 */
function withTable(
  target: Target,
  style: Style,
  { pkg, root, scaffold }: { pkg: string; root: string; scaffold: boolean },
): Change | string {
  const { path, text } = target;
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const version = VERSION.replace(PRERELEASE, "");
  const table = configTable(style, { pkg, root, version, ignore: DEFAULT_IGNORE, scaffold, eol });
  const after = `${text}${separator(text, eol)}${table}`;
  const want = expandLayers(style)
    .map((layer) => `${layer.name}=${fullModule(pkg, layer.module)}`)
    .join(" ");
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
export function separator(text: string, eol: string): string {
  if (text === "" || text.endsWith(`${eol}${eol}`)) {
    return "";
  }
  return text.endsWith(eol) ? eol : `${eol}${eol}`;
}

/**
 * Finds the project init works on, or says why there is none.
 *
 * @param ctx - the platform and init's TOML parser.
 * @param flags - `--package`.
 * @returns the target, or exit code 2 once the reason is printed.
 */
function lookUpTarget(ctx: InitContext, flags: InitFlags): Target | number {
  const target = findTarget({ ...ctx.io, toml: ctx.init.toml }, flags.package);
  return typeof target === "string" ? print(ctx.io.streams, `inwards init: ${target}`, 2) : target;
}

/**
 * Picks the flags that say how an agent starts Inwards.
 *
 * @param flags - the parsed options.
 * @returns `--launcher` as given, and whether `--shared` was.
 */
function startFlags(flags: InitFlags): { launcher: string | undefined; shared: boolean } {
  return { launcher: flags.launcher, shared: flags.shared === true };
}
