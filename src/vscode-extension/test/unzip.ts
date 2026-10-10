/**
 * @file Unpacks a zip archive (a VSIX is one), so the packaging test can look
 * at exactly what ships. It reads the central directory and inflates each
 * entry with `node:zlib`; GNU tar can't read zips and `unzip` isn't on every
 * runner. Stored and deflated entries are enough for what `vsce` writes. Like
 * VS Code's own installer, it gives each file the Unix mode the archive
 * stored, so the test sees whether the bundled binary stays executable.
 */
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { inflateRawSync } from "node:zlib";

/** "End of central directory" record signature. */
const END_OF_DIRECTORY = 0x06_05_4b_50;
/** Central directory entry signature. */
const DIRECTORY_ENTRY = 0x02_01_4b_50;
/** Compression methods: stored as is, or deflated. */
const STORED = 0;
const DEFLATED = 8;

/**
 * Extracts every file of a zip archive into a directory.
 *
 * @param zip - the archive's bytes.
 * @param into - the directory to extract into; created as needed.
 * @returns the entry names, as the archive spells them.
 * @throws {Error} when the bytes aren't a zip archive, an entry uses another
 *   compression method, or an entry would land outside `into`.
 */
export function unzip(zip: Uint8Array, into: string): string[] {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const { count, at: first } = centralDirectory(view);
  const names: string[] = [];
  let at = first;
  for (let i = 0; i < count; i += 1) {
    const entry = extractEntry(zip, view, at, resolve(into));
    names.push(entry.name);
    at = entry.next;
  }
  return names;
}

/**
 * Finds the central directory from the record at the end of the archive.
 *
 * @param view - the archive's bytes.
 * @returns how many entries it lists and the byte where the first starts.
 * @throws {Error} when there is no end-of-directory record.
 */
function centralDirectory(view: DataView): { count: number; at: number } {
  let end = view.byteLength - 22;
  while (end >= 0 && view.getUint32(end, true) !== END_OF_DIRECTORY) {
    end -= 1;
  }
  if (end < 0) {
    throw new Error("not a zip archive");
  }
  return { count: view.getUint16(end + 10, true), at: view.getUint32(end + 16, true) };
}

/**
 * Extracts the entry a central directory record describes.
 *
 * @param zip - the archive's bytes.
 * @param view - the same bytes, for reading numbers.
 * @param at - the byte where the directory record starts.
 * @param root - the absolute directory to extract into.
 * @returns the entry's name and the byte where the next record starts.
 * @throws {Error} when the record is broken, the entry uses another
 *   compression method, or it would land outside `root`.
 */
function extractEntry(
  zip: Uint8Array,
  view: DataView,
  at: number,
  root: string,
): { name: string; next: number } {
  if (view.getUint32(at, true) !== DIRECTORY_ENTRY) {
    throw new Error(`broken central directory at byte ${at}`);
  }
  const method = view.getUint16(at + 10, true);
  const size = view.getUint32(at + 20, true);
  const nameLength = view.getUint16(at + 28, true);
  const skip = nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
  // The upper half of the external attributes holds the Unix mode, when the archiver wrote one.
  // biome-ignore lint/suspicious/noBitwiseOperators: a mode is a bit set.
  const mode = (view.getUint32(at + 38, true) >>> 16) & 0o777;
  const local = view.getUint32(at + 42, true);
  const name = new TextDecoder().decode(zip.subarray(at + 46, at + 46 + nameLength));
  const dataAt = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
  const raw = zip.subarray(dataAt, dataAt + size);
  if (method !== STORED && method !== DEFLATED) {
    throw new Error(`${name} uses compression method ${method}`);
  }
  const target = resolve(root, name);
  if (!target.startsWith(`${root}${sep}`)) {
    throw new Error(`${name} would land outside ${root}`);
  }
  if (!name.endsWith("/")) {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, method === STORED ? raw : inflateRawSync(raw));
    if (mode !== 0) {
      chmodSync(target, mode);
    }
  }
  return { name, next: at + 46 + skip };
}

/**
 * Joins an archive entry name onto a directory, for reading an extracted file.
 *
 * @param dir - where the archive was extracted.
 * @param name - the entry name, with `/` separators.
 * @returns the extracted file's path.
 */
export function extracted(dir: string, name: string): string {
  return join(dir, ...name.split("/"));
}
