import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  ConfigError,
  type Diagnostic as CoreDiagnostic,
  Engine,
  type InwardsConfig,
  moduleNameFor,
  type ProjectIndex,
} from "@inwards/core";
import {
  createConnection,
  type Diagnostic,
  DiagnosticSeverity,
  DidChangeWatchedFilesNotification,
  FileChangeType,
  type FileSystemWatcher,
  MessageType,
  ProposedFeatures,
  ShowMessageNotification,
  TextDocumentSyncKind,
  TextDocuments,
  WatchKind,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { type ConfigProblem, configDiagnostics, problemOf, readConfig } from "./config-file.ts";
import { mayHoldModule, projectFiles, workspaceDiagnostics } from "./workspace.ts";

/** A valid config and what the server built from it. */
interface State {
  engine: Engine;
  config: InwardsConfig;
  root: string;
  index: ProjectIndex;
}

/** The documents the engine checks, as the CLI does: Python sources and stubs. */
const PYTHON = /\.pyi?$/u;

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);
/** The engine for the current config; undefined without a config or while it is broken. */
let state: State | undefined;
/** The pyproject.toml at the root of the first workspace folder. */
let configPath: string | undefined;
/** The config's error while it has one. */
let problem: ConfigProblem | undefined;
/** The last workspace pass (INW007 and INW008 from the listing), by absolute path. */
let workspace = new Map<string, CoreDiagnostic[]>();
/** The full check of each open document, by absolute path. */
const opened = new Map<string, { uri: string; found: CoreDiagnostic[] }>();
/** What the client reports for modules: every path, created or deleted (a rename is both). */
const WATCHED: FileSystemWatcher = {
  globPattern: "**/*",
  kind: WatchKind.Create + WatchKind.Delete,
};
/** What the client reports for the config: created, changed or deleted. */
const CONFIG_WATCHED: FileSystemWatcher = { globPattern: "**/pyproject.toml" };
/**
 * Whether the client reports file events. Without them the index can't be
 * rebuilt at the right time, so each check builds its own (see `check`), and
 * the config is read again when the client saves it (see `onDidSave`).
 */
let watching = false;
/** Whether the module watcher is registered: once, when a config first parses. */
let modulesWatched = false;
/** How long file events are collected before the workspace pass reruns. */
const DEBOUNCE_MS = 100;
let pending: ReturnType<typeof setTimeout> | undefined;
/** Whether the events collected since the last pass include the config. */
let reread = false;
/** Reloads and passes run one after another, so an older config never lands last. */
let queue: Promise<void> = Promise.resolve();

connection.onInitialize((params) => {
  watching = params.capabilities.workspace?.didChangeWatchedFiles?.dynamicRegistration === true;
  const folder = params.workspaceFolders?.[0]?.uri;
  configPath = folder ? join(fileURLToPath(folder), "pyproject.toml") : undefined;
  // Full sync (the engine is fast enough), and saves for clients that can't watch files.
  return {
    capabilities: {
      textDocumentSync: { openClose: true, change: TextDocumentSyncKind.Full, save: true },
    },
  };
});

// Same engine, same rules as `inwards check`, run on every keystroke.
documents.onDidChangeContent(({ document }) => check(document));

/**
 * Checks an open document against the module index and publishes the result.
 * Without file events the shared index could keep a probe from before a
 * module was created, so each check then builds a fresh one (building is
 * free; only the probes the check makes cost anything). Without a valid
 * config it clears the document's findings instead. Only Python files are
 * checked: the client also syncs pyproject.toml, for its saves.
 *
 * @param document - the open document.
 */
function check(document: TextDocument): void {
  const path = fileURLToPath(document.uri);
  if (!PYTHON.test(path)) {
    return;
  }
  if (!state) {
    if (opened.delete(path)) {
      connection.sendDiagnostics({ uri: document.uri, diagnostics: [] });
    }
    return;
  }
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

// Closing drops the full check and leaves the workspace pass's findings. A
// document that was never checked (pyproject.toml, say) had nothing to drop.
documents.onDidClose(({ document }) => {
  const path = fileURLToPath(document.uri);
  if (opened.delete(path)) {
    publish(path);
  }
});

// A client that can't watch files still tells the server when it saves the
// config, if the config is open in it.
documents.onDidSave(({ document }) => {
  if (!watching && fileURLToPath(document.uri) === configPath) {
    enqueue(reload);
  }
});

// The workspace pass runs once at start and again when a file or directory
// that could be a module is created or deleted; a content change can't change
// a shape. The module index is rebuilt then too (free until a rule asks), as
// its contract says, and the open documents are checked again: creating the
// module an import names, as a .py, a .pyi, a compiled extension or a renamed
// directory, clears its INW010 without waiting for a keystroke. Any event on
// pyproject.toml, a content change included, reads the config again first.
// Events are batched for a moment, so a branch switch runs one pass. The
// server asks the client to watch the files, so any LSP client that supports
// it works, not only VS Code; a client that doesn't gets a fresh index per
// check instead.
connection.onInitialized(() => {
  if (configPath && watching) {
    watch(CONFIG_WATCHED);
  }
  enqueue(reload);
});
connection.onDidChangeWatchedFiles(({ changes }) => {
  const root = state?.root;
  const paths = changes.map((change) => ({ type: change.type, path: fileURLToPath(change.uri) }));
  const config = paths.some(({ path }) => path === configPath);
  const moved = paths.some(
    ({ type, path }) =>
      type !== FileChangeType.Changed && root !== undefined && mayHoldModule(root, path),
  );
  if (!(config || moved)) {
    return; // .git, caches, virtualenvs, docs: nothing a module lookup reads
  }
  reread = reread || config;
  clearTimeout(pending);
  pending = setTimeout(() => {
    enqueue(reread ? reload : refresh);
    reread = false;
  }, DEBOUNCE_MS);
});

/**
 * Asks the client to report events for one more set of paths.
 * A client that refuses gets the fallbacks of a client that can't watch.
 *
 * @param watcher - the glob and the kinds of event.
 */
function watch(watcher: FileSystemWatcher): void {
  connection.client
    .register(DidChangeWatchedFilesNotification.type, { watchers: [watcher] })
    .catch((err: unknown) => {
      watching = false;
      connection.console.warn(`Inwards can't watch files: ${String(err)}`);
    });
}

/**
 * Runs a reload or a pass after the ones already queued.
 *
 * @param task - the work to run.
 */
function enqueue(task: () => void | Promise<void>): void {
  queue = queue.then(task).catch((err: unknown) => connection.console.error(String(err)));
}

/**
 * Reads the config again and rebuilds the engine, then reruns the pass.
 * A config error turns checking off (the stale findings are cleared), goes
 * on pyproject.toml as a diagnostic, and pops up once: the same error after
 * another edit doesn't pop up again. A pyproject.toml without
 * `[tool.inwards]` is not an error; Inwards just has nothing to do there.
 */
async function reload(): Promise<void> {
  let next: State | undefined;
  let found: ConfigProblem | undefined;
  try {
    next = await load();
  } catch (err) {
    if (!(err instanceof ConfigError)) {
      connection.console.warn(`Inwards disabled: ${String(err)}`);
    }
    found = err instanceof ConfigError ? problemOf(err) : undefined;
  }
  const shown = problem?.message;
  problem = found;
  state = next;
  if (state && watching && !modulesWatched) {
    modulesWatched = true;
    watch(WATCHED);
  }
  if (problem && problem.message !== shown) {
    const message = `Inwards is off until pyproject.toml is fixed: ${problem.message.split("\n")[0]}`;
    connection.sendNotification(ShowMessageNotification.type, { type: MessageType.Error, message });
  }
  try {
    if (configPath && (problem || shown !== undefined)) {
      publish(configPath);
    }
  } finally {
    refresh(); // whatever publishing does, the stale findings go
  }
}

/**
 * Builds the engine for the config on disk.
 *
 * @returns the new state, or undefined when there is no Inwards config.
 * @throws {ConfigError} when the config is broken or can't be read.
 */
async function load(): Promise<State | undefined> {
  const config = configPath === undefined ? undefined : readConfig(configPath);
  if (configPath === undefined || config === undefined) {
    return undefined;
  }
  const engine = await Engine.create(
    { runtime: wasm("web-tree-sitter.wasm"), python: wasm("tree-sitter-python.wasm") },
    config,
  );
  const root = resolve(dirname(configPath), config.root);
  return { engine, config, root, index: engine.index(projectFiles(root)) };
}

/**
 * Rebuilds the module index, rechecks the open documents against it, reruns
 * the workspace pass and republishes the other files whose findings changed.
 * Without a valid config the pass finds nothing, which clears every file.
 */
function refresh(): void {
  const before = workspace;
  workspace = new Map();
  if (state) {
    state.index = state.engine.index(projectFiles(state.root));
    workspace = workspaceDiagnostics(state.config, state.root);
  }
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
 * workspace pass's INW008 for it, the workspace pass alone for a file
 * that isn't open, or the config error for pyproject.toml.
 *
 * @param path - the file's absolute path.
 */
function publish(path: string): void {
  if (path === configPath) {
    const diagnostics = configDiagnostics(path, problem);
    connection.sendDiagnostics({ uri: pathToFileURL(path).href, diagnostics });
    return;
  }
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
