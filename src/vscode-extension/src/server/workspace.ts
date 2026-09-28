/**
 * @file The language server's view of the project on disk: the workspace pass
 * (INW007 and INW008 for every Python file under the config root, from a
 * directory listing alone) and the files behind the engine's module index.
 * The pass reads and parses nothing, so it reaches files the user hasn't
 * opened, and the `__init__.py` of a package that just lost a required member.
 * Like the CLI's walk, it skips nothing but hidden entries inside the layers'
 * top-level packages (`layerPackages`), so both index the same modules.
 */
import { type Dirent, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  checkRequired,
  checkShape,
  type Diagnostic,
  type InwardsConfig,
  type ListDir,
  layerPackages,
  membersFrom,
  moduleNameFor,
  type PathKind,
  type ProjectFiles,
  packagesOf,
} from "@inwards/core";

const PYTHON = /\.pyi?$/u;
/** Directories that never hold first-party code. */
const SKIP = new Set(["node_modules", "__pycache__"]);
/** Directories a file event can be ignored under: SKIP, and installed packages. */
const NOT_PROJECT = new Set([...SKIP, "site-packages"]);
/** Files Python can import a module from. */
const MODULE_FILE = /\.(?:py|pyi|so|pyd|pyx|pyc)$/u;

/**
 * Tells whether a created or deleted path can change what a module lookup
 * finds: a Python, stub or extension file, or a directory (a name without a
 * dot, since a deleted path can't be looked at), under the root and outside
 * hidden directories, caches, node_modules and installed packages. Inside a
 * layer's top-level package only hidden directories and compiled caches are
 * ignored, since the listing skips nothing else there.
 *
 * @param root - the config root, absolute.
 * @param path - the path the client reported, absolute.
 * @param open - the layers' top-level packages (`layerPackages`); none by default.
 * @returns false for events the language server can ignore.
 */
export function mayHoldModule(root: string, path: string, open: readonly string[] = []): boolean {
  const rel = relative(root, path);
  const parts = rel.split(sep);
  const inLayer = open.includes(parts[0] ?? "");
  const name = parts.at(-1) ?? "";
  const ignored = parts.some((p) => p.startsWith(".") || (!inLayer && NOT_PROJECT.has(p)));
  if (isAbsolute(rel) || ignored || (parts.includes("__pycache__") && name.endsWith(".pyc"))) {
    return false;
  }
  return !name.includes(".") || MODULE_FILE.test(name);
}

/** How the server reads one config's project; a config reload builds a new one. */
export interface ProjectView {
  /** The config root, absolute. */
  root: string;
  /** The files behind the module index; the layers' top-level packages are listed without skips. */
  files: ProjectFiles;
  /**
   * Tells whether a file event can change a module lookup, for this config's layers.
   *
   * @param root - the config root.
   * @param path - the event's absolute path.
   * @returns false for events the server can ignore.
   */
  holds: (root: string, path: string) => boolean;
}

/**
 * Builds the server's view of a config's project: where its root is, the
 * files the module index reads, and the file-event filter, both opening the
 * layers' top-level packages as the CLI's walk does.
 *
 * @param configPath - the pyproject.toml, absolute.
 * @param config - its parsed config.
 * @returns the view, rebuilt on every config reload.
 */
export function projectView(configPath: string, config: InwardsConfig): ProjectView {
  const root = resolve(dirname(configPath), config.root);
  const open = layerPackages(config);
  return {
    root,
    files: projectFiles(root, open),
    holds: (at: string, path: string): boolean => mayHoldModule(at, path, open),
  };
}

/**
 * Checks the shape of every Python file under the config root.
 *
 * @param config - the project's config.
 * @param root - the config root, absolute.
 * @returns the findings by absolute file path; empty when the config has no shapes or names.
 */
export function workspaceDiagnostics(
  config: InwardsConfig,
  root: string,
): Map<string, Diagnostic[]> {
  const found = new Map<string, Diagnostic[]>();
  if (config.shape === undefined && config.names === undefined) {
    return found;
  }
  const paths = pythonFiles(root, "", openDirs(root, layerPackages(config)));
  const diagnostics = [
    ...paths.flatMap((path) => checkShape({ path, text: "", ...moduleNameFor(path) }, config)),
    ...checkRequired(config, packagesOf(paths), membersFrom(paths)),
  ];
  for (const d of diagnostics) {
    const abs = join(root, d.file);
    found.set(abs, [...(found.get(abs) ?? []), d]);
  }
  return found;
}

/**
 * Gives the engine the files under the config root, for its module index.
 * Nothing is touched until the engine asks; the listing is the workspace
 * pass's, a file that vanished reads as empty, and `listDir` reads one directory.
 *
 * @param root - the config root, absolute.
 * @param open - the layers' top-level packages (`layerPackages`), listed without skips.
 * @returns the probe, listing and reader, with root-relative forward-slash paths.
 */
export function projectFiles(root: string, open: readonly string[]): ProjectFiles {
  return {
    kind: (rel: string): ReturnType<PathKind> => pathKind(root, rel),
    list: (): string[] => pythonFiles(root, "", openDirs(root, open)),
    read: (rel: string): string => {
      try {
        return readFileSync(join(root, rel), "utf8");
      } catch {
        return ""; // deleted since the listing
      }
    },
    listDir: (rel: string): ReturnType<ListDir> => {
      let entries: ReturnType<ListDir>;
      try {
        entries = readdirSync(join(root, rel), { withFileTypes: true }).map((entry) => ({
          name: entry.name,
          dir: entry.isDirectory(),
        }));
      } catch {
        // not a directory, or gone
      }
      return entries;
    },
  };
}

/**
 * Tells what is at a path under the config root, for the module probe.
 *
 * @param root - the config root.
 * @param rel - a forward-slash path relative to it.
 * @returns "file", "dir", or undefined when nothing is there.
 */
function pathKind(root: string, rel: string): ReturnType<PathKind> {
  const stat = statSync(join(root, rel), { throwIfNoEntry: false });
  if (stat?.isDirectory()) {
    return "dir";
  }
  return stat?.isFile() ? "file" : undefined;
}

/**
 * Names the layers' top-level package directories, as written and real, for
 * `pythonFiles` to list without skips.
 *
 * @param root - the config root.
 * @param open - the layers' top-level packages.
 * @returns absolute directories that exist.
 */
function openDirs(root: string, open: readonly string[]): string[] {
  return open.flatMap((pkg) => {
    const dir = join(root, pkg);
    const real = realOrUndefined(dir);
    return real === undefined ? [] : [...new Set([dir, real])];
  });
}

/**
 * Tells whether a directory is in a layer's top-level package or above one,
 * by the path it was reached through or its real path, as the CLI's walk decides.
 *
 * @param dir - an absolute directory, as reached.
 * @param open - the open directories (`openDirs`).
 * @returns true when nothing but hidden entries is skipped there.
 */
function isOpen(dir: string, open: readonly string[]): boolean {
  const spellings = [dir, realOrUndefined(dir)];
  return open.some((top) =>
    spellings.some((path) => path !== undefined && (within(top, path) || within(path, top))),
  );
}

/**
 * Lists the Python files below a directory, skipping hidden entries,
 * node_modules, __pycache__ and virtualenvs (a directory holding pyvenv.cfg),
 * except that inside a layer's top-level package (`open`) only hidden
 * entries are skipped. Symlinks are followed as Python follows them, but
 * only to targets inside the root, and a directory already on the way down
 * (a cycle) is not entered again: the same rules as the CLI's file walk.
 *
 * @param root - the config root.
 * @param rel - the directory to list, relative to the root with forward slashes.
 * @param open - the layers' top-level package directories (`openDirs`).
 * @param chain - the real paths of the directories above this one, updated in place.
 * @returns forward-slash paths relative to the root.
 */
function pythonFiles(
  root: string,
  rel: string,
  open: readonly string[],
  chain = new Set<string>(),
): string[] {
  const top = realOrUndefined(root);
  const real = realOrUndefined(join(root, rel));
  let entries: Dirent[];
  try {
    if (top === undefined || !within(top, real) || chain.has(real ?? "")) {
      return [];
    }
    entries = readdirSync(join(root, rel), { withFileTypes: true });
  } catch {
    return []; // deleted or unreadable while listing
  }
  const inLayer = isOpen(join(root, rel), open);
  if (rel !== "" && !inLayer && entries.some((e) => e.name === "pyvenv.cfg")) {
    return [];
  }
  chain.add(real ?? "");
  const found = entries.flatMap((entry) => {
    const path = rel === "" ? entry.name : `${rel}/${entry.name}`;
    const skip = SKIP.has(entry.name) && !(inLayer && isOpen(join(root, path), open));
    if (entry.name.startsWith(".") || skip) {
      return [];
    }
    const stat = statSync(join(root, path), { throwIfNoEntry: false });
    if (stat?.isDirectory()) {
      return pythonFiles(root, path, open, chain);
    }
    const inside = !entry.isSymbolicLink() || within(top, realOrUndefined(join(root, path)));
    return stat?.isFile() && inside && PYTHON.test(entry.name) ? [path] : [];
  });
  chain.delete(real ?? "");
  return found;
}

/**
 * Tells whether a real path is a directory or inside it.
 *
 * @param top - a real directory.
 * @param real - a real path, or undefined for a dangling one.
 * @returns true when `real` is `top` or below it.
 */
function within(top: string, real: string | undefined): boolean {
  return real === top || (real?.startsWith(top.endsWith(sep) ? top : `${top}${sep}`) ?? false);
}

/**
 * Resolves a path to its real location.
 *
 * @param path - any path.
 * @returns the canonical path, or undefined when it (or a link's target) doesn't exist.
 */
function realOrUndefined(path: string): string | undefined {
  let real: string | undefined;
  try {
    real = realpathSync(path);
  } catch {
    // dangling, or deleted while the pass ran
  }
  return real;
}
