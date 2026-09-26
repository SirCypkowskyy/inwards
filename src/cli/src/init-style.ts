import { dirname } from "node:path";
import process from "node:process";
import { parseConfig, VERSION } from "@inwards/core";
import {
  AGENTS,
  type Agent,
  agentChanges,
  apply,
  type Change,
  DEFAULT_IGNORE,
  initCommand,
  isAgent,
  PRERELEASE,
} from "./init.ts";
import { report } from "./init-report.ts";
import { findTarget, noPackage, shown, sourceRoot, type Target } from "./init-target.ts";
import { planScaffold, writeAll } from "./init-write.ts";
import { print } from "./output.ts";
import { pick } from "./picker.ts";
import {
  configTable,
  describeStyles,
  isStyle,
  STYLE_NAMES,
  STYLES,
  type Style,
  type StyleName,
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
  if (project !== process.cwd()) {
    print(`inwards init: using ${shown(target.path)}, the nearest pyproject.toml above here.`, 0);
  }
  const root = sourceRoot(project, target.pkg, target.text);
  const config = withTable(target, style, target.pkg, root);
  if (typeof config === "string") {
    return print(`inwards init: ${config}`, 2);
  }
  const { files, refused } = plan.scaffold
    ? planScaffold(project, style, target.pkg, root)
    : { files: [], refused: [] };
  if (refused.length > 0) {
    return print(
      `inwards init: --scaffold never replaces an existing file or symlink, or writes outside the project, and these are in the way:\n  ${refused.map(shown).join("\n  ")}\nNothing was written.`,
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
  return await commit({ configPath: target.path, style, pkg: target.pkg, root }, plan, {
    config,
    files,
    agentEdits,
  });
}

/**
 * Writes what `styleCommand` planned: the scaffold's files, then
 * pyproject.toml (all or nothing), then the agent's wiring, and prints the report.
 *
 * @param setup - the pyproject.toml, the preset, the package and the config root.
 * @param plan - what was chosen, for the messages and the next steps.
 * @param changes - the config change, the scaffold's files and the agent's edits.
 * @param changes.config - the pyproject.toml change.
 * @param changes.files - the scaffold's files.
 * @param changes.agentEdits - the agent's edits that change something.
 * @returns 0 once written, 2 when a write failed.
 */
async function commit(
  setup: Parameters<typeof report>[0],
  plan: InitPlan,
  changes: { config: Change; files: Change[]; agentEdits: Change[] },
): Promise<number> {
  const { config, files, agentEdits } = changes;
  const failed = writeAll(files, config);
  if (failed !== undefined) {
    return print(`inwards init: could not write ${failed}. Nothing was written.`, 2);
  }
  const example = files.length > 0 ? ` and ${files.length} example files` : "";
  print(
    `inwards init: wrote the ${setup.style.name} preset to ${shown(config.path)}${example}.`,
    0,
  );
  if (agentEdits.length > 0) {
    try {
      apply(agentEdits, false);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return print(
        `inwards init: the layers are written, but wiring ${plan.agent} failed (${reason}); fix that and run \`inwards init --agent ${plan.agent}\`.`,
        2,
      );
    }
  }
  return await report(setup, plan);
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
