/**
 * @file The first half of the OpenCode plugin's source (ADR-033): the
 * project and the plugin's own hash, the paths it protects, how it runs the
 * hook, reads its output and resolves links, and how it maps OpenCode's tool
 * arguments. `opencode.ts` puts the file together; this is JavaScript text,
 * not code this module runs.
 */

/** Helpers the plugin's hooks use; they need `INWARDS` and the imports `pluginSource` writes above them. */
export const PLUGIN_HELPERS = `/** The project init wrote this plugin into, whichever directory OpenCode runs in. */
const PROJECT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
/** This file's hash as OpenCode loaded it: the Stop gate reports a plugin changed since. */
const SELF = createHash("sha256")
  .update(readFileSync(fileURLToPath(import.meta.url)))
  .digest("hex");
/** OpenCode tools the hooks see, under the Claude Code names the hook knows. */
const TOOLS = { edit: "Edit", write: "Write", bash: "Bash" };
/** Inwards' own files and this plugin, either separator, any case. */
const PROTECTED = /(^|[\\\\/])(\\.opencode[\\\\/]|opencode\\.jsonc?$|\\.inwards[\\\\/]|inwards-baseline\\.json$)/iu;
const CONFIG = /(^|[\\\\/])pyproject\\.toml$/iu;
/** A command that names one of those files, or the config. */
const MENTIONS = /pyproject\\.toml|\\.opencode|opencode\\.jsonc?|\\.inwards|inwards-baseline/iu;
/**
 * A patch header, read at least as leniently as OpenCode reads it. OpenCode
 * splits a patch on "\\n" only, so the path runs to that: a "\\r" or a Unicode
 * line separator inside it is part of the path, and it is trimmed as
 * OpenCode trims it.
 */
const PATCH_FILE = /^\\s*\\*\\*\\*\\s*(?:(?:Add|Update|Delete)\\s+File|Move\\s+to)\\s*:(?<path>[^\\n]*)$/iu;
/** Inwards' own files and this plugin, by where they are in the project; links to them count too. */
const OWN_FILES = [".opencode", ".inwards", "inwards-baseline.json", "opencode.json", "opencode.jsonc"];
/** Marks the messages the plugin sends, so they don't count as the user's. */
const OWN = "(sent by the Inwards plugin, not the user)";
const STOP_PREFACE = \`Inwards Stop gate \${OWN}: the turn can't end yet. Fix what follows, then finish your turn.\\n\\n\`;
const NOTE_PREFACE = \`Inwards \${OWN}: \`;
/** How many links to follow by hand before giving up on a path. */
const MAX_LINKS = 40;
/** How long one hook run may take, as Claude Code's default hook timeout. */
const HOOK_TIMEOUT_MS = 60000;

/**
 * Runs the hook with one payload, in the project init wrote the plugin into.
 *
 * @param payload - a hook payload, as Claude Code would send it.
 * @returns the exit code and both output streams; code -1 when Inwards couldn't start or was stopped.
 */
async function hook(payload) {
  try {
    const proc = Bun.spawn([...INWARDS, "hook", "claude-code"], {
      cwd: PROJECT,
      stdin: new TextEncoder().encode(JSON.stringify({ cwd: PROJECT, ...payload })),
      stdout: "pipe",
      stderr: "pipe",
      timeout: HOOK_TIMEOUT_MS,
      env: {
        ...process.env,
        CLAUDE_PROJECT_DIR: PROJECT,
        INWARDS_HOOK_HOST: "opencode",
        INWARDS_PLUGIN_SHA256: SELF,
      },
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return proc.signalCode
      ? { code: -1, stdout, stderr: \`inwards: stopped (\${proc.signalCode}); a hook run may take \${HOOK_TIMEOUT_MS / 1000} s\` }
      : { code, stdout, stderr };
  } catch (err) {
    return { code: -1, stdout: "", stderr: \`inwards: \${String(err)}\` };
  }
}

/**
 * Tells whether the hook failed instead of answering: it couldn't start, or
 * exited with neither 0 nor 2.
 *
 * @param result - what \`hook\` returned.
 * @returns true when nothing was checked.
 */
function broken(result) {
  return result.code !== 0 && result.code !== 2;
}

/**
 * Reads a field of the hook's JSON output.
 *
 * @param stdout - the hook's output.
 * @returns the parsed object, or an empty one.
 */
function output(stdout) {
  try {
    return JSON.parse(stdout) ?? {};
  } catch {
    return {};
  }
}

/**
 * Reads the reason out of a PreToolUse deny, if the hook denied.
 *
 * @param stdout - the hook's output.
 * @returns the reason (a default when the hook gave none), or undefined when the call may go ahead.
 */
function denial(stdout) {
  const decision = output(stdout).hookSpecificOutput;
  if (decision?.permissionDecision !== "deny") {
    return undefined;
  }
  return decision.permissionDecisionReason || "Inwards refused this call.";
}

/**
 * Resolves links in a path, a dangling one included, so an alias can't hide
 * a protected file. A path that doesn't exist yet resolves through its
 * nearest existing directory.
 *
 * @param path - an absolute path.
 * @param depth - links followed so far.
 * @returns the path with every link resolved that can be.
 */
function real(path, depth = 0) {
  try {
    return realpathSync(path);
  } catch {
    // missing, or a dangling link: go on by hand
  }
  if (depth > MAX_LINKS) {
    return path;
  }
  try {
    return real(resolve(dirname(path), readlinkSync(path)), depth + 1);
  } catch {
    // not a link
  }
  const parent = dirname(path);
  return parent === path ? path : join(real(parent, depth + 1), basename(path));
}

/**
 * Tells whether a path, as written or once its links are resolved, matches.
 *
 * @param pattern - PROTECTED or CONFIG.
 * @param path - an absolute path.
 * @returns true when either spelling matches.
 */
function names(pattern, path) {
  const p = String(path ?? "");
  return pattern.test(p) || pattern.test(real(p));
}

/**
 * Tells whether a path is, or lies inside, one of the project's own files
 * once links on both sides are resolved: \\\`settings.toml\\\` when
 * \\\`pyproject.toml\\\` links to it, say.
 *
 * @param path - an absolute path.
 * @param names - files of the project, relative to it.
 * @returns true when the path resolves into one of them.
 */
function resolvesTo(path, names) {
  const target = real(String(path ?? ""));
  return names.some((name) => {
    const own = real(join(PROJECT, name));
    return target === own || target.startsWith(own + sep);
  });
}

/**
 * Tells whether a path is Inwards' own: the plugin, the state, the baseline or OpenCode's config.
 *
 * @param path - an absolute path.
 * @returns true when no tool may change it without the user.
 */
function inwardsOwn(path) {
  return names(PROTECTED, path) || resolvesTo(path, OWN_FILES);
}

/**
 * Tells whether a path is a pyproject.toml, or a config reached through a
 * link: the file a \\\`pyproject.toml\\\` in its directory, or any directory
 * above it in the project, links to.
 *
 * @param path - an absolute path.
 * @returns true when the config guard must see the change.
 */
function configFile(path) {
  if (names(CONFIG, path) || resolvesTo(path, ["pyproject.toml"])) {
    return true;
  }
  const written = resolve(String(path ?? ""));
  const target = real(written);
  // The directories above the path as written, and above where it really is.
  return [
    [dirname(written), resolve(PROJECT)],
    [dirname(target), real(PROJECT)],
  ].some(([start, top]) => linksFromAbove(start, top, target));
}

/**
 * Tells whether a pyproject.toml in a directory, or in one above it up to
 * the project, links to a file.
 *
 * @param start - the first directory to look in.
 * @param top - the project directory, where the search stops.
 * @param target - the file's real path.
 * @returns true when one of them resolves to it.
 */
function linksFromAbove(start, top, target) {
  for (let dir = start; dir === top || dir.startsWith(top + sep); dir = dirname(dir)) {
    if (real(join(dir, "pyproject.toml")) === target) {
      return true;
    }
    if (dir === top) {
      break;
    }
  }
  return false;
}

/**
 * Makes a tool's path absolute, against the directory OpenCode runs in.
 *
 * @param directory - OpenCode's working directory.
 * @param path - the path the tool got.
 * @returns the absolute path, or the value as is when it isn't a string.
 */
function absolute(directory, path) {
  return typeof path === "string" && !isAbsolute(path) ? resolve(directory, path) : path;
}

/**
 * Maps an OpenCode tool's arguments to what the Claude Code tool of the same kind takes.
 *
 * @param tool - the OpenCode tool.
 * @param args - its arguments.
 * @param directory - OpenCode's working directory, for relative paths.
 * @returns the tool input the hook reads.
 */
function toolInput(tool, args, directory) {
  if (tool === "edit") {
    return {
      file_path: absolute(directory, args.filePath),
      old_string: args.oldString,
      new_string: args.newString,
      replace_all: args.replaceAll === true,
    };
  }
  if (tool === "write") {
    return { file_path: absolute(directory, args.filePath), content: args.content };
  }
  return { command: args.command };
}

/**
 * Tells whether OpenCode would change something other than the exact match
 * of an edit's oldString. Without exactly one exact match (or one at all,
 * with replaceAll) OpenCode tries looser matches: trimmed lines, collapsed
 * whitespace, a leading BOM dropped. The config guard simulates the exact,
 * normalised match only, so the two could change different lines. The
 * guard also drops a leading BOM from both strings and OpenCode doesn't, so
 * such an edit is never simulated as written.
 *
 * @param input - the edit's tool input, as the hook reads it.
 * @returns true when the edit's target is up to OpenCode's fallbacks.
 */
function inexact(input) {
  const from = String(input.old_string ?? "").replaceAll("\\r\\n", "\\n");
  if (from.startsWith("\\uFEFF") || String(input.new_string ?? "").startsWith("\\uFEFF")) {
    return true;
  }
  if (from === "") {
    return false; // creates a file, which the guard simulates
  }
  let text;
  try {
    // As OpenCode reads it: the BOM dropped, then the text matched as is.
    text = readFileSync(input.file_path, "utf8").replace(/^\\uFEFF/u, "").replaceAll("\\r\\n", "\\n");
  } catch {
    return false; // a missing file: the guard denies what it can't simulate
  }
  const first = text.indexOf(from);
  if (first === -1) {
    return true;
  }
  return !input.replace_all && text.lastIndexOf(from) !== first;
}

/**
 * Lists the files an apply_patch call touches.
 *
 * @param text - the patch.
 * @param directory - OpenCode's working directory.
 * @returns absolute paths.
 */
function patchedFiles(text, directory) {
  return String(text ?? "")
    .split("\\n")
    .map((line) => PATCH_FILE.exec(line)?.groups?.path?.trim() ?? "")
    .filter((path) => path !== "")
    .map((path) => absolute(directory, path));
}

/**
 * Tells whether a tool call reaches the config or Inwards' own files.
 *
 * @param tool - the OpenCode tool.
 * @param input - its tool input, as the hook reads it.
 * @returns true when a failed hook must not let it through.
 */
function touchesRules(tool, input) {
  if (tool === "bash") {
    return MENTIONS.test(String(input.command ?? ""));
  }
  return configFile(input.file_path) || inwardsOwn(input.file_path);
}

/**
 * Tells whether a message is one the plugin sent, and which kind.
 *
 * @param parts - the message's parts.
 * @returns "stop" for the Stop gate's, "note" for another, or undefined for the user's.
 */
function ownMessage(parts) {
  const text = (parts ?? []).map((p) => (typeof p?.text === "string" ? p.text : "")).join("");
  if (text.startsWith(STOP_PREFACE)) {
    return "stop";
  }
  return text.startsWith(NOTE_PREFACE) ? "note" : undefined;
}
`;
