/**
 * @file The whole extension: a thin client that starts `inwards server` over
 * stdio for Python files and pyproject.toml (ADR-041, ADR-043) and stops it
 * when VS Code unloads the extension. It owns the settings (`inwards.enable`,
 * `inwards.path`), the restart command and the error shown when no binary is
 * found. All the checking happens in the binary; `binary.ts` decides which one.
 */
import { accessSync, chmodSync, constants, statSync } from "node:fs";
import { homedir } from "node:os";
import process from "node:process";
// biome-ignore lint/correctness/noUndeclaredDependencies: VS Code provides `vscode` at run time; @types/vscode types it.
import { commands, type ExtensionContext, env, Uri, window, workspace } from "vscode";
import {
  LanguageClient,
  type LanguageClientOptions,
  TransportKind,
} from "vscode-languageclient/node";
import { findServer } from "./binary.ts";
import { DOCUMENT_SELECTOR } from "./selector.ts";

/** Where the install guide explains the extension's settings. */
const INSTALL_GUIDE = "https://sircypkowskyy.github.io/inwards/guides/install/#vs-code";
const OPEN_SETTINGS = "Open Settings";
const SHOW_GUIDE = "Install Guide";
/** rwxr-xr-x, the mode `vsce` stores for the bundled binary. */
const EXECUTABLE = 0o755;

let client: LanguageClient | undefined;
/** Starts and stops run one after another, so a quick second change can't race the first. */
let queue: Promise<void> = Promise.resolve();

/**
 * Starts the language server and restarts it whenever an `inwards.*` setting
 * changes. Granting the workspace trust counts as one when the workspace sets
 * `inwards.path`: VS Code fires a configuration change for a restricted
 * setting then.
 *
 * @param context - VS Code's extension context: where the bundled binary is,
 *   and what to dispose of on unload.
 */
export async function activate(context: ExtensionContext): Promise<void> {
  context.subscriptions.push(
    commands.registerCommand("inwards.restartServer", () => restart(context)),
    workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("inwards")) {
        restart(context);
      }
    }),
  );
  restart(context);
  await queue;
}

/**
 * Stops the language server when VS Code unloads the extension.
 * Does nothing if no server is running.
 */
export async function deactivate(): Promise<void> {
  await queue;
  await stop();
}

/**
 * Queues a stop of the running server, then a start with the current settings.
 *
 * @param context - the extension context, for the bundled binary's directory.
 */
function restart(context: ExtensionContext): void {
  queue = queue
    .then(async () => {
      await stop();
      await start(context);
    })
    .catch((error: unknown) => {
      window.showErrorMessage(`Inwards: the language server failed to start: ${String(error)}`);
    });
}

/**
 * Stops the running server, if any, and forgets it. A client whose start
 * failed can refuse to stop; that refusal must not block the next start.
 */
async function stop(): Promise<void> {
  const running = client;
  client = undefined;
  await running?.stop().catch(() => undefined);
}

/**
 * Starts `inwards server` unless `inwards.enable` is off; when no binary is
 * found, says so with a way to the setting and the guide instead.
 *
 * @param context - the extension context, for the bundled binary's directory.
 */
async function start(context: ExtensionContext): Promise<void> {
  const settings = workspace.getConfiguration("inwards");
  if (!settings.get<boolean>("enable", true)) {
    return;
  }
  const found = findServer({
    configured: settings.get<string>("path", ""),
    bundledDir: context.asAbsolutePath("bin"),
    platform: process.platform,
    path: process.env["PATH"],
    home: homedir(),
    workspaceFolder: workspace.workspaceFolders?.[0]?.uri.fsPath,
    isFile,
  });
  if ("problem" in found) {
    offerHelp(found.problem);
    return;
  }
  if (found.source === "bundled") {
    makeExecutable(found.command);
  }
  const clientOptions: LanguageClientOptions = { documentSelector: DOCUMENT_SELECTOR };
  // TransportKind.stdio appends `--stdio`, which `inwards server` accepts.
  const server = { command: found.command, args: ["server"], transport: TransportKind.stdio };
  client = new LanguageClient("inwards", "Inwards", server, clientOptions);
  await client.start();
}

/**
 * Shows why the server can't start, with buttons to the setting and the guide.
 *
 * @param problem - the sentence `findServer` wrote.
 */
function offerHelp(problem: string): void {
  window.showErrorMessage(problem, OPEN_SETTINGS, SHOW_GUIDE).then(async (choice) => {
    if (choice === OPEN_SETTINGS) {
      await commands.executeCommand("workbench.action.openSettings", "inwards.path");
    } else if (choice === SHOW_GUIDE) {
      await env.openExternal(Uri.parse(INSTALL_GUIDE));
    }
  });
}

/**
 * Tells whether a regular file exists at a path.
 *
 * @param path - an absolute path.
 * @returns false for a directory, a missing path or one that can't be read.
 */
function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * Restores the bundled binary's execute bit on macOS and Linux if an unpacker
 * dropped it. VS Code keeps the mode `vsce` stored; this covers anything that
 * installs the VSIX differently. Windows has no execute bit.
 *
 * @param path - the bundled binary.
 */
function makeExecutable(path: string): void {
  if (process.platform === "win32") {
    return;
  }
  try {
    accessSync(path, constants.X_OK);
  } catch {
    try {
      chmodSync(path, EXECUTABLE);
    } catch {
      // A read-only install can't be changed; the spawn reports what fails.
    }
  }
}
