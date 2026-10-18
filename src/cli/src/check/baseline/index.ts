/**
 * @file The face of the baseline mini-domain: the baseline
 * file's name, reader and hashes that the session and the language
 * server read. Re-exports only.
 */

export {
  applyBaseline,
  BASELINE_FILE,
  baselineHashes,
  changedBaselines,
  readBaseline,
  writeBaseline,
} from "./_file.ts";
