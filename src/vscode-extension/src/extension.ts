import { join } from "node:path";
import type { ExtensionContext } from "vscode";
import {
  LanguageClient,
  type LanguageClientOptions,
  type ServerOptions,
  TransportKind,
} from "vscode-languageclient/node";

let client: LanguageClient | undefined;

/**
 * Starts the Inwards language server for Python files.
 * Thin client. All the thinking happens in server.ts, which wraps @inwards/core.
 * The server runs over IPC; debug mode opens the inspector on port 6010.
 *
 * @param context - VS Code's extension context, used to locate dist/server.js.
 */
export async function activate(context: ExtensionContext): Promise<void> {
  const module = context.asAbsolutePath(join("dist", "server.js"));
  const serverOptions: ServerOptions = {
    run: { module, transport: TransportKind.ipc },
    debug: { module, transport: TransportKind.ipc, options: { execArgv: ["--inspect=6010"] } },
  };
  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ scheme: "file", language: "python" }],
  };
  client = new LanguageClient("inwards", "Inwards", serverOptions, clientOptions);
  await client.start();
}

/**
 * Stops the language server when VS Code unloads the extension.
 * Does nothing if activation never started a client.
 */
export async function deactivate(): Promise<void> {
  await client?.stop();
}
