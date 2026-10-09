/**
 * @file Which file a path named at session start. The hooks excuse a file's old
 * violations, honour its old suppressions and pass its old package shape only
 * when the file is the same one the session started with (#134, #50, #169).
 * An agent can create symlinks, so "the same path" isn't enough: the
 * identity is the path as written (`..` applied as text) below the real
 * project root, and it exists only when that lexical path equals the file's
 * physical path and the file itself isn't a symlink (ADR-028). An alias the
 * agent creates (`alias -> original`, `cart.py -> cart.pyi`), a cwd or `..`
 * through one, or a start file replaced by a link gets no identity.
 *
 * The answers are cached per `StartIdentity`, which a hook creates once per
 * invocation, so nothing leaks between runs. The filesystem comes in through
 * the `PathProbe` contract.
 */
import { dirname, join, normalize, relative, resolve } from "node:path";
import { posix } from "../paths/lexical.ts";
import type { PathProbe } from "../platform/contracts.ts";
import type { Check, Start } from "./contracts.ts";

/** Start identity questions, answered with a per-invocation cache. */
export interface StartIdentity {
  /**
   * The identity of an absolute file: its project path when it names the
   * same file as at start, else undefined.
   *
   * @param project - the real project root.
   * @param file - the file, absolute, as checked.
   * @returns the project-relative path with forward slashes, or undefined.
   */
  startPath: (project: string, file: string) => string | undefined;
  /**
   * The identity of a reported file, or none when the path the agent wrote
   * for it (`Check.written`) names another identity.
   *
   * @param project - the real project root.
   * @param check - the report's base and the written paths.
   * @param file - the file as reported: absolute, or relative to `check.base`.
   * @returns the project-relative identity, or undefined.
   */
  identityOf: (
    project: string,
    check: Pick<Check, "base" | "written">,
    file: string,
  ) => string | undefined;
  /**
   * Tells whether a file existed at session start as itself.
   *
   * @param project - the real project root.
   * @param start - the session's start record, if there is one.
   * @param check - the base `file` is relative to, and the paths as written.
   * @param file - the file as reported: absolute, or relative to `check.base`.
   * @returns true when the file's start identity is in the start manifest.
   */
  existedAtStart: (
    project: string,
    start: Pick<Start, "manifest"> | undefined,
    check: Pick<Check, "base" | "written">,
    file: string,
  ) => boolean;
  /**
   * Lists the start-manifest files whose path no longer has a start identity.
   *
   * @param project - the real project root.
   * @param manifest - the start manifest.
   * @returns project-relative paths that still exist and lost their identity.
   */
  relinked: (project: string, manifest: Record<string, string>) => string[];
}

/** One invocation's probe and caches, which every identity question shares. */
interface Scope {
  probe: Pick<PathProbe, "realpath" | "isLink" | "exists">;
  /** `startPath` answers, by absolute file. */
  startPaths: Map<string, string | undefined>;
  /** Real paths of directories, since `startPath` asks for the same ancestors of every file. */
  realDirs: Map<string, string | undefined>;
}

/**
 * Creates the start identity checks for one invocation.
 *
 * @param probe - resolves real paths and tells symlinks and existence.
 * @returns the checks, sharing one cache.
 */
export function createStartIdentity(
  probe: Pick<PathProbe, "realpath" | "isLink" | "exists">,
): StartIdentity {
  const scope: Scope = { probe, startPaths: new Map(), realDirs: new Map() };
  return {
    startPath: (project: string, file: string): string | undefined =>
      startPath(scope, project, file),
    identityOf: (
      project: string,
      check: Pick<Check, "base" | "written">,
      file: string,
    ): string | undefined => identityOf(scope, project, check, file),
    existedAtStart(
      project: string,
      start: Pick<Start, "manifest"> | undefined,
      check: Pick<Check, "base" | "written">,
      file: string,
    ): boolean {
      const rel = identityOf(scope, project, check, file);
      return rel !== undefined && start?.manifest[rel] !== undefined;
    },
    relinked(project: string, manifest: Record<string, string>): string[] {
      // The content hash can be unchanged (`mv a.py saved.txt; ln -s saved.txt a.py`),
      // so the Stop gate checks these as changed files.
      return Object.keys(manifest).filter((rel) => {
        const file = join(project, rel);
        return probe.exists(file) && startPath(scope, project, file) !== rel;
      });
    },
  };
}

/**
 * Compares two paths by their normalised text, so a probe answering with
 * forward slashes (a stand-in, or a Windows API) still equals a joined path.
 *
 * @param a - a path, or undefined when it does not exist.
 * @param b - the path to compare with.
 * @returns true when both are the same text after normalisation.
 */
function samePath(a: string | undefined, b: string): boolean {
  return a !== undefined && normalize(a) === normalize(b);
}

/**
 * Resolves a directory, memoised.
 *
 * @param scope - the invocation's probe and caches.
 * @param dir - an absolute directory.
 * @returns its real path, or undefined when it doesn't exist.
 */
function realDir(scope: Scope, dir: string): string | undefined {
  if (!scope.realDirs.has(dir)) {
    scope.realDirs.set(dir, scope.probe.realpath(dir));
  }
  return scope.realDirs.get(dir);
}

/**
 * The identity a file is looked up by in the start record: its path as
 * written (`..` already applied as text), relative to the real project
 * root. The root is found as the outermost directory on that path whose
 * real path is the project, so a cwd spelled through a link to the whole
 * project (`/var` for `/private/var`) still matches. The file has an
 * identity only when that lexical path equals its physical one and the
 * file itself isn't a symlink (a missing file counts as one: no identity).
 *
 * @param scope - the invocation's probe and caches.
 * @param project - the real project root.
 * @param file - the file, absolute, as checked.
 * @returns the project-relative path with forward slashes, or undefined.
 */
function startPath(scope: Scope, project: string, file: string): string | undefined {
  if (!scope.startPaths.has(file)) {
    const ancestors: string[] = [];
    for (let dir = dirname(file); ancestors.at(-1) !== dir; dir = dirname(dir)) {
      ancestors.push(dir);
    }
    const root = ancestors.reverse().find((dir) => samePath(realDir(scope, dir), project));
    const rel = root === undefined ? undefined : posix(relative(root, file));
    const link = scope.probe.isLink(file) !== false;
    const direct =
      rel !== undefined && !link && samePath(scope.probe.realpath(file), join(project, rel));
    scope.startPaths.set(file, direct ? rel : undefined);
  }
  return scope.startPaths.get(file);
}

/**
 * The start identity of a checked file (`startPath`), or none when the path
 * the agent wrote for it names another identity: a `..` through a
 * symlinked directory the hook had to resolve to find the file.
 *
 * @param scope - the invocation's probe and caches.
 * @param project - the real project root.
 * @param check - the report's base and the written paths.
 * @param file - the file as reported: absolute, or relative to `check.base`.
 * @returns the project-relative identity, or undefined.
 */
function identityOf(
  scope: Scope,
  project: string,
  check: Pick<Check, "base" | "written">,
  file: string,
): string | undefined {
  const abs = resolve(check.base, file);
  const rel = startPath(scope, project, abs);
  const written = check.written?.get(abs);
  return written === undefined || startPath(scope, project, written) === rel ? rel : undefined;
}
