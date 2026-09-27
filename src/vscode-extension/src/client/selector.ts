/**
 * @file Which documents the VS Code client syncs with the language server. Kept
 * apart from `extension.ts`, which needs the `vscode` module, so a test can
 * read it.
 */
/**
 * The documents the VS Code client syncs with the language server. Python
 * files are checked. pyproject.toml is synced only so that its saves reach
 * the server, which re-reads the config on save when the client can't watch
 * files; the server never checks it as Python. The language client drops
 * every notification, a save included, for a document outside this list.
 * Kept apart from extension.ts, which needs the `vscode` module, so a test
 * can read it.
 */
export const DOCUMENT_SELECTOR: { scheme: string; language?: string; pattern?: string }[] = [
  { scheme: "file", language: "python" },
  { scheme: "file", pattern: "**/pyproject.toml" },
];
