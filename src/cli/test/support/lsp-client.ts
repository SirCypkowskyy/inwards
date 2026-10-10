/**
 * @file An LSP client for the `inwards server` tests, built on the protocol
 * library's own client side (`createProtocolConnection`), so a malformed frame
 * on the server's stdout fails the test instead of being skipped. It starts
 * the compiled binary in CI and `main.ts` under Bun locally (`run.ts`'s
 * `CMD`), and records what the server publishes and pops up.
 */
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import {
  createProtocolConnection,
  type Diagnostic,
  DidChangeTextDocumentNotification,
  DidChangeWatchedFilesNotification,
  DidChangeWorkspaceFoldersNotification,
  DidOpenTextDocumentNotification,
  DidSaveTextDocumentNotification,
  ExitNotification,
  type FileChangeType,
  InitializedNotification,
  InitializeRequest,
  type ProtocolConnection,
  PublishDiagnosticsNotification,
  RegistrationRequest,
  ShowMessageNotification,
  ShutdownRequest,
} from "vscode-languageserver/node";
import { CMD, TEST_ENV } from "./run.ts";

/** How long a test waits for the server to say something. */
const WAIT_MS = 15_000;
/** How often a wait looks again. */
const POLL_MS = 20;

/** A diagnostic as the server published it. */
export type Seen = Diagnostic;

/** A running `inwards server` and what it sent. */
export interface LspClient {
  /** The latest diagnostics per URI. */
  published: Map<string, Seen[]>;
  /** How many times each URI got diagnostics. */
  publishes: Map<string, number>;
  /** The error popups, oldest first. */
  popups: string[];
  /** Errors reading the server's stdout: a frame that isn't LSP. */
  errors: string[];
  /** What the server wrote to stderr. */
  stderr: () => string;
  /**
   * Opens a document.
   *
   * @param path - its absolute path.
   * @param text - its text.
   */
  open: (path: string, text: string) => void;
  /**
   * Replaces an open document's text.
   *
   * @param path - its absolute path.
   * @param text - the new text.
   */
  change: (path: string, text: string) => void;
  /**
   * Says a document was saved.
   *
   * @param path - its absolute path.
   */
  save: (path: string) => void;
  /**
   * Reports file events as a watching editor would.
   *
   * @param events - absolute paths with 1 created, 2 changed, 3 deleted.
   */
  files: (events: [string, FileChangeType][]) => void;
  /**
   * Adds a workspace folder.
   *
   * @param folder - its absolute path.
   */
  addFolder: (folder: string) => void;
  /**
   * Waits until a file's diagnostics satisfy a condition.
   *
   * @param path - the file's absolute path.
   * @param ready - the condition.
   * @returns the diagnostics then, or the last ones when time ran out.
   */
  diagnostics: (path: string, ready: (found: Seen[]) => boolean) => Promise<Seen[]>;
  /**
   * Waits until a condition holds.
   *
   * @param ready - the condition.
   */
  until: (ready: () => boolean) => Promise<void>;
  /**
   * Ends the session as an editor does: shutdown, exit, then waits for the process.
   *
   * @returns the server's exit code.
   */
  close: () => Promise<number | null>;
}

/**
 * Waits until a condition holds, or the deadline passes.
 *
 * @param ready - the condition.
 * @param deadline - when to give up, in `Date.now()` milliseconds.
 */
async function poll(ready: () => boolean, deadline: number): Promise<void> {
  while (!ready() && Date.now() < deadline) {
    // biome-ignore lint/performance/noAwaitInLoops: polling waits on purpose.
    await Bun.sleep(POLL_MS);
  }
}

/**
 * Turns a path into the URI an editor sends.
 *
 * @param path - an absolute path.
 * @returns the file URI.
 */
export function uri(path: string): string {
  return pathToFileURL(path).href;
}

/**
 * Records what the server sends: diagnostics, popups, and watcher registrations it asks for.
 *
 * @param connection - the client's connection.
 * @param client - where to record it.
 */
function record(
  connection: ProtocolConnection,
  client: Pick<LspClient, "published" | "publishes" | "popups">,
): void {
  connection.onNotification(PublishDiagnosticsNotification.type, ({ uri: at, diagnostics }) => {
    client.published.set(at, diagnostics);
    client.publishes.set(at, (client.publishes.get(at) ?? 0) + 1);
  });
  connection.onNotification(ShowMessageNotification.type, ({ type, message }) => {
    if (type === 1) {
      client.popups.push(message);
    }
  });
  connection.onRequest(RegistrationRequest.type, () => undefined);
}

/**
 * Starts `inwards server --stdio` and completes the handshake.
 *
 * @param folders - the workspace folders, absolute.
 * @param watching - true to announce file watching and folder changes, as VS Code does.
 * @returns the client.
 */
export async function startServer(folders: string[], watching = true): Promise<LspClient> {
  const [command = "", ...args] = CMD;
  const child = spawn(command, [...args, "server", "--stdio"], {
    env: TEST_ENV,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const { stdin, stdout, stderr } = child;
  if (stdin === null || stdout === null || stderr === null) {
    throw new Error("inwards server started without pipes");
  }
  let errText = "";
  stderr.on("data", (chunk: Buffer) => {
    errText += chunk.toString();
  });
  const connection = createProtocolConnection(stdout, stdin);
  const versions = new Map<string, number>();
  const popups: string[] = [];
  const errors: string[] = [];
  const client = {
    published: new Map<string, Seen[]>(),
    publishes: new Map<string, number>(),
    popups,
    errors,
  };
  connection.onError(([err]) => client.errors.push(String(err)));
  record(connection, client);
  connection.listen();
  const capabilities = watching
    ? {
        workspace: {
          didChangeWatchedFiles: { dynamicRegistration: true },
          workspaceFolders: true,
        },
      }
    : {};
  await connection.sendRequest(InitializeRequest.type, {
    processId: null,
    rootUri: null,
    capabilities,
    workspaceFolders: folders.map((f) => ({ uri: uri(f), name: f })),
  });
  await connection.sendNotification(InitializedNotification.type, {});
  /**
   * Sends a document's new text with the next version.
   *
   * @param path - its absolute path.
   * @param text - the document's whole new text.
   */
  function change(path: string, text: string): void {
    const version = (versions.get(path) ?? 1) + 1;
    versions.set(path, version);
    const params = { textDocument: { uri: uri(path), version }, contentChanges: [{ text }] };
    connection
      .sendNotification(DidChangeTextDocumentNotification.type, params)
      .catch(() => undefined);
  }
  return {
    ...client,
    stderr: (): string => errText,
    open(path: string, text: string): void {
      versions.set(path, 1);
      const textDocument = { uri: uri(path), languageId: "python", version: 1, text };
      connection
        .sendNotification(DidOpenTextDocumentNotification.type, { textDocument })
        .catch(() => undefined);
    },
    change,
    save(path: string): void {
      connection
        .sendNotification(DidSaveTextDocumentNotification.type, {
          textDocument: { uri: uri(path) },
        })
        .catch(() => undefined);
    },
    files(events: [string, FileChangeType][]): void {
      const changes = events.map(([path, type]) => ({ uri: uri(path), type }));
      connection
        .sendNotification(DidChangeWatchedFilesNotification.type, { changes })
        .catch(() => undefined);
    },
    addFolder(folder: string): void {
      const event = { added: [{ uri: uri(folder), name: folder }], removed: [] };
      connection
        .sendNotification(DidChangeWorkspaceFoldersNotification.type, { event })
        .catch(() => undefined);
    },
    async diagnostics(path: string, ready: (found: Seen[]) => boolean): Promise<Seen[]> {
      const at = uri(path);
      await poll(
        () => client.published.has(at) && ready(client.published.get(at) ?? []),
        Date.now() + WAIT_MS,
      );
      return client.published.get(at) ?? [];
    },
    until: (ready: () => boolean): Promise<void> => poll(ready, Date.now() + WAIT_MS),
    async close(): Promise<number | null> {
      await connection.sendRequest(ShutdownRequest.type);
      await connection.sendNotification(ExitNotification.type);
      // The exit code shows once the process is reaped.
      await poll(() => child.exitCode !== null || child.signalCode !== null, Date.now() + WAIT_MS);
      connection.dispose();
      return child.exitCode;
    },
  };
}
