/**
 * @file The language server's LSP connection over stdio, with
 * `vscode-languageserver`: it reads JSON-RPC from stdin, writes it to stdout,
 * turns the editor's notifications into calls on the policy
 * (`lsp/session.ts`) and its publishes into `textDocument/publishDiagnostics`.
 * It asks the editor to watch files when the editor can, and follows
 * workspace folder changes. Stdout is the protocol's channel: nothing else
 * may write there (`main.ts` hands the server streams that write to stderr).
 * The library ends the process on `exit`, when stdin closes, and when the
 * editor's process (`initialize`'s `processId`) is gone.
 */
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  createConnection,
  DidChangeWatchedFilesNotification,
  FileChangeType,
  type FileSystemWatcher,
  type InitializeParams,
  type InitializeResult,
  MessageType,
  ShowMessageNotification,
  TextDocumentSyncKind,
  WatchKind,
} from "vscode-languageserver/node";
import type { Editor, FileChange, LanguageServer, LspDiagnostic } from "../lsp/contracts.ts";

/**
 * What the server asks the editor to report: any path created or deleted
 * (a module, a package directory, a renamed one), and content changes of the
 * files a check reads.
 */
const WATCHERS: FileSystemWatcher[] = [
  { globPattern: "**/*", kind: WatchKind.Create + WatchKind.Delete },
  {
    globPattern: "**/{*.py,*.pyi,pyproject.toml,inwards-baseline.json}",
    kind: WatchKind.Change,
  },
];

/**
 * Turns a `file:` URI into an absolute path.
 *
 * @param uri - a URI from the editor.
 * @returns the path, or undefined for another scheme.
 */
function pathOf(uri: string): string | undefined {
  return uri.startsWith("file:") ? fileURLToPath(uri) : undefined;
}

/**
 * Names the workspace folders the editor opened with: its folders, or the
 * root URI of an editor without folder support.
 *
 * @param params - the `initialize` request.
 * @returns the folders, absolute.
 */
function foldersOf(params: InitializeParams): string[] {
  const uris =
    params.workspaceFolders?.map((f) => f.uri) ?? (params.rootUri ? [params.rootUri] : []);
  return uris.flatMap((uri) => pathOf(uri) ?? []);
}

/**
 * Turns an LSP file event kind into the policy's.
 *
 * @param type - the event's kind.
 * @returns created, changed or deleted.
 */
function changeOf(type: FileChangeType): FileChange {
  if (type === FileChangeType.Created) {
    return "created";
  }
  return type === FileChangeType.Deleted ? "deleted" : "changed";
}

/** The connection the library makes over stdio. */
type StdioConnection = ReturnType<typeof createConnection>;

/**
 * Sends what the policy says to the editor over the connection. A send that
 * fails (the editor went away) is dropped; the library ends the process then.
 *
 * @param connection - the LSP connection.
 * @returns the editor link.
 */
function editorOver(connection: StdioConnection): Editor {
  return {
    publish(uri: string, diagnostics: LspDiagnostic[]): void {
      connection.sendDiagnostics({ uri, diagnostics }).catch(() => undefined);
    },
    showError(message: string): void {
      connection
        .sendNotification(ShowMessageNotification.type, { type: MessageType.Error, message })
        .catch(() => undefined);
    },
    log(message: string): void {
      connection.console.log(message);
    },
  };
}

/**
 * Answers the handshake, then registers the file watchers and follows
 * workspace folder changes when the editor supports them, and starts the
 * first pass.
 *
 * @param connection - the LSP connection.
 * @param server - the policy.
 * @param editor - the editor link, for the log.
 */
function handshake(connection: StdioConnection, server: LanguageServer, editor: Editor): void {
  let folders: string[] = [];
  let watch = false;
  let folderEvents = false;
  connection.onInitialize((params: InitializeParams): InitializeResult => {
    folders = foldersOf(params);
    const { workspace } = params.capabilities;
    watch = workspace?.didChangeWatchedFiles?.dynamicRegistration === true;
    folderEvents = workspace?.workspaceFolders === true;
    // Full sync: a check reads the whole text anyway. Saves start a pass.
    return {
      capabilities: {
        textDocumentSync: { openClose: true, change: TextDocumentSyncKind.Full, save: true },
        workspace: { workspaceFolders: { supported: true, changeNotifications: true } },
      },
    };
  });
  connection.onInitialized(() => {
    if (watch) {
      connection.client
        .register(DidChangeWatchedFilesNotification.type, { watchers: WATCHERS })
        .catch((err: unknown) => editor.log(`Inwards can't watch files: ${String(err)}`));
    }
    if (folderEvents) {
      connection.workspace.onDidChangeWorkspaceFolders(({ added, removed }) => {
        server.foldersChanged(
          added.flatMap((f) => pathOf(f.uri) ?? []),
          removed.flatMap((f) => pathOf(f.uri) ?? []),
        );
      });
    }
    server.start(folders);
  });
}

/**
 * Passes the documents' lifecycle and the watchers' file events to the
 * policy, as absolute paths. A URI with another scheme than `file:` is ignored.
 *
 * @param connection - the LSP connection.
 * @param server - the policy.
 */
function followDocuments(connection: StdioConnection, server: LanguageServer): void {
  connection.onDidOpenTextDocument(({ textDocument: { uri, text, version } }) => {
    const path = pathOf(uri);
    if (path !== undefined) {
      server.opened({ uri, path, text, version });
    }
  });
  connection.onDidChangeTextDocument(({ textDocument: { uri, version }, contentChanges }) => {
    const path = pathOf(uri);
    const last = contentChanges.at(-1);
    // Full sync: each change carries the whole text, and the last one counts.
    if (path !== undefined && last !== undefined && !("range" in last)) {
      server.changed(path, last.text, version);
    }
  });
  connection.onDidSaveTextDocument(({ textDocument: { uri } }) => {
    const path = pathOf(uri);
    if (path !== undefined) {
      server.saved(path);
    }
  });
  connection.onDidCloseTextDocument(({ textDocument: { uri } }) => {
    const path = pathOf(uri);
    if (path !== undefined) {
      server.closed(path);
    }
  });
  connection.onDidChangeWatchedFiles(({ changes }) => {
    server.filesChanged(
      changes.flatMap(({ uri, type }) => {
        const path = pathOf(uri);
        return path === undefined ? [] : [{ kind: changeOf(type), path }];
      }),
    );
  });
}

/**
 * Serves LSP on stdin and stdout until the editor ends the session.
 *
 * @param build - makes the policy, given what it sends to the editor.
 * @returns a promise that settles when the editor sends `exit`; the library
 *   then ends the process itself.
 */
export function serveLsp(build: (editor: Editor) => LanguageServer): Promise<number> {
  const connection = createConnection(process.stdin, process.stdout);
  const editor = editorOver(connection);
  const server = build(editor);
  handshake(connection, server, editor);
  followDocuments(connection, server);
  const exited = new Promise<number>((resolve) => {
    connection.onExit(() => {
      server.stop();
      resolve(0);
    });
  });
  connection.listen();
  return exited;
}
