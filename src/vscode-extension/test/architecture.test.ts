/**
 * @file The extension's boundaries (#176), as fallow applies them: the client
 * and the server each sit in their own zone, the client imports nothing of
 * ours, the server reaches only the engine's public API, and a file in a new
 * source folder has no zone, so fallow reports it until it gets one. The
 * answers come from `fallow guard`, not from re-reading the config.
 */
import { expect, test } from "bun:test";
import { join, resolve } from "node:path";

const REPO = resolve(import.meta.dir, "../../..");
const FALLOW = join(REPO, "node_modules/.bin/fallow");

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

test("the server reaches only the engine's public API", () => {
  const server = guard("src/vscode-extension/src/server/server.ts");
  expect(server.zone?.name).toBe("vscode-server");
  expect(reachable(server)).toEqual(["core-api"]);
});

test("a file in a new source folder has no zone, so fallow reports it", () => {
  const fresh = guard("src/vscode-extension/src/new-folder/module.ts");
  expect(fresh.zone).toBeNull();
  expect(fresh.boundary.coverage_required).toBe(true);
});
