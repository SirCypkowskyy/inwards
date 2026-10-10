/**
 * @file What the language server (`inwards server`, ADR-041) exchanges with the
 * editor, as plain data: the diagnostics it publishes, the messages it shows,
 * and the events the editor reports, already turned into absolute paths and
 * text. The LSP connection over stdio implements `Editor` and drives
 * `LanguageServer` (`adapters/lsp-connection.ts`); this folder never sees the
 * protocol library or a stream. Types only.
 */

/** A position in a document, 0-based, as LSP counts it. */
export interface LspPosition {
  line: number;
  character: number;
}

/** A diagnostic in LSP form, as `textDocument/publishDiagnostics` carries it. */
export interface LspDiagnostic {
  range: { start: LspPosition; end: LspPosition };
  /** 1 for an error, 2 for a warning. */
  severity: 1 | 2;
  /** The rule code, e.g. `INW001`; absent on a config error. */
  code?: string;
  /** The rule's docs page, which the editor links from the code. */
  codeDescription?: { href: string };
  source: "inwards";
  message: string;
}

/** What the server sends to the editor. */
export interface Editor {
  /**
   * Replaces a document's diagnostics; an empty list clears them.
   *
   * @param uri - the document's URI, as the editor spells it when it is open.
   * @param diagnostics - every diagnostic the document has now.
   */
  publish: (uri: string, diagnostics: LspDiagnostic[]) => void;
  /**
   * Pops up an error message.
   *
   * @param message - one line.
   */
  showError: (message: string) => void;
  /**
   * Writes a line to the editor's log for the server.
   *
   * @param message - the line.
   */
  log: (message: string) => void;
}

/** How a file changed on disk, as the editor's file watcher reports it. */
export type FileChange = "created" | "changed" | "deleted";

/** What the editor tells the server, with URIs already turned into absolute paths. */
export interface LanguageServer {
  /**
   * Starts checking: the first whole-project pass, after the handshake.
   *
   * @param folders - the workspace folders, absolute.
   */
  start: (folders: readonly string[]) => void;
  /**
   * A document was opened.
   *
   * @param doc - the document.
   * @param doc.uri - its URI, as the editor spells it.
   * @param doc.path - its absolute path.
   * @param doc.text - its text in the editor.
   * @param doc.version - its version, which grows with every change.
   */
  opened: (doc: { uri: string; path: string; text: string; version: number }) => void;
  /**
   * An open document's text changed in the editor.
   *
   * @param path - its absolute path.
   * @param text - its whole new text.
   * @param version - its new version.
   */
  changed: (path: string, text: string, version: number) => void;
  /**
   * An open document was saved.
   *
   * @param path - its absolute path.
   */
  saved: (path: string) => void;
  /**
   * An open document was closed; what is on disk counts for it again.
   *
   * @param path - its absolute path.
   */
  closed: (path: string) => void;
  /**
   * Files changed on disk, as the editor's watchers report them.
   *
   * @param events - each event's kind and absolute path.
   */
  filesChanged: (events: readonly { kind: FileChange; path: string }[]) => void;
  /**
   * Workspace folders were added or removed.
   *
   * @param added - the new folders, absolute.
   * @param removed - the folders gone, absolute.
   */
  foldersChanged: (added: readonly string[], removed: readonly string[]) => void;
  /**
   * Stops the timers, so nothing runs after the editor said exit.
   */
  stop: () => void;
}
