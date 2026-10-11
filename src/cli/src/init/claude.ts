/**
 * @file Claude Code's wiring for `inwards init --agent claude`: the hooks and
 * `permissions.deny` rules merged into a project settings file, either
 * `.claude/settings.local.json` for this machine or, with `--shared`, the
 * committed `.claude/settings.json` plus the `inwards` server in `.mcp.json`
 * (#342). Our old entries are replaced and everything else is kept; a file in
 * a shape init doesn't know stops it. It computes changes and writes nothing.
 */
import { join } from "node:path";
import { holdsInwardsHooks, isInwardsHook } from "../claude-code/settings.ts";
import { isRecord } from "../json/guards.ts";
import { print } from "../platform/print.ts";
import type { Change, InitContext } from "./contracts.ts";
import { gitignore } from "./gitignore.ts";
import type { Exec } from "./launcher.ts";
import { mcpJson } from "./mcp-json.ts";
import { readIfThere } from "./section.ts";

/**
 * Claude Code hook events Inwards handles, with the tool matcher each needs.
 * Only events the hook implements are installed, so init never swaps a
 * working setup for a no-op.
 */
const CLAUDE_HOOKS: readonly [event: string, matcher: string | undefined][] = [
  ["SessionStart", undefined],
  ["PreToolUse", ["Edit", "Write", "MultiEdit", "Bash"].join("|")],
  ["PostToolUse", "Edit|Write|MultiEdit"],
  ["Stop", undefined],
];
/**
 * Permission rules init adds, so Claude Code itself refuses edits to the
 * hooks and the session state even if a hook is gone (`/` anchors at the project).
 */
const DENY_RULES = [
  "Edit(/.claude/settings*.json)",
  "Edit(/.inwards/**)",
  "Edit(/**/inwards-baseline.json)",
];
const HOOK_ARGS = ["hook", "claude-code"];

/**
 * Computes `--shared` for Claude Code: the hooks in the committed
 * `.claude/settings.json`, the `inwards` server in `.mcp.json`, Inwards' own
 * hooks taken out of `.claude/settings.local.json` (Claude Code merges hook
 * lists across files, so they would run twice), and `.inwards/` in
 * `.gitignore`. Nothing it writes may hold this machine's path, so it needs a
 * launcher or an `inwards` on `PATH`.
 *
 * @param ctx - reads the files and looks `inwards` up on `PATH`.
 * @param words - the checked `--launcher` words; undefined without one.
 * @param project - the directory of the project's pyproject.toml.
 * @returns the changes, or an error.
 */
export function sharedClaude(
  ctx: InitContext,
  words: string[] | undefined,
  project: string,
): Change[] | string {
  if (words === undefined && ctx.init.onPath("inwards") === undefined) {
    return "--shared writes the committed .claude/settings.json and .mcp.json, which can't hold this machine's path to Inwards. Pass a launcher (--launcher \"uv run\" with Inwards as a dev dependency), or put `inwards` on PATH, as every teammate then needs it.";
  }
  const launcher = words?.join(" ");
  const command = launcher === undefined ? `inwards ${HOOK_ARGS.join(" ")}` : shellHook(launcher);
  const claude = join(project, ".claude");
  const settings = claudeSettings(ctx, join(claude, "settings.json"), {
    type: "command",
    command,
  });
  if (typeof settings === "string") {
    return settings;
  }
  const mcp = mcpJson(ctx, join(project, ".mcp.json"), [...(words ?? []), "inwards"]);
  if (typeof mcp === "string") {
    return mcp;
  }
  const local = withoutLocalHooks(ctx, join(claude, "settings.local.json"));
  return [
    settings,
    mcp,
    ...(local === undefined ? [] : [local]),
    gitignore(ctx, join(project, ".gitignore"), "claude", { local: false }),
  ];
}

/**
 * The shell-form hook command for a launcher, run from the project root so
 * the launcher finds the project's environment.
 *
 * @param launcher - the checked launcher, e.g. `uv run`.
 * @returns `cd "$CLAUDE_PROJECT_DIR" && <launcher> inwards hook claude-code`.
 */
function shellHook(launcher: string): string {
  return `cd "$CLAUDE_PROJECT_DIR" && ${launcher} inwards ${HOOK_ARGS.join(" ")}`;
}

/**
 * Takes Inwards' own hooks out of the local settings, keeping everything
 * else there, for `--shared`. An event left with no group is dropped.
 *
 * @param ctx - reads the current file.
 * @param path - `.claude/settings.local.json`.
 * @returns the change, or undefined when the file holds no Inwards hook.
 */
function withoutLocalHooks(ctx: InitContext, path: string): Change | undefined {
  const before = readIfThere(ctx.io, path);
  if (before === undefined || !holdsInwardsHooks(before)) {
    return undefined;
  }
  // holdsInwardsHooks parsed it: an object whose "hooks" is an object.
  const settings: unknown = JSON.parse(before);
  const hooks = isRecord(settings) ? settings["hooks"] : undefined;
  if (!(isRecord(settings) && isRecord(hooks))) {
    return undefined;
  }
  const kept: Record<string, unknown> = {};
  for (const [event, groups] of Object.entries(hooks)) {
    const rest = Array.isArray(groups)
      ? groups.map(withoutOurHook).filter((g) => g !== undefined)
      : groups;
    if (!Array.isArray(rest) || rest.length > 0) {
      kept[event] = rest;
    }
  }
  const others = Object.fromEntries(Object.entries(settings).filter(([key]) => key !== "hooks"));
  const after = Object.keys(kept).length === 0 ? others : { ...settings, hooks: kept };
  return { path, before, after: `${JSON.stringify(after, null, 2)}\n` };
}

/**
 * Warns when the committed `.claude/settings.json` already runs the Inwards
 * hooks, since local hooks added beside them make every hook run twice.
 *
 * @param ctx - reads the file and prints the warning.
 * @param path - the project's `.claude/settings.json`.
 */
function warnIfShared(ctx: InitContext, path: string): void {
  const text = readIfThere(ctx.io, path);
  if (text !== undefined && holdsInwardsHooks(text)) {
    print(
      ctx.io.streams,
      `inwards init: warning: ${path} already holds the Inwards hooks, so with these in .claude/settings.local.json each hook runs twice. Run \`inwards init --agent claude --shared\` instead, or remove them from one of the files.`,
      0,
    );
  }
}

/**
 * Merges the Inwards hooks and deny rules into a Claude Code project
 * settings file (local, or the committed one with `--shared`). Our old hook entries are removed wherever they are and one fresh
 * group per event is appended, so matchers stay right and duplicates go away;
 * deny rules are added once. Anything that isn't the documented shape stops
 * init rather than being rewritten.
 *
 * @param ctx - reads the current file.
 * @param path - `.claude/settings.local.json`, or `.claude/settings.json` with `--shared`.
 * @param hook - the hook entry for every event: exec form with this binary's
 *   path, or a shell command (a launcher, or a bare `inwards`).
 * @returns the change, or an error message.
 */
function claudeSettings(
  ctx: InitContext,
  path: string,
  hook: Record<string, unknown>,
): Change | string {
  const before = readIfThere(ctx.io, path);
  let settings: unknown;
  try {
    settings = before === undefined ? {} : JSON.parse(before);
  } catch {
    return `${path} is not valid JSON; fix it first`;
  }
  if (!isRecord(settings)) {
    return `${path} is not a JSON object`;
  }
  const hooks = settings["hooks"] ?? {};
  if (!isRecord(hooks)) {
    return `"hooks" in ${path} is not an object; fix it first`;
  }
  for (const [event, matcher] of CLAUDE_HOOKS) {
    const groups = hooks[event] ?? [];
    if (!Array.isArray(groups)) {
      return `"hooks.${event}" in ${path} is not a list; fix it first`;
    }
    const kept = groups.map(withoutOurHook).filter((g) => g !== undefined);
    kept.push(matcher === undefined ? { hooks: [hook] } : { matcher, hooks: [hook] });
    hooks[event] = kept;
  }
  settings["hooks"] = hooks;
  const denied = withDenyRules(settings["permissions"]);
  if (denied === undefined) {
    return `"permissions.deny" in ${path} is not a list; fix it first`;
  }
  settings["permissions"] = denied;
  return { path, before, after: `${JSON.stringify(settings, null, 2)}\n` };
}

/**
 * Adds the Inwards deny rules to a `permissions` value, once each.
 *
 * @param permissions - the current `permissions`, possibly absent.
 * @returns the updated object, or undefined when it or its `deny` has the wrong shape.
 */
function withDenyRules(permissions: unknown): Record<string, unknown> | undefined {
  const table = permissions ?? {};
  const deny = isRecord(table) ? (table["deny"] ?? []) : undefined;
  if (!(isRecord(table) && Array.isArray(deny))) {
    return undefined;
  }
  return { ...table, deny: [...deny, ...DENY_RULES.filter((rule) => !deny.includes(rule))] };
}

/**
 * Removes Inwards hook entries from one matcher group.
 *
 * @param group - one element of an event's list.
 * @returns the group without our entries, or undefined when nothing else was in it.
 */
function withoutOurHook(group: unknown): unknown {
  if (!(isRecord(group) && Array.isArray(group["hooks"]))) {
    return group;
  }
  const others = group["hooks"].filter((entry) => !isInwardsHook(entry));
  return others.length === 0 ? undefined : { ...group, hooks: others };
}

/**
 * Computes the machine-local wiring: the hooks in `.claude/settings.local.json`,
 * which may hold this binary's path and so must not be committed. It warns
 * when the committed settings already run the hooks.
 *
 * @param ctx - reads the files and prints the warning.
 * @param project - the directory of the project's pyproject.toml.
 * @param start - this binary (exec form), or a checked launcher such as `uv run` (shell form).
 * @returns the change, or an error when the file can't be edited safely.
 */
export function localClaude(
  ctx: InitContext,
  project: string,
  start: Exec | string,
): Change | string {
  warnIfShared(ctx, join(project, ".claude", "settings.json"));
  const hook =
    typeof start === "string"
      ? { type: "command", command: shellHook(start) }
      : { type: "command", command: start.command, args: [...start.args, ...HOOK_ARGS] };
  return claudeSettings(ctx, join(project, ".claude", "settings.local.json"), hook);
}
