/**
 * @file Which `inwards` executable the extension starts as its language
 * server (ADR-043): the `inwards.path` setting when it is set, else the binary
 * bundled in this platform's VSIX, else `inwards` on PATH. It owns the lookup
 * order, the expansion of `~` and `${workspaceFolder}`, and the message shown
 * when nothing is found. No I/O and no `vscode` import: the caller passes the
 * environment and a file test, so the tests can play every platform.
 */
import { posix, win32 } from "node:path";

/** The program's name on every platform but Windows. */
const NAME = "inwards";
/** The placeholder VS Code users know from `launch.json` and tasks. */
// biome-ignore lint/suspicious/noTemplateCurlyInString lint/security/noSecrets: VS Code's literal placeholder, not a template.
const WORKSPACE_FOLDER = "${workspaceFolder}";
/** Double quotes around a Windows PATH entry. */
const QUOTES = /^"|"$/gu;

/** What the lookup needs to know about the machine and the window. */
export interface Lookup {
  /** The `inwards.path` setting, `""` when unset. */
  configured: string;
  /** The extension's `bin/` directory, where a platform VSIX keeps the binary. */
  bundledDir: string;
  /** `process.platform` of the extension host. */
  platform: string;
  /** The `PATH` environment variable, if any. */
  path: string | undefined;
  /** The user's home directory, for a leading `~`. */
  home: string;
  /** The first workspace folder's path, if the window has one. */
  workspaceFolder: string | undefined;
  /** Whether a regular file exists at an absolute path. */
  isFile: (path: string) => boolean;
}

/** An executable to start, and where the lookup found it. */
export interface Found {
  command: string;
  source: "setting" | "bundled" | "path";
}

/** Why no executable can be started, as a sentence for the user. */
export interface NotFound {
  problem: string;
}

/**
 * Finds the `inwards` executable to start as the language server.
 *
 * A set `inwards.path` wins and never falls back: a wrong path is reported, not
 * papered over with another binary of a different version. A bare name in it
 * (`inwards`) is looked up on PATH; anything with a separator is a path,
 * relative ones resolved against the first workspace folder. Without the
 * setting, the bundled binary comes first, so the server matches the
 * extension's version, and PATH is the fallback for platforms that have no
 * platform VSIX. On Windows only `inwards.exe` counts: Node can't spawn a
 * `.cmd` or `.bat` without a shell.
 *
 * @param lookup - the setting, the directories and the file test.
 * @returns the executable and its source, or the problem to show.
 */
export function findServer(lookup: Lookup): Found | NotFound {
  const path = lookup.platform === "win32" ? win32 : posix;
  const file = lookup.platform === "win32" ? `${NAME}.exe` : NAME;
  const configured = lookup.configured.trim();
  if (configured !== "") {
    return fromSetting(configured, lookup);
  }
  const bundled = path.join(lookup.bundledDir, file);
  if (lookup.isFile(bundled)) {
    return { command: bundled, source: "bundled" };
  }
  const onPath = searchPath(file, lookup);
  if (onPath !== undefined) {
    return { command: onPath, source: "path" };
  }
  return {
    problem:
      `Inwards found no \`${file}\` to start: this VS Code package bundles none for ` +
      `${lookup.platform}, it isn't on PATH, and the \`inwards.path\` setting is empty. ` +
      "Install the binary, or set `inwards.path` to it.",
  };
}

/**
 * Resolves the `inwards.path` setting to an executable.
 *
 * @param configured - the trimmed, non-empty setting.
 * @param lookup - the rest of the lookup.
 * @returns the executable, or why the setting points at nothing.
 */
function fromSetting(configured: string, lookup: Lookup): Found | NotFound {
  const path = lookup.platform === "win32" ? win32 : posix;
  if (configured.includes(WORKSPACE_FOLDER) && lookup.workspaceFolder === undefined) {
    return {
      problem: `The \`inwards.path\` setting (${configured}) uses ${WORKSPACE_FOLDER}, but no folder is open.`,
    };
  }
  const expanded = expand(configured, lookup);
  const bare = !(
    expanded.includes("/") ||
    (lookup.platform === "win32" && expanded.includes("\\"))
  );
  const command = bare
    ? searchPath(expanded, lookup)
    : path.resolve(lookup.workspaceFolder ?? lookup.home, expanded);
  if (command === undefined || !lookup.isFile(command)) {
    const where = bare ? "on PATH" : `at ${command ?? expanded}`;
    return {
      problem: `The \`inwards.path\` setting is ${configured}, and there is no file ${where}.`,
    };
  }
  return { command, source: "setting" };
}

/**
 * Expands `${workspaceFolder}` and a leading `~` in the setting.
 *
 * @param configured - the setting as the user wrote it.
 * @param lookup - the home directory and the workspace folder.
 * @returns the setting with both replaced.
 */
function expand(configured: string, lookup: Lookup): string {
  const folder = configured.replaceAll(WORKSPACE_FOLDER, lookup.workspaceFolder ?? "");
  if (folder === "~" || folder.startsWith("~/") || folder.startsWith("~\\")) {
    return `${lookup.home}${folder.slice(1)}`;
  }
  return folder;
}

/**
 * Looks a file name up in each PATH directory, in order.
 *
 * @param file - the executable's file name, `inwards.exe` on Windows; a bare
 *   name without `.exe` gets it added there.
 * @param lookup - PATH, the platform and the file test.
 * @returns the first match's absolute path, or undefined.
 */
function searchPath(file: string, lookup: Lookup): string | undefined {
  const windows = lookup.platform === "win32";
  const path = windows ? win32 : posix;
  const name = windows && !file.toLowerCase().endsWith(".exe") ? `${file}.exe` : file;
  // Windows allows quoted entries; a relative one would depend on the host's
  // working directory, so it is skipped.
  const dirs = (lookup.path ?? "")
    .split(windows ? ";" : ":")
    .map((dir) => dir.replace(QUOTES, ""))
    .filter((dir) => path.isAbsolute(dir));
  return dirs.map((dir) => path.join(dir, name)).find((candidate) => lookup.isFile(candidate));
}
