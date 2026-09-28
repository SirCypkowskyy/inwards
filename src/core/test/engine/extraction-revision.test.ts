/**
 * @file Keeps `EXTRACTION_REVISION` honest (#56). A cached extraction is valid
 * only while the code that produced it is unchanged, so this test fingerprints
 * the files that decide what a text yields: normalisation and import
 * extraction, the prescan, module names, suppression-comment parsing, the
 * rule registry (whose codes a comment is checked against) and the extractor.
 * When one of them changes, bump the revision and record the new fingerprint.
 */
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { EXTRACTION_REVISION } from "../../src/engine/extraction.ts";

const REPO = resolve(import.meta.dir, "../../../..");
/** The files whose code decides what a text yields. */
const FILES = [
  "src/core/src/python/parser.ts",
  "src/core/src/python/prescan.ts",
  "src/core/src/python/module-names.ts",
  "src/core/src/rules/suppression-comment.ts",
  "src/core/src/meta/registry.ts",
  "src/core/src/engine/extraction.ts",
];
/** The fingerprint the current revision was recorded with. */
const RECORDED: Readonly<Record<string, string>> = {
  "1": "772064cde6ec46ab82c1f30cc8dc39de9ecd8c46870a6619cfb214b83f07c7b4",
  "2": "db0c5e3dee5bfa621e01f167e09b0a70e2dfa3da19c615edaddad6c20ab1f961",
  "3": "b3cff4906e54d42e15b86ec57a9bf290f82b57306a7678bbb4d9f0eb83e4bde3",
  "4": "dce845e98d20aebcb58eab84da50987beca8f8c463059aadc7752884b42cca6b",
  "5": "4dc1bad0c3318986d9e3e563cd7f45d18a99f3c68a24bd700d2738c279009ed8",
  "6": "9f22ad48d84883dd4aaf7136335904e39f2d42e93fecb88170f4079dec64ca86",
  "7": "edf5f500b209a96a72e313d0ec7f2c3527009e1b5773c174e809a94806c57d92",
};

test("the extraction revision changes with the code it describes", () => {
  const hash = createHash("sha256");
  for (const path of FILES) {
    hash.update(path);
    hash.update("\0");
    hash.update(readFileSync(join(REPO, path)));
    hash.update("\0");
  }
  const now = hash.digest("hex");
  const message =
    now === RECORDED[EXTRACTION_REVISION]
      ? "ok"
      : `Extraction code changed: bump EXTRACTION_REVISION in src/core/src/engine/extraction.ts and record "${now}" for it here.`;
  expect(message).toBe("ok");
});
