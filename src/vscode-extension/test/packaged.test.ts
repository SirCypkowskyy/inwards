/**
 * @file The extension as it ships (ADR-043). The test runs the real `build`
 * script into an emptied `dist/`, packages this machine's platform VSIX and
 * the universal one with `scripts/package-target.ts` as cd.yml does, and
 * unpacks both. The platform VSIX must hold the manifest's `main` and an
 * executable `bin/inwards`, the universal one no binary, and neither the
 * sources, tests or guides. It then lets the client's own lookup find the
 * binary in the unpacked VSIX and drives it as VS Code would, until it reports
 * a violation. The binary is `INWARDS_BIN` (CI's compiled one) or, locally, one
 * compiled from source into a temporary directory. `dist/` is rebuilt output;
 * the test removes it when done.
 */
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { packageTarget, TARGETS } from "../scripts/package-target.ts";
import { findServer } from "../src/client/binary.ts";
import { lspHarness, TIMEOUT_MS, write } from "./lsp-harness.ts";
import { extracted, unzip } from "./unzip.ts";

const PACKAGE = resolve(import.meta.dir, "..");
const REPO = resolve(PACKAGE, "../..");
const DIST = join(PACKAGE, "dist");
const STAGE = mkdtempSync(join(tmpdir(), "inwards-vsix-"));
/** VS Code's name for this machine's platform; glibc is assumed on Linux. */
const HOST = `${process.platform}-${process.arch}`;
const WINDOWS = process.platform === "win32";
/** The bundled binary, as the VSIX spells the path. */
const BUNDLED = `extension/bin/${WINDOWS ? "inwards.exe" : "inwards"}`;
/** The longest the build, a compile or a packaging may run before it is killed. */
const COMMAND_MS = 60_000;
/** The build, a compile and two packagings, with room to spare. */
const SETUP_MS: number = COMMAND_MS * 4;
/** The execute bits for owner, group and others. */
const EXECUTE = 0o111;
/** The `./` a manifest path may start with. */
const DOT_SLASH = /^\.\//u;
/**
 * Everything the universal VSIX holds: `vsce`'s own files, the manifest, the
 * README and licence, and the bundled client. `package.json`'s `files` lists
 * what ships, so sources, tests, guides and stray build output stay out.
 */
const SHIPPED = [
  "[Content_Types].xml",
  "extension.vsixmanifest",
  "extension/LICENSE.txt",
  "extension/dist/extension.js",
  "extension/package.json",
  "extension/readme.md",
];
/** A shape rule that reports `helpers.py` (INW007) as soon as the server checks the project. */
const PYPROJECT = `[tool.inwards]
layers = [{ name = "app", modules = ["app"] }]

[[tool.inwards.shape]]
packages = ["app.*"]
allow = ["router", "schemas", "utils"]
require = ["__init__", "router", "service"]
`;

let platformEntries: string[] = [];
let universalEntries: string[] = [];
const platformDir = join(STAGE, "platform");
const universalDir = join(STAGE, "universal");

/**
 * Runs a command and fails loudly when it fails.
 *
 * @param cmd - the command and its arguments.
 * @param cwd - where to run it.
 * @throws {Error} with the command's output when it exits non-zero or is
 *   killed for running past `COMMAND_MS`.
 */
function run(cmd: string[], cwd: string): void {
  const done = Bun.spawnSync(cmd, { cwd, timeout: COMMAND_MS, killSignal: "SIGKILL" });
  if (done.exitCode !== 0) {
    const how = done.exitCode === null ? `was killed after ${COMMAND_MS} ms` : "failed";
    throw new Error(`${cmd.join(" ")} ${how}:\n${done.stdout}${done.stderr}`);
  }
}

/**
 * Finds the binary to bundle: CI's compiled one, or one compiled now.
 *
 * @returns the binary's absolute path.
 */
function binary(): string {
  const given = process.env["INWARDS_BIN"];
  if (given !== undefined && given !== "") {
    return resolve(REPO, given);
  }
  const out = join(STAGE, WINDOWS ? "inwards.exe" : "inwards");
  // From STAGE: the compiler leaves a temporary file in its working directory.
  run(
    [process.execPath, "build", "--compile", join(REPO, "src/cli/src/main.ts"), "--outfile", out],
    STAGE,
  );
  return out;
}

beforeAll(() => {
  // Stale output from an earlier build could hide the layout this test pins.
  rmSync(DIST, { recursive: true, force: true });
  run([process.execPath, "run", "build"], PACKAGE);
  const universal = join(STAGE, "universal.vsix");
  packageTarget({ target: "universal", out: universal });
  universalEntries = unzip(readFileSync(universal), universalDir);
  if (!(HOST in TARGETS)) {
    throw new Error(`Inwards ships no binary for ${HOST}; run this test on a platform in TARGETS`);
  }
  const platform = join(STAGE, "platform.vsix");
  packageTarget({ target: HOST, binary: binary(), out: platform });
  platformEntries = unzip(readFileSync(platform), platformDir);
}, SETUP_MS);

afterAll(() => {
  rmSync(STAGE, { recursive: true, force: true });
  rmSync(DIST, { recursive: true, force: true });
});

/**
 * Reads the manifest's `main` as a VSIX entry name.
 *
 * @param dir - where the VSIX was unpacked.
 * @returns e.g. `extension/dist/extension.js`.
 */
function mainEntry(dir: string): string {
  const manifest: { main: string } = JSON.parse(
    readFileSync(extracted(dir, "extension/package.json"), "utf8"),
  );
  return `extension/${manifest.main.replace(DOT_SLASH, "")}`;
}

test("the universal VSIX holds the client and nothing else", () => {
  expect(SHIPPED).toContain(mainEntry(universalDir));
  expect(universalEntries.toSorted()).toEqual(SHIPPED);
  const vsixManifest = readFileSync(extracted(universalDir, "extension.vsixmanifest"), "utf8");
  expect(vsixManifest).not.toContain("TargetPlatform=");
});

test("this platform's VSIX holds the client and an executable binary", () => {
  expect(platformEntries.toSorted()).toEqual([...SHIPPED, BUNDLED].toSorted());
  const vsixManifest = readFileSync(extracted(platformDir, "extension.vsixmanifest"), "utf8");
  expect(vsixManifest).toContain(`TargetPlatform="${HOST}"`);
  // VS Code's installer applies the mode stored in the archive; Windows has none.
  const { mode } = statSync(extracted(platformDir, BUNDLED));
  // biome-ignore lint/suspicious/noBitwiseOperators: a mode is a bit set.
  const executable = WINDOWS || (mode & EXECUTE) === EXECUTE;
  expect(executable).toBe(true);
});

test(
  "the client finds the bundled binary, which starts as a server and reports a violation",
  async () => {
    const found = findServer({
      configured: "",
      bundledDir: extracted(platformDir, "extension/bin"),
      platform: process.platform,
      path: "",
      home: STAGE,
      workspaceFolder: undefined,
      isFile: (path: string): boolean =>
        statSync(path, { throwIfNoEntry: false })?.isFile() === true,
    });
    if (!("command" in found)) {
      throw new Error(found.problem);
    }
    expect(found).toEqual({ command: extracted(platformDir, BUNDLED), source: "bundled" });
    const root = join(STAGE, "project");
    write(root, {
      "pyproject.toml": PYPROJECT,
      "app/__init__.py": "",
      "app/orders/__init__.py": "",
      "app/orders/router.py": "",
      "app/orders/service.py": "",
      "app/orders/helpers.py": "",
    });
    const served = lspHarness([found.command, "server"]);
    try {
      await served.startServer(root);
      expect(
        await served.codesOnceIncluding(join(root, "app/orders/helpers.py"), "INW007"),
      ).toContain("INW007");
    } finally {
      await served.cleanup();
    }
  },
  TIMEOUT_MS * 2,
);
