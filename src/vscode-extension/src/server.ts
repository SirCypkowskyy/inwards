import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  type Diagnostic as CoreDiagnostic,
  Engine,
  type InwardsConfig,
  moduleNameFor,
  type ProjectIndex,
  parseConfig,
} from "@inwards/core";
import {
  createConnection,
  type Diagnostic,
  DiagnosticSeverity,
  DidChangeWatchedFilesNotification,
  FileChangeType,
  type FileSystemWatcher,
  ProposedFeatures,
  TextDocuments,
  WatchKind,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { mayHoldModule, projectFiles, workspaceDiagnostics } from "./workspace.ts";

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);
let state: { engine: Engine; config: InwardsConfig; root: string; index: ProjectIndex } | undefined;
/** The last workspace pass (INW007 and INW008 from the listing), by absolute path. */
let workspace = new Map<string, CoreDiagnostic[]>();
/** The full check of each open document, by absolute path. */
const opened = new Map<string, { uri: string; found: CoreDiagnostic[] }>();
/** What the client reports: every path, created or deleted (a rename is both). */
const WATCHED: FileSystemWatcher = {
  globPattern: "**/*",
  kind: WatchKind.Create + WatchKind.Delete,
};
/**
 * Whether the client reports file events. Without them the index can't be
 * rebuilt at the right time, so each check builds its own (see `check`).
 */
let watching = false;
/** How long file events are collected before the workspace pass reruns. */
const DEBOUNCE_MS = 100;
let pending: ReturnType<typeof setTimeout> | undefined;

connection.onInitialize(async (params) => {
  watching = params.capabilities.workspace?.didChangeWatchedFiles?.dynamicRegistration === true;
  const folder = params.workspaceFolders?.[0]?.uri;
  const configPath = folder ? join(fileURLToPath(folder), "pyproject.toml") : undefined;
  if (configPath && existsSync(configPath)) {
    try {
      const config = parseConfig(readFileSync(configPath, "utf8"));
      const engine = await Engine.create(
        { runtime: wasm("web-tree-sitter.wasm"), python: wasm("tree-sitter-python.wasm") },
        config,
      );
      const root = resolve(dirname(configPath), config.root);
      state = { engine, config, root, index: engine.index(projectFiles(root)) };
    } catch (err) {
      connection.console.warn(`Inwards disabled: ${String(err)}`);
    }
  }
  return { capabilities: { textDocumentSync: 1 } }; // full sync: the engine is fast enough
});

// Same engine, same rules as `inwards check`, run on every keystroke.
documents.onDidChangeContent(({ document }) => check(document));

/**
 * Checks an open document against the module index and publishes the result.
 * Without file events the shared index could keep a probe from before a
 * module was created, so each check then builds a fresh one (building is
 * free; only the probes the check makes cost anything).
 *
 * @param document - the open document.
 */
function check(document: TextDocument): void {
  if (!state) {
    return;
  }
  const path = fileURLToPath(document.uri);
  const found = state.engine.checkFile(
    {
      path: relative(state.root, path),
      text: document.getText(),
      ...moduleNameFor(relative(state.root, path)),
    },
    watching ? state.index : state.engine.index(projectFiles(state.root)),
  );
  opened.set(path, { uri: document.uri, found });
  publish(path);
}

documents.onDidClose(({ document }) => {
  const path = fileURLToPath(document.uri);
  opened.delete(path);
  publish(path);
});

// The workspace pass runs once at start and again when a file or directory
// that could be a module is created or deleted; a content change can't change
// a shape. The module index is rebuilt then too (free until a rule asks), as
// its contract says, and the open documents are checked again: creating the
// module an import names, as a .py, a .pyi, a compiled extension or a renamed
// directory, clears its INW010 without waiting for a keystroke. Events are
// batched for a moment, so a branch switch runs one pass. The server asks the
// client to watch the files, so any LSP client that supports it works, not
// only VS Code; a client that doesn't gets a fresh index per check instead.
connection.onInitialized(() => {
  if (state && watching) {
    connection.client
      .register(DidChangeWatchedFilesNotification.type, { watchers: [WATCHED] })
      .catch((err: unknown) => {
        watching = false;
        connection.console.warn(`Inwards can't watch files: ${String(err)}`);
      });
  }
  refresh();
});
connection.onDidChangeWatchedFiles(({ changes }) => {
  const root = state?.root;
  const relevant = changes.filter(
    (change) =>
      change.type !== FileChangeType.Changed &&
      root !== undefined &&
      mayHoldModule(root, fileURLToPath(change.uri)),
  );
  if (relevant.length === 0) {
    return; // .git, caches, virtualenvs, docs: nothing a module lookup reads
  }
  clearTimeout(pending);
  pending = setTimeout(refresh, DEBOUNCE_MS);
});

/**
 * Rebuilds the module index, rechecks the open documents against it, reruns
 * the workspace pass and republishes the other files whose findings changed.
 */
function refresh(): void {
  if (!state) {
    return;
  }
  const before = workspace;
  state.index = state.engine.index(projectFiles(state.root));
  workspace = workspaceDiagnostics(state.config, state.root);
  for (const document of documents.all()) {
    check(document);
  }
  for (const path of new Set([...before.keys(), ...workspace.keys()])) {
    const changed = JSON.stringify(before.get(path)) !== JSON.stringify(workspace.get(path));
    if (changed && !opened.has(path)) {
      publish(path);
    }
  }
}

/**
 * Sends a file's diagnostics: an open document's full check plus the
 * workspace pass's INW008 for it, or the workspace pass alone for a file
 * that isn't open.
 *
 * @param path - the file's absolute path.
 */
function publish(path: string): void {
  const listed = workspace.get(path) ?? [];
  const open = opened.get(path);
  const found = open ? [...open.found, ...listed.filter((d) => d.code === "INW008")] : listed;
  const uri = open?.uri ?? pathToFileURL(path).href;
  connection.sendDiagnostics({ uri, diagnostics: found.map(toLsp) });
}

/**
 * Reads one grammar file shipped next to dist/server.js.
 * The build copies both grammars there (see scripts/copy-wasm.ts), because
 * the extension runs on Node and cannot use Bun's embedded files. The
 * directory comes from the running script: Bun's bundler writes the source
 * directory into `__dirname` at build time, which exists only on the build machine.
 *
 * @param name - the file name, e.g. `tree-sitter-python.wasm`.
 * @returns the file's bytes.
 */
function wasm(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(dirname(process.argv[1] ?? "."), name)));
}

/**
 * Converts an engine diagnostic to an LSP diagnostic.
 * LSP positions are 0-based; the engine's are 1-based. The message carries
 * the fix summary on a second line, since LSP has no field for it.
 *
 * @param d - the engine's diagnostic.
 * @returns the diagnostic in LSP form.
 */
function toLsp(d: CoreDiagnostic): Diagnostic {
  return {
    range: {
      start: { line: d.line - 1, character: d.column - 1 },
      end: { line: d.endLine - 1, character: d.endColumn - 1 },
    },
    severity: d.severity === "error" ? DiagnosticSeverity.Error : DiagnosticSeverity.Warning,
    code: d.code,
    codeDescription: { href: d.docs },
    source: "inwards",
    message: `${d.message}\n${d.fix.summary}`,
  };
}

documents.listen(connection);
connection.listen();
