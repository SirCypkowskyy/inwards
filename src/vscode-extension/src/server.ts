import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type Diagnostic as CoreDiagnostic,
  Engine,
  type ModuleLookup,
  moduleNameFor,
  parseConfig,
  probeLookup,
} from "@inwards/core";
import {
  createConnection,
  type Diagnostic,
  DiagnosticSeverity,
  ProposedFeatures,
  TextDocuments,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);
let state: { engine: Engine; root: string; ownerOf: ModuleLookup } | undefined;

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
      state = { engine, root, ownerOf: probeLookup((rel) => pathKind(root, rel)) };
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
    state.ownerOf,
  );
  connection.sendDiagnostics({ uri: document.uri, diagnostics: found.map(toLsp) });
});

/**
 * Tells what is at a path under the config root, for the INW006 module probe.
 *
 * @param root - the config root.
 * @param rel - a forward-slash path relative to it.
 * @returns "file", "dir", or undefined when nothing is there.
 */
function pathKind(root: string, rel: string): "file" | "dir" | undefined {
  const stat = statSync(join(root, rel), { throwIfNoEntry: false });
  if (stat?.isDirectory()) {
    return "dir";
  }
  return stat?.isFile() ? "file" : undefined;
}

/**
 * Reads one grammar file shipped next to dist/server.js.
 * The build copies both grammars there (see scripts/copy-wasm.ts), because
 * the extension runs on Node and cannot use Bun's embedded files.
 *
 * @param name - the file name, e.g. `tree-sitter-python.wasm`.
 * @returns the file's bytes.
 */
function wasm(name: string): Uint8Array {
  // biome-ignore lint/correctness/noGlobalDirnameFilename: the build emits CommonJS (see package.json), where __dirname is dist/.
  return new Uint8Array(readFileSync(join(__dirname, name)));
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
