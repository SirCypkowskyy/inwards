/**
 * @file The extension's boundaries (#176, ADR-043), as fallow applies them:
 * the client sits in its own zone and imports nothing of ours (the checking
 * happens in the `inwards` binary it starts), the tests and build scripts may
 * reach only the client, and a file in a new source folder has no zone, so
 * fallow reports it until it gets one. The answers come from `fallow guard`,
 * not from re-reading the config; the manifest check reads `package.json`.
 */
import { expect, setDefaultTimeout, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO = resolve(import.meta.dir, "../../..");
const FALLOW = join(REPO, "node_modules/.bin/fallow");

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
  for (const path of ["extension.ts", "binary.ts", "selector.ts"]) {
    const client = guard(`src/vscode-extension/src/client/${path}`);
    expect(client.zone?.name).toBe("vscode-client");
    expect(reachable(client)).toEqual([]);
  }
});

test("the tests and build scripts reach the client only", () => {
  for (const path of ["test/packaged.test.ts", "scripts/package-target.ts"]) {
    const dev = guard(`src/vscode-extension/${path}`);
    expect(dev.zone?.name).toBe("vscode-dev");
    expect(reachable(dev)).toEqual(["vscode-client"]);
  }
});

test("the shipped extension depends on the language client alone, not the engine", () => {
  const manifest: { dependencies: Record<string, string> } = JSON.parse(
    readFileSync(join(REPO, "src/vscode-extension/package.json"), "utf8"),
  );
  expect(Object.keys(manifest.dependencies)).toEqual(["vscode-languageclient"]);
});

test("a file in a new source folder has no zone, so fallow reports it", () => {
  const fresh = guard("src/vscode-extension/src/server/server.ts");
  expect(fresh.zone).toBeNull();
  expect(fresh.boundary.coverage_required).toBe(true);
});
