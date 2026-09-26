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
  ProposedFeatures,
  TextDocuments,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { projectFiles, workspaceDiagnostics } from "./workspace.ts";

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);
let state: { engine: Engine; config: InwardsConfig; root: string; index: ProjectIndex } | undefined;
/** The last workspace pass (INW007 and INW008 from the listing), by absolute path. */
let workspace = new Map<string, CoreDiagnostic[]>();
/** The full check of each open document, by absolute path. */
const opened = new Map<string, { uri: string; found: CoreDiagnostic[] }>();
/** How long file events are collected before the workspace pass reruns. */
const DEBOUNCE_MS = 100;
let pending: ReturnType<typeof setTimeout> | undefined;

connection.onInitialize(async (params) => {
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
documents.onDidChangeContent(({ document }) => {
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
    state.index,
  );
  opened.set(path, { uri: document.uri, found });
  publish(path);
});

documents.onDidClose(({ document }) => {
  const path = fileURLToPath(document.uri);
  opened.delete(path);
  publish(path);
});

// The workspace pass runs once at start and again when a Python file is
// created or deleted; a content change can't change a shape. The module index
// is rebuilt then too (free until a rule asks), as its contract says. Events are
// batched for a moment, so a branch switch runs one pass. The server asks the
// client to watch the files, so any LSP client works, not only VS Code.
connection.onInitialized(() => {
  if (state) {
    connection.client
      .register(DidChangeWatchedFilesNotification.type, { watchers: [{ globPattern: "**/*.py" }] })
      .catch((err: unknown) =>
        connection.console.warn(`Inwards can't watch files: ${String(err)}`),
      );
  }
  refresh();
});
connection.onDidChangeWatchedFiles(({ changes }) => {
  if (changes.every((change) => change.type === FileChangeType.Changed)) {
    return;
  }
  clearTimeout(pending);
  pending = setTimeout(refresh, DEBOUNCE_MS);
});

/**
 * Reruns the workspace pass and republishes the files whose findings changed.
 */
function refresh(): void {
  if (!state) {
    return;
  }
  const before = workspace;
  state.index = state.engine.index(projectFiles(state.root));
  workspace = workspaceDiagnostics(state.config, state.root);
  for (const path of new Set([...before.keys(), ...workspace.keys()])) {
    if (JSON.stringify(before.get(path)) !== JSON.stringify(workspace.get(path))) {
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
