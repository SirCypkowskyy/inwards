import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type Diagnostic as CoreDiagnostic,
  Engine,
  moduleNameFor,
  parseConfig,
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
let state: { engine: Engine; root: string } | undefined;

connection.onInitialize(async (params) => {
  const folder = params.workspaceFolders?.[0]?.uri;
  const configPath = folder ? join(fileURLToPath(folder), "pyproject.toml") : undefined;
  if (configPath && existsSync(configPath)) {
    try {
      const config = parseConfig(readFileSync(configPath, "utf8"));
      // build copies both grammars next to server.js, see scripts/copy-wasm.ts
      const wasm = (name: string) => new Uint8Array(readFileSync(join(__dirname, name)));
      const engine = await Engine.create(
        { runtime: wasm("web-tree-sitter.wasm"), python: wasm("tree-sitter-python.wasm") },
        config,
      );
      state = { engine, root: resolve(dirname(configPath), config.root) };
    } catch (err) {
      connection.console.warn(`Inwards disabled: ${String(err)}`);
    }
  }
  return { capabilities: { textDocumentSync: 1 } }; // full sync: the engine is fast enough
});

// Same engine, same rules as `inwards check`, run on every keystroke.
documents.onDidChangeContent(({ document }) => {
  if (!state) return;
  const path = fileURLToPath(document.uri);
  const found = state.engine.checkFile({
    path: relative(state.root, path),
    text: document.getText(),
    ...moduleNameFor(relative(state.root, path)),
  });
  connection.sendDiagnostics({ uri: document.uri, diagnostics: found.map(toLsp) });
});

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
