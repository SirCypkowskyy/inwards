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
/** Patch headers as OpenCode reads them, with any spacing around the colon. */
const PATCH_FILE = /^[ \\t]*\\*\\*\\*[ \\t]*(?:(?:Add|Update|Delete)[ \\t]+File|Move[ \\t]+to)[ \\t]*:[ \\t]*(.*?)[ \\t]*$/gimu;
/** Marks the messages the plugin sends, so they don't count as the user's. */
const OWN = "(sent by the Inwards plugin, not the user)";
const STOP_PREFACE = \`Inwards Stop gate \${OWN}: the turn can't end yet. Fix what follows, then finish your turn.\\n\\n\`;
const NOTE_PREFACE = \`Inwards \${OWN}: \`;
/** How many links to follow by hand before giving up on a path. */
const MAX_LINKS = 40;

/**
 * Runs the hook with one payload, in the project init wrote the plugin into.
 *
 * @param payload - a hook payload, as Claude Code would send it.
 * @returns the exit code and both output streams; code -1 when Inwards couldn't start.
 */
async function hook(payload) {
  try {
    const proc = Bun.spawn([...INWARDS, "hook", "claude-code"], {
      cwd: PROJECT,
      stdin: new TextEncoder().encode(JSON.stringify({ cwd: PROJECT, ...payload })),
      stdout: "pipe",
      stderr: "pipe",
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
    return { code, stdout, stderr };
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
 * @returns the reason, or undefined when the call may go ahead.
 */
function denial(stdout) {
  const decision = output(stdout).hookSpecificOutput;
  return decision?.permissionDecision === "deny" ? decision.permissionDecisionReason : undefined;
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
 * Lists the files an apply_patch call touches.
 *
 * @param text - the patch.
 * @param directory - OpenCode's working directory.
 * @returns absolute paths.
 */
function patchedFiles(text, directory) {
  return [...String(text ?? "").matchAll(PATCH_FILE)].map((m) => absolute(directory, m[1]));
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
  return names(CONFIG, input.file_path) || names(PROTECTED, input.file_path);
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
