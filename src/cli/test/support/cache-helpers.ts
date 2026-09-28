/**
 * @file Helpers for the extraction cache's storage tests (#56): stand-in
 * grammars, an identity for a text, the entry files under a project's cache,
 * and texts whose entries land in the same shard. The key is recomputed here
 * as the adapter documents it, so a test can aim at one shard.
 */
import { createHash } from "node:crypto";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { CachedExtraction, ExtractionIdentity } from "@inwards/core";

/** Stand-in grammar blobs: only their hash matters to the cache. */
export const WASM: { runtime: Uint8Array; python: Uint8Array } = {
  runtime: new Uint8Array([1, 2, 3]),
  python: new Uint8Array([4, 5, 6]),
};
export const SPAN: { line: number; column: number; endLine: number; endColumn: number } = {
  line: 1,
  column: 1,
  endLine: 1,
  endColumn: 10,
};
export const VALUE: CachedExtraction = {
  skeleton: [{ ...SPAN, target: "shop.db", statement: "import shop.db" }],
  comments: [{ span: SPAN, codes: ["INW001"], reason: "legacy", problems: [] }],
};

/**
 * An identity for a file's text.
 *
 * @param text - the file's text.
 * @param module - its module name.
 * @returns the identity at revision 1, not a package.
 */
export function id(text: string, module = "shop.domain.order"): ExtractionIdentity {
  return { revision: "1", text, module, isPackage: false };
}

/**
 * A value of roughly a given size, for filling a shard.
 *
 * @param bytes - about how big its JSON should be.
 * @returns one suppression comment with a long reason.
 */
export function sized(bytes: number): CachedExtraction {
  return { comments: [{ span: SPAN, codes: [], reason: "r".repeat(bytes), problems: [] }] };
}

/**
 * Lists every file under a project's cache, temporary files included.
 *
 * @param root - the project directory.
 * @returns the files' absolute paths.
 */
export function entryFiles(root: string): string[] {
  const base = join(root, ".inwards", "cache");
  const files: string[] = [];
  for (const ns of readdirSync(base)) {
    for (const shard of readdirSync(join(base, ns))) {
      for (const name of readdirSync(join(base, ns, shard))) {
        files.push(join(base, ns, shard, name));
      }
    }
  }
  return files;
}

/**
 * The key the adapter gives an identity: a SHA-256 of its fields, the text by its own SHA-256.
 *
 * @param identity - the file's text, module, package flag and revision.
 * @returns 64 hex digits.
 */
export function keyOf(identity: ExtractionIdentity): string {
  const text = createHash("sha256").update(identity.text).digest("hex");
  const fields = [identity.revision, identity.module, identity.isPackage, text];
  return createHash("sha256").update(JSON.stringify(fields)).digest("hex");
}

/**
 * Finds texts whose entries land in a given shard.
 *
 * @param shard - the shard's name, two hex digits.
 * @param count - how many texts.
 * @param prefix - what the texts start with, so two calls can differ.
 * @returns `<prefix> = N` texts, each in that shard.
 */
export function textsInShard(shard: string, count: number, prefix = "x"): string[] {
  const texts: string[] = [];
  for (let i = 0; texts.length < count; i += 1) {
    const text = `${prefix} = ${i}\n`;
    if (keyOf(id(text)).startsWith(shard)) {
      texts.push(text);
    }
  }
  return texts;
}

/**
 * Names the shard an entry file is in.
 *
 * @param entry - an entry file's path.
 * @returns the shard directory's name, two hex digits.
 */
export function shardOf(entry: string): string {
  return join(entry, "..").slice(-2);
}
