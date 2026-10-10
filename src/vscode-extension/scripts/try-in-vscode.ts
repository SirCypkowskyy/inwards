/**
 * @file Checks an installed extension end to end in a real VS Code: it
 * installs a VSIX file or a Marketplace id into a throwaway profile, opens a
 * small project whose `helpers.py` breaks a package shape, and waits until VS
 * Code holds Inwards' INW007 diagnostic for it. It is the manual check for a
 * release on each OS (#64), not part of `bun test`: it opens a VS Code window
 * for a few seconds.
 *
 *   bun run scripts/try-in-vscode.ts <file.vsix | inwards.inwards-vscode> [code-cli]
 *
 * The VS Code command line defaults to `code` on PATH, then the macOS app's.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";

/** Where the macOS app keeps its command line, when `code` isn't on PATH. */
const MAC_CODE = "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code";
/** How long VS Code may take to start, activate the extension and show the diagnostic. */
const WAIT_MS = 90_000;
/** How often to look for the result. */
const POLL_MS = 500;
/** A project with one package-shape violation: `helpers.py` isn't an allowed member. */
const PROJECT: Readonly<Record<string, string>> = {
  "pyproject.toml": `[tool.inwards]
layers = [{ name = "app", modules = ["app"] }]

[[tool.inwards.shape]]
packages = ["app.*"]
allow = ["router", "schemas", "utils"]
require = ["__init__", "router", "service"]
`,
  "app/__init__.py": "",
  "app/orders/__init__.py": "",
  "app/orders/router.py": "",
  "app/orders/service.py": "",
  "app/orders/helpers.py": "",
};
/**
 * The test module VS Code runs inside its extension host: it opens
 * `helpers.py` and writes the diagnostics' `source:code` pairs (or `timeout`)
 * to the file `INWARDS_TRY_OUT` names.
 */
const PROBE = `const vscode = require("vscode");
const fs = require("fs");
exports.run = async function () {
  const out = process.env.INWARDS_TRY_OUT;
  const folder = vscode.workspace.workspaceFolders[0].uri;
  const uri = vscode.Uri.joinPath(folder, "app/orders/helpers.py");
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri));
  for (let i = 0; i < ${WAIT_MS / POLL_MS}; i++) {
    const found = vscode.languages.getDiagnostics(uri)
      .map((d) => d.source + ":" + (typeof d.code === "object" ? d.code.value : d.code));
    if (found.length > 0) { fs.writeFileSync(out, JSON.stringify(found)); return; }
    await new Promise((done) => setTimeout(done, ${POLL_MS}));
  }
  fs.writeFileSync(out, "timeout");
};
`;

/**
 * Runs the VS Code command line and fails loudly when it fails.
 *
 * @param code - the command line's path.
 * @param args - its arguments.
 * @param env - extra environment variables.
 * @throws {Error} with its output when it exits non-zero.
 */
function runCode(code: string, args: string[], env: Record<string, string> = {}): void {
  const done = Bun.spawnSync([code, ...args], { env: { ...process.env, ...env } });
  if (done.exitCode !== 0) {
    throw new Error(`${code} ${args.join(" ")} failed:\n${done.stdout}${done.stderr}`);
  }
}

/**
 * Waits for the probe's result file.
 *
 * @param path - the file the probe writes.
 * @returns its text, or `timeout` when nothing came.
 */
async function result(path: string): Promise<string> {
  const deadline = Date.now() + WAIT_MS + WAIT_MS;
  while (Date.now() < deadline && !existsSync(path)) {
    // biome-ignore lint/performance/noAwaitInLoops: polling one file until VS Code writes it.
    await Bun.sleep(POLL_MS);
  }
  return existsSync(path) ? readFileSync(path, "utf8") : "timeout";
}

/**
 * Installs the extension in a throwaway profile and checks its diagnostic.
 *
 * @param extension - a `.vsix` path or a Marketplace id.
 * @param code - the VS Code command line.
 * @returns 0 when VS Code showed INW007, 1 otherwise.
 */
async function main(extension: string, code: string): Promise<number> {
  const stage = mkdtempSync(join(tmpdir(), "inwards-try-"));
  try {
    const installed = join(stage, "extensions");
    const target = extension.endsWith(".vsix") ? resolve(extension) : extension;
    runCode(code, [
      "--extensions-dir",
      installed,
      "--user-data-dir",
      join(stage, "profile"),
      "--install-extension",
      target,
    ]);
    const dir = readdirSync(installed).find((name) => name.startsWith("inwards.inwards-vscode-"));
    if (dir === undefined) {
      throw new Error(`${extension} installed nothing named inwards.inwards-vscode-*`);
    }
    const project = join(stage, "project");
    for (const [rel, text] of Object.entries(PROJECT)) {
      mkdirSync(dirname(join(project, rel)), { recursive: true });
      writeFileSync(join(project, rel), text);
    }
    writeFileSync(join(stage, "probe.js"), PROBE);
    const out = join(stage, "result.json");
    // A second, empty extensions directory: the development path is the only Inwards loaded.
    runCode(
      code,
      [
        "--user-data-dir",
        join(stage, "run-profile"),
        "--extensions-dir",
        join(stage, "run-extensions"),
        `--extensionDevelopmentPath=${join(installed, dir)}`,
        `--extensionTestsPath=${join(stage, "probe.js")}`,
        "--disable-workspace-trust",
        project,
      ],
      { INWARDS_TRY_OUT: out },
    );
    const found = await result(out);
    process.stdout.write(`${dir}: ${found}\n`);
    return found.includes("INW007") ? 0 : 1;
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const [extension, code = Bun.which("code") ?? MAC_CODE] = process.argv.slice(2);
  if (extension === undefined) {
    process.stderr.write(
      "usage: try-in-vscode.ts <file.vsix | inwards.inwards-vscode> [code-cli]\n",
    );
    process.exit(2);
  }
  process.exit(await main(extension, code));
}
