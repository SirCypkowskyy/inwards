/**
 * @file Python sources a caller holds in memory, laid over the disk for one
 * check: the MCP server's `check_files` and `where_should_this_go` check text
 * an agent hasn't written yet. A file whose text is given reads as that text;
 * a file that doesn't exist yet also shows up in the probe, the directory
 * listings, the real paths and the walk, with any missing directories above
 * it, so routing, the module index and the check see it as if it were saved.
 * It only wraps the injected I/O: nothing here touches the disk, and nothing
 * is written.
 */
import { basename, dirname, join } from "node:path";
import type {
  DirEntry,
  FileReader,
  FileWalker,
  PathKind,
  PathProbe,
  WalkedFile,
} from "../platform/contracts.ts";
import type { ProjectIo } from "./contracts.ts";
import { atOrInside } from "./sources.ts";

/** The I/O a check and its routing read, which the overlay wraps. */
type Overlaid = Pick<ProjectIo, "probe" | "read" | "walk">;

/** The given texts, and which of their files and directories the disk lacks. */
interface Layer {
  /** Every given text, by absolute path, new file or not. */
  texts: ReadonlyMap<string, string>;
  /** Absolute files the disk doesn't have. */
  files: ReadonlySet<string>;
  /** Absolute directories the disk doesn't have, above those files. */
  dirs: ReadonlySet<string>;
}

/**
 * Sorts out which of the given files are new, and which directories above
 * them are missing.
 *
 * @param probe - tells what is on disk.
 * @param texts - the texts, by absolute path.
 * @returns the texts with their new files and directories.
 */
function layerOf(probe: Pick<PathProbe, "kind">, texts: ReadonlyMap<string, string>): Layer {
  const files = new Set<string>();
  const dirs = new Set<string>();
  for (const path of texts.keys()) {
    if (probe.kind(path) !== undefined) {
      continue;
    }
    files.add(path);
    for (let dir = dirname(path); dirname(dir) !== dir; dir = dirname(dir)) {
      if (probe.kind(dir) !== undefined) {
        break;
      }
      dirs.add(dir);
    }
  }
  return { texts, files, dirs };
}

/**
 * Tells whether a path exists only in the overlay.
 *
 * @param layer - the given texts with their new files and directories.
 * @param path - an absolute path.
 * @returns true for a new file or a missing directory above one.
 */
function isNew(layer: Layer, path: string): boolean {
  return layer.files.has(path) || layer.dirs.has(path);
}

/**
 * Tells what a path is, with the overlay's files and directories.
 *
 * @param probe - the disk's probe.
 * @param layer - the given texts with their new files and directories.
 * @param path - an absolute path.
 * @returns "file", "dir", or undefined when neither the overlay nor the disk has it.
 */
function kindOf(probe: PathProbe, layer: Layer, path: string): PathKind {
  if (layer.files.has(path)) {
    return "file";
  }
  return layer.dirs.has(path) ? "dir" : probe.kind(path);
}

/**
 * Resolves a path, with the overlay's: a new path's real path is its
 * nearest real ancestor's, plus the rest of the path.
 *
 * @param probe - the disk's probe.
 * @param layer - the given texts with their new files and directories.
 * @param path - an absolute path.
 * @returns the real path, or undefined when nothing is there.
 */
function realOf(probe: PathProbe, layer: Layer, path: string): string | undefined {
  if (!isNew(layer, path)) {
    return probe.realpath(path);
  }
  const parent = realOf(probe, layer, dirname(path));
  return parent === undefined ? undefined : join(parent, basename(path));
}

/**
 * Wraps the probe so the overlay's files and directories exist.
 *
 * @param probe - the disk's probe.
 * @param layer - the given texts with their new files and directories.
 * @returns the overlaid probe.
 */
function overlayProbe(probe: PathProbe, layer: Layer): PathProbe {
  return {
    ...probe,
    kind: (path: string): PathKind => kindOf(probe, layer, path),
    realpath: (path: string): string | undefined => realOf(probe, layer, path),
    exists: (path: string): boolean => kindOf(probe, layer, path) !== undefined,
    isLink: (path: string): boolean | undefined =>
      isNew(layer, path) ? false : probe.isLink(path),
  };
}

/**
 * Lists a directory with the overlay's new entries directly inside it.
 *
 * @param read - the disk's reader.
 * @param layer - the given texts with their new files and directories.
 * @param dir - an absolute directory.
 * @returns the entries, or undefined when neither the overlay nor the disk has the directory.
 */
function listOf(read: FileReader, layer: Layer, dir: string): DirEntry[] | undefined {
  const added = [...layer.files, ...layer.dirs]
    .filter((path) => dirname(path) === dir)
    .map((path) => {
      const isDir = layer.dirs.has(path);
      return { name: basename(path), dir: isDir, file: !isDir };
    });
  const listed = layer.dirs.has(dir) ? [] : read.list(dir);
  return listed === undefined && added.length === 0 ? undefined : [...(listed ?? []), ...added];
}

/**
 * Reads many files, the given texts from the overlay and the rest from disk
 * in one batch.
 *
 * @param read - the disk's reader.
 * @param layer - the given texts with their new files and directories.
 * @param paths - the files.
 * @returns their texts, in the order of `paths`.
 * @throws (as a rejected promise) when a file not in the overlay can't be read.
 */
async function textsOf(
  read: FileReader,
  layer: Layer,
  paths: readonly string[],
): Promise<string[]> {
  const wanted = paths.filter((path) => !layer.texts.has(path));
  const texts = await read.texts(wanted);
  const fromDisk = new Map(wanted.map((path, i) => [path, texts[i] ?? ""]));
  return paths.map((path) => layer.texts.get(path) ?? fromDisk.get(path) ?? "");
}

/**
 * Wraps the reader: a given text is read instead of the disk's, and a
 * directory lists the new files and directories directly inside it.
 *
 * @param read - the disk's reader.
 * @param layer - the given texts with their new files and directories.
 * @returns the overlaid reader.
 */
function overlayRead(read: FileReader, layer: Layer): FileReader {
  return {
    ...read,
    text: (path: string): string => layer.texts.get(path) ?? read.text(path),
    texts: (paths: readonly string[]): Promise<string[]> => textsOf(read, layer, paths),
    list: (dir: string): DirEntry[] | undefined => listOf(read, layer, dir),
  };
}

/**
 * Walks for Python sources with the overlay's new files: those under a walked
 * path join what the disk gives, and a path that exists only in the overlay
 * isn't handed to the disk's walk, which would fail on it.
 *
 * @param io - the disk's walk and the overlaid probe.
 * @param io.walk - the disk's walk.
 * @param io.probe - the overlaid probe, for real paths.
 * @param layer - the given texts with their new files and directories.
 * @param paths - files or directories.
 * @param open - directories walked without the skip rules.
 * @returns unique files, sorted by path.
 */
function sourcesOf(
  io: { walk: FileWalker; probe: PathProbe },
  layer: Layer,
  paths: string[],
  open: readonly string[] | undefined,
): WalkedFile[] {
  const onDisk = paths.filter((path) => !isNew(layer, path));
  const found = onDisk.length === 0 ? [] : io.walk.pythonSources(onDisk, open);
  const seen = new Set(found.map((file) => file.path));
  const added = [...layer.files]
    .filter((file) => !seen.has(file) && paths.some((path) => atOrInside(path, file)))
    .map((path) => ({ path, real: io.probe.realpath(path) }));
  return [...found, ...added].sort((a, b) => (a.path < b.path ? -1 : Number(a.path > b.path)));
}

/**
 * Wraps the walk so it finds the overlay's new files.
 *
 * @param walk - the disk's walk.
 * @param probe - the overlaid probe.
 * @param layer - the given texts with their new files and directories.
 * @returns the overlaid walk.
 */
function overlayWalk(walk: FileWalker, probe: PathProbe, layer: Layer): FileWalker {
  return {
    ...walk,
    pythonSources: (paths: string[], open?: readonly string[]): WalkedFile[] =>
      sourcesOf({ walk, probe }, layer, paths, open),
    pythonFiles: (paths: string[], open?: readonly string[]): string[] =>
      sourcesOf({ walk, probe }, layer, paths, open).map((file) => file.path),
  };
}

/**
 * Lays Python texts over the disk for one check: each given file reads as
 * its text, and a file that doesn't exist yet appears to exist, with any
 * missing directories above it. Without texts the I/O is returned as it is.
 *
 * @param io - the I/O to wrap.
 * @param texts - Python source texts, by absolute path.
 * @returns the same I/O, with the texts laid over the probe, the reader and the walk.
 */
export function overlayTexts<T extends Overlaid>(io: T, texts: ReadonlyMap<string, string>): T {
  if (texts.size === 0) {
    return io;
  }
  const layer = layerOf(io.probe, texts);
  const probe = overlayProbe(io.probe, layer);
  return {
    ...io,
    probe,
    read: overlayRead(io.read, layer),
    walk: overlayWalk(io.walk, probe, layer),
  };
}
