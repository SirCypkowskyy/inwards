/**
 * Reads bench/corpus.json, the pinned repos bench/corpus.ts runs, and turns
 * an entry's layering into the `[tool.inwards]` table it is checked with.
 */
import { readFileSync } from "node:fs";

/** One layer of the `[tool.inwards]` table a repo is checked with. */
interface Layer {
  name: string;
  modules: string[];
}

/** One pinned repo from bench/corpus.json. */
export interface Repo {
  name: string;
  url: string;
  sha: string;
  license: string;
  why: string;
  /** Directories for a sparse checkout; the whole repo when absent. */
  paths?: string[];
  /** .py files in the checkout, the prescan test's expected corpus size. */
  pythonFiles: number;
  /** The single-file check's target, relative to the checkout. */
  file: string;
  config: { root: string; ignore?: string[]; layers: Layer[] };
}

/** A full commit SHA: a branch or tag would move. */
const SHA = /^[0-9a-f]{40}$/u;

/**
 * Tells whether a value is an array of strings.
 *
 * @param x - any value.
 * @returns true for `string[]`.
 */
function isStrings(x: unknown): x is string[] {
  return Array.isArray(x) && x.every((s) => typeof s === "string");
}

/**
 * Tells whether a value is a plain object.
 *
 * @param x - any value.
 * @returns true for a non-null, non-array object.
 */
export function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

/**
 * Tells whether a manifest's `config` has a root and well-formed layers.
 *
 * @param x - the `config` field of a manifest entry.
 * @returns true when it can be rendered as a `[tool.inwards]` table.
 */
function isConfig(x: unknown): x is Repo["config"] {
  return (
    isRecord(x) &&
    typeof x["root"] === "string" &&
    (x["ignore"] === undefined || isStrings(x["ignore"])) &&
    Array.isArray(x["layers"]) &&
    x["layers"].every(
      (l) => isRecord(l) && typeof l["name"] === "string" && isStrings(l["modules"]),
    )
  );
}

/**
 * Tells whether a manifest entry has every field bench/corpus.ts relies on,
 * with a full 40-character commit SHA.
 *
 * @param x - one element of `repos`.
 * @returns true for a valid entry.
 */
export function isRepo(x: unknown): x is Repo {
  return (
    isRecord(x) &&
    ["name", "url", "license", "why", "file"].every((k) => typeof x[k] === "string") &&
    typeof x["sha"] === "string" &&
    SHA.exec(x["sha"]) !== null &&
    (x["paths"] === undefined || isStrings(x["paths"])) &&
    Number.isInteger(x["pythonFiles"]) &&
    isConfig(x["config"])
  );
}

/**
 * Reads and validates the manifest.
 *
 * @param path - bench/corpus.json.
 * @returns the pinned repos.
 * @throws {Error} naming the first invalid entry.
 */
export function readManifest(path: string): Repo[] {
  const doc: unknown = JSON.parse(readFileSync(path, "utf8"));
  const repos = isRecord(doc) ? doc["repos"] : undefined;
  if (!Array.isArray(repos)) {
    throw new Error(`${path}: no "repos" array`);
  }
  return repos.map((entry: unknown, i) => {
    if (!isRepo(entry)) {
      throw new Error(`${path}: repos[${i}] is missing a field or has a bad SHA`);
    }
    return entry;
  });
}

/**
 * Renders a repo's config as a `[tool.inwards]` table. JSON strings and
 * arrays of them are valid TOML, so JSON.stringify does the quoting.
 *
 * @param config - the manifest's `config`.
 * @returns the TOML text.
 */
export function toml(config: Repo["config"]): string {
  const layers = config.layers.map(
    (l) => `  { name = ${JSON.stringify(l.name)}, modules = ${JSON.stringify(l.modules)} },`,
  );
  return [
    "[tool.inwards]",
    `root = ${JSON.stringify(config.root)}`,
    ...(config.ignore ? [`ignore = ${JSON.stringify(config.ignore)}`] : []),
    "layers = [",
    ...layers,
    "]",
    "",
  ].join("\n");
}
