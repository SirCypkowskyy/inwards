/**
 * @file The extension as it ships. The test runs the real `build` script into
 * an emptied `dist/`, packages a VSIX with `vsce` as the release does, and
 * unpacks it: the manifest's `main` and the server with both grammars beside
 * it must be inside, and the tests and guides must not. It then starts the
 * server from the unpacked VSIX on Node, as VS Code does, until it reports a
 * violation, which it can only do once both grammars have loaded. The other
 * LSP tests bundle the server themselves, so they would pass with a broken
 * package. `dist/` is rebuilt output; the test removes it when done.
 */
import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { type Harness, lspHarness, PYPROJECT, TIMEOUT_MS, write } from "./lsp-harness.ts";
import { extracted, unzip } from "./unzip.ts";

const PACKAGE = resolve(import.meta.dir, "..");
const DIST = join(PACKAGE, "dist");
const STAGE = mkdtempSync(join(tmpdir(), "inwards-vsix-"));
const VSIX = join(STAGE, "inwards.vsix");
const UNPACKED = join(STAGE, "unpacked");
/** What VS Code needs from the package, as the VSIX spells the paths. */
const SHIPPED = [
  "extension/package.json",
  "extension/dist/server.js",
  "extension/dist/web-tree-sitter.wasm",
  "extension/dist/tree-sitter-python.wasm",
];
/** VS Code runs the extension host, and so the server, on Node. */
const NODE = Bun.which("node");
/** The build, the packaging and a server start, with room to spare. */
const SLOW_MS: number = TIMEOUT_MS * 2;
/** The `./` a manifest path may start with. */
const DOT_SLASH = /^\.\//u;
/** Entries that must not ship: sources, tests, build scripts and the agent guides. */
const NOT_SHIPPED = /\/(?:test|src|scripts)\/|AGENTS\.md|CLAUDE\.md/u;

const harness: Harness = lspHarness({
  server: extracted(UNPACKED, "extension/dist/server.js"),
  runtime: NODE ?? "node",
});
let entries: string[] = [];

/**
 * Runs a command in the extension package and fails loudly when it fails.
 *
 * @param cmd - the command and its arguments.
 * @throws {Error} with the command's output when it exits non-zero.
 */
function run(cmd: string[]): void {
  const done = Bun.spawnSync(cmd, { cwd: PACKAGE });
  if (done.exitCode !== 0) {
    throw new Error(`${cmd.join(" ")} failed:\n${done.stdout}${done.stderr}`);
  }
}

beforeAll(() => {
  // Stale output from an earlier build could hide the layout this test pins.
  rmSync(DIST, { recursive: true, force: true });
  run([process.execPath, "run", "build"]);
  run([
    process.execPath,
    "x",
    "vsce",
    "package",
    "--no-dependencies",
    "--allow-missing-repository",
    "-o",
    VSIX,
  ]);
  entries = unzip(readFileSync(VSIX), UNPACKED);
}, SLOW_MS);

afterAll(async () => {
  await harness.cleanup();
  rmSync(STAGE, { recursive: true, force: true });
  rmSync(DIST, { recursive: true, force: true });
});

test("the VSIX holds the manifest's main, the server and both grammars, and no tests", () => {
  const manifest: { main: string } = JSON.parse(
    readFileSync(extracted(UNPACKED, "extension/package.json"), "utf8"),
  );
  const main = `extension/${manifest.main.replace(DOT_SLASH, "")}`;
  expect(entries).toEqual(expect.arrayContaining([...SHIPPED, main]));
  expect(existsSync(extracted(UNPACKED, main))).toBe(true);
  expect(entries.filter((name) => NOT_SHIPPED.test(name))).toEqual([]);
});

test(
  "the shipped server runs on Node, loads its grammars and reports a violation",
  async () => {
    // Bun would hide a server that leans on a Bun-only API; VS Code has none.
    expect(NODE, "Node must be on PATH: VS Code runs the server on Node").not.toBeNull();
    const root = join(harness.tmp, "project");
    write(root, {
      "pyproject.toml": PYPROJECT,
      "app/__init__.py": "",
      "app/orders/__init__.py": "",
      "app/orders/router.py": "",
      "app/orders/service.py": "",
      "app/orders/helpers.py": "",
    });
    await harness.startServer(root, 1, {});
    expect(await harness.codesOnceIncluding(join(root, "app/orders/helpers.py"), "INW007")).toEqual(
      ["INW007"],
    );
  },
  SLOW_MS,
);
