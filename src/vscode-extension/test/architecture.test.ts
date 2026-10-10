/**
 * @file The extension's boundaries (#176), as fallow applies them: the client
 * and the server each sit in their own zone, the client imports nothing of
 * ours, the server reaches only the engine's public API, and a file in a new
 * source folder has no zone, so fallow reports it until it gets one. The
 * answers come from `fallow guard`, not from re-reading the config.
 */
import { expect, setDefaultTimeout, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO = resolve(import.meta.dir, "../../..");
const FALLOW = join(REPO, "node_modules/.bin/fallow");
/** A re-export's source in index.ts: its top folder and the next path segment. */
const REEXPORT = /from "\.\/(?<top>[^/"]+)\/(?<next>[^/"]+)/gu;
/** A TypeScript file suffix. */
const TS_SUFFIX = /\.ts$/u;

// Every test here starts `fallow guard` cold. A hosted ubuntu-24.04 runner
// took more than Bun's 5 s default for one call.
setDefaultTimeout(30_000);

/** What `fallow guard --format json` says about one file. */
interface Guarded {
  path: string;
  zone: { name: string } | null;
  boundary: {
    allowed_zones: string[];
    allowed_type_only_zones: string[];
    coverage_required: boolean;
  };
}

/**
 * Asks fallow which zone and edges apply to one file.
 *
 * @param path - a repo-relative path; it need not exist.
 * @returns fallow's answer.
 * @throws {Error} when fallow reports nothing for the path.
 */
function guard(path: string): Guarded {
  const run = Bun.spawnSync([FALLOW, "guard", "--format", "json", path], { cwd: REPO });
  const parsed: { files: Guarded[] } = JSON.parse(run.stdout.toString());
  const [file] = parsed.files;
  if (file === undefined) {
    throw new Error(`fallow guard said nothing about ${path}`);
  }
  return file;
}

/**
 * Lists every zone a file may import from, type-only edges included.
 *
 * @param file - fallow's answer for the file.
 * @returns the zone names, other than the file's own.
 */
function reachable(file: Guarded): string[] {
  return [...file.boundary.allowed_zones, ...file.boundary.allowed_type_only_zones]
    .filter((zone) => zone !== file.zone?.name)
    .sort();
}

test("the client imports nothing of ours", () => {
  const client = guard("src/vscode-extension/src/client/extension.ts");
  expect(client.zone?.name).toBe("vscode-client");
  expect(reachable(client)).toEqual([]);
});

/**
 * Lists the zones behind the engine's barrel: core-api itself and the zone of
 * every module `src/core/src/index.ts` re-exports from. fallow judges an
 * import through the barrel by the zone of the module behind it, so an
 * adapter that may use the public API is allowed exactly these.
 *
 * @returns the zone names, sorted.
 */
function publicApiZones(): string[] {
  const index = readFileSync(join(REPO, "src/core/src/index.ts"), "utf8");
  const zones = new Set(["core-api"]);
  for (const match of index.matchAll(REEXPORT)) {
    const top = match.groups?.["top"];
    const next = match.groups?.["next"];
    if (top === "rules" && next !== undefined) {
      zones.add(
        next === "shared" ? "core-rules-shared" : `core-rule-${next.replace(TS_SUFFIX, "")}`,
      );
    } else if (top !== undefined) {
      zones.add(`core-${top}`);
    }
  }
  return [...zones].sort();
}

test("the server reaches only the engine's public API", () => {
  const server = guard("src/vscode-extension/src/server/server.ts");
  expect(server.zone?.name).toBe("vscode-server");
  expect(reachable(server)).toEqual(publicApiZones());
});

test("a file in a new source folder has no zone, so fallow reports it", () => {
  const fresh = guard("src/vscode-extension/src/new-folder/module.ts");
  expect(fresh.zone).toBeNull();
  expect(fresh.boundary.coverage_required).toBe(true);
});
