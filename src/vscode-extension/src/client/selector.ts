/**
 * @file Which documents the VS Code client syncs with the language server. Kept
 * apart from `extension.ts`, which needs the `vscode` module, so a test can
 * read it.
 */
/**
 * The documents the VS Code client syncs with the language server. Python
 * files are checked. Markdown, Mermaid and PlantUML files are synced so a
 * diagram that `[tool.inwards].diagrams` lists is checked as it is typed
 * (#348); the server checks only the listed ones and leaves the rest alone.
 * pyproject.toml is synced only so that its saves reach the server, which
 * re-reads the config on save when the client can't watch files; the server
 * never checks it as Python. The language client drops every notification, a
 * save included, for a document outside this list.
 */
export const DOCUMENT_SELECTOR: { scheme: string; language?: string; pattern?: string }[] = [
  { scheme: "file", language: "python" },
  { scheme: "file", language: "markdown" },
  { scheme: "file", pattern: "**/*.{md,markdown,mmd,mermaid,puml,plantuml,pu,iuml}" },
  { scheme: "file", pattern: "**/pyproject.toml" },
];
