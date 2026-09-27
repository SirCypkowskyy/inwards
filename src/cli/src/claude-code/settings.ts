/**
 * @file Claude Code settings as Inwards needs them: recognising its own hook entries
 * (for `init`) and checking that no settings layer has switched them off (for
 * the Stop gate). Layers, lowest to highest precedence: user
 * (`$CLAUDE_CONFIG_DIR` or `~/.claude`), project (`.claude/settings.json`) and
 * local (`.claude/settings.local.json`). Managed enterprise settings are not read.
 *
 * Claude Code reloads hooks when a settings file changes, so an agent that
 * deletes the Stop hook switches the gate off at once; this check can't see
 * that. It catches the hooks the gate depends on (SessionStart, PreToolUse,
 * PostToolUse) going missing, and the config guard (`config-guard.ts`) is what stops
 * the edit itself.
 * It matches names, not programs: an entry that runs some other `inwards`
 * binary or `main.ts` passes, so it proves the configuration, not what runs.
 */
import { basename, join } from "node:path";
import { isRecord } from "../json/guards.ts";
import type { FileReader, Runtime } from "../platform/contracts.ts";

const HOOK_ARGS = ["hook", "claude-code"];
const EXE_SUFFIX = /\.exe$/iu;
/** `inwards`, or a release asset name kept as downloaded, e.g. `inwards-linux-x64-musl`. */
const INWARDS_BINARY = /^inwards(?:-(?:linux|darwin|windows)-(?:x64|arm64)(?:-musl)?)?$/iu;
/**
 * The shell-form spelling the docs show for a shared settings.json: the whole
 * command is `inwards hook claude-code`, optionally with a (quoted) path.
 */
const SHELL_FORM =
  /^\s*(?:"(?:[^"]*[\\/])?inwards(?:-(?:linux|darwin|windows)-(?:x64|arm64)(?:-musl)?)?(?:\.exe)?"|(?:[^\s"'#;&|$`]*[\\/])?inwards(?:-(?:linux|darwin|windows)-(?:x64|arm64)(?:-musl)?)?(?:\.exe)?)\s+hook\s+claude-code\s*$/iu;
/** Events whose Inwards hook must stay installed for the gate to trust the session. */
const REQUIRED_EVENTS = ["SessionStart", "PreToolUse", "PostToolUse"];
/** Tools each tool event's matcher must still cover. */
const REQUIRED_TOOLS: ReadonlyMap<string, readonly string[]> = new Map([
  ["PreToolUse", ["Edit", "Write", "MultiEdit", "Bash"]],
  ["PostToolUse", ["Edit", "Write", "MultiEdit"]],
]);
/** A matcher of only these characters is a list of exact tool names, not a regex. */
const EXACT_MATCHER = /^[\w\s,|-]*$/u;
const MATCHER_LIST = /\s*[|,]\s*/u;

/**
 * Recognises an entry `init` wrote: exec form, ending in `hook claude-code`, run
 * by a binary named inwards or by Bun with a main.ts. A user's own script that
 * happens to take the same arguments is not ours.
 *
 * @param entry - one hook entry.
 * @returns true for an Inwards exec-form entry.
 */
export function isOurHook(entry: unknown): boolean {
  if (!(isRecord(entry) && typeof entry["command"] === "string" && Array.isArray(entry["args"]))) {
    return false;
  }
  const args: unknown[] = entry["args"];
  const tail = args.slice(-HOOK_ARGS.length);
  const runsHook = tail.length === HOOK_ARGS.length && tail.every((a, i) => a === HOOK_ARGS[i]);
  const binary = basename(entry["command"]).replace(EXE_SUFFIX, "");
  const viaSource = binary === "bun" && typeof args[0] === "string" && args[0].endsWith("main.ts");
  return runsHook && (INWARDS_BINARY.test(binary) || viaSource);
}

/**
 * Checks that the hooks Inwards relies on are still on, across every layer.
 *
 * @param io - reads the settings files and knows where the user's live.
 * @param io.read - reads a settings file.
 * @param io.runtime - `CLAUDE_CONFIG_DIR` and the home directory.
 * @param project - the project root.
 * @returns what is wrong, or undefined when the hooks are in place.
 */
export function settingsProblem(
  io: { read: Pick<FileReader, "text">; runtime: Pick<Runtime, "claudeConfigDir" | "home"> },
  project: string,
): string | undefined {
  const layers = [
    join(userSettingsDir(io.runtime), "settings.json"),
    join(project, ".claude", "settings.json"),
    join(project, ".claude", "settings.local.json"),
  ].map((path) => readSettings(io.read, path));
  // The highest layer that sets disableAllHooks decides, as in Claude Code.
  const disabled = layers
    .map((s) => s?.["disableAllHooks"])
    .findLast((v) => typeof v === "boolean");
  if (disabled === true) {
    return "disableAllHooks is set in the Claude Code settings, so the Inwards hooks are off.";
  }
  const missing = REQUIRED_EVENTS.filter(
    (event) => !layers.some((settings) => hasInwardsHook(settings, event)),
  );
  if (missing.length === 0) {
    return undefined;
  }
  const hooks = missing.length === 1 ? "hook is" : "hooks are";
  const names = new Intl.ListFormat("en", { type: "conjunction" }).format(missing);
  return `The Inwards ${names} ${hooks} missing from every Claude Code settings file.`;
}

/**
 * Tells whether one settings layer runs Inwards for an event.
 *
 * @param settings - a parsed settings file, or undefined when absent.
 * @param event - a hook event name.
 * @returns true when an entry for that event is an Inwards hook, in exec or
 *   shell form, in a group whose matcher still covers the tools it must see.
 */
function hasInwardsHook(settings: Record<string, unknown> | undefined, event: string): boolean {
  const hooks = settings?.["hooks"];
  const groups = isRecord(hooks) ? hooks[event] : undefined;
  if (!Array.isArray(groups)) {
    return false;
  }
  return groups.some((group: unknown) => {
    const entries = isRecord(group) && Array.isArray(group["hooks"]) ? group["hooks"] : [];
    if (!(REQUIRED_TOOLS.get(event) ?? []).every((tool) => matches(group, tool))) {
      return false;
    }
    return entries.some(runsInwards);
  });
}

/**
 * Tells whether a hook entry runs Inwards, in exec form (as `init` writes it)
 * or in the documented shell form.
 *
 * @param entry - one hook entry.
 * @returns true for an Inwards hook.
 */
function runsInwards(entry: unknown): boolean {
  return (
    isOurHook(entry) ||
    (isRecord(entry) && typeof entry["command"] === "string" && SHELL_FORM.test(entry["command"]))
  );
}

/**
 * Tells whether settings text holds any Inwards hook, for any event.
 *
 * @param text - a settings file's text.
 * @returns true when some hook entry runs Inwards; false for other or unparseable text.
 */
export function holdsInwardsHooks(text: string): boolean {
  let settings: unknown;
  try {
    settings = JSON.parse(text);
  } catch {
    return false;
  }
  const hooks = isRecord(settings) ? settings["hooks"] : undefined;
  return (
    isRecord(hooks) &&
    Object.values(hooks).some(
      (groups) =>
        Array.isArray(groups) &&
        groups.some(
          (group: unknown) =>
            isRecord(group) && Array.isArray(group["hooks"]) && group["hooks"].some(runsInwards),
        ),
    )
  );
}

/**
 * Tells whether a hook group's matcher selects a tool, as Claude Code
 * evaluates it: empty or `*` matches all, letters and `|`/`,` form a list of
 * exact names, anything else is an unanchored regex.
 *
 * @param group - one matcher group.
 * @param tool - a tool name.
 * @returns true when the group runs for that tool.
 */
function matches(group: unknown, tool: string): boolean {
  const matcher = isRecord(group) ? group["matcher"] : undefined;
  if (matcher === undefined || matcher === "" || matcher === "*") {
    return true;
  }
  if (typeof matcher !== "string") {
    return false;
  }
  if (EXACT_MATCHER.test(matcher)) {
    return matcher.trim().split(MATCHER_LIST).includes(tool);
  }
  try {
    // Claude Code compiles matchers without flags and runs them unanchored.
    // biome-ignore lint/nursery/useUnicodeRegex: must match Claude Code's own flags
    const pattern = new RegExp(matcher);
    return pattern.exec(tool) !== null;
  } catch {
    return false;
  }
}

/**
 * Reads one settings file.
 *
 * @param read - reads the file.
 * @param path - a settings.json path.
 * @returns the parsed object, or undefined when missing or not a JSON object.
 */
function readSettings(
  read: Pick<FileReader, "text">,
  path: string,
): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(read.text(path));
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Where the user's Claude Code settings live: `$CLAUDE_CONFIG_DIR`, else `~/.claude`.
 *
 * @param runtime - the environment.
 * @returns the directory.
 */
export function userSettingsDir(runtime: Pick<Runtime, "claudeConfigDir" | "home">): string {
  return runtime.claudeConfigDir ?? join(runtime.home, ".claude");
}
