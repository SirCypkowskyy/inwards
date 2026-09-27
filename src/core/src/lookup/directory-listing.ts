/**
 * @file The directory listings the engine asks an adapter for. INW008 needs a
 * package's members and the module index needs a directory's entries; both
 * come from the adapter's file system, never from the engine's own I/O.
 */

/**
 * Lists a package's direct members, the port INW008 needs from the adapter.
 *
 * @param pkg - a dotted package name under the config root.
 * @returns member names (`x.py`, `x.pyi`, `x/`), or undefined when the package doesn't exist.
 */
export type ListMembers = (pkg: string) => readonly string[] | undefined;

/** What an adapter's file system holds in a directory. */
export type ListDir = (relDir: string) => readonly { name: string; dir: boolean }[] | undefined;
