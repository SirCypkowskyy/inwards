/**
 * @file What each document shows, and sending only what changed. A file shows
 * the last whole pass's findings, except an open document whose text differs
 * from what that pass read: it shows its own check plus what only the pass
 * could find there. A broken config adds an error on its pyproject.toml.
 * Pure but for the editor it is handed.
 */
import { pathToFileURL } from "node:url";
import type { ConfigError, Diagnostic } from "@inwards/core";
import { PYTHON } from "./checks.ts";
import type { Editor, LspDiagnostic } from "./contracts.ts";
import { configDiagnostic, toLsp } from "./convert.ts";

/** An open document and what was last found in it. */
export interface OpenDoc {
  /** Its URI, as the editor spells it. */
  uri: string;
  path: string;
  text: string;
  version: number;
  /** The text the last whole pass read for this path, if known. */
  basis: string | undefined;
  /** The latest check of this document alone. */
  own: Diagnostic[];
  /** What the last whole pass found here that a check of this document alone doesn't. */
  extra: Diagnostic[];
  /** True while a check of this document alone is queued. */
  queued: boolean;
}

/** Everything the documents' diagnostics are made from. */
export interface View {
  /** The last whole pass's findings, by absolute path. */
  whole: ReadonlyMap<string, Diagnostic[]>;
  /** The open documents, by absolute path. */
  docs: ReadonlyMap<string, OpenDoc>;
  /** The last whole pass's config errors, by config path. */
  problems: ReadonlyMap<string, ConfigError>;
}

/**
 * Tells whether an open document shows its own check rather than the last
 * pass's findings: when its text isn't what the pass read.
 *
 * @param doc - the open document.
 * @returns true when it has changes the pass didn't see.
 */
function live(doc: OpenDoc): boolean {
  return PYTHON.test(doc.path) && doc.basis !== undefined && doc.text !== doc.basis;
}

/**
 * Works out every document's diagnostics.
 *
 * @param view - the pass, the open documents and the config errors.
 * @returns the diagnostics by URI: the editor's spelling for an open
 *   document, a file URI otherwise.
 */
function diagnosticsByUri(view: View): Map<string, LspDiagnostic[]> {
  const byPath = new Map<string, LspDiagnostic[]>();
  for (const [path, found] of view.whole) {
    byPath.set(path, found.map(toLsp));
  }
  for (const doc of view.docs.values()) {
    if (live(doc)) {
      byPath.set(doc.path, [...doc.own, ...doc.extra].map(toLsp));
    }
  }
  for (const [config, err] of view.problems) {
    byPath.set(config, [...(byPath.get(config) ?? []), configDiagnostic(err)]);
  }
  return new Map(
    [...byPath].map(([path, found]) => [
      view.docs.get(path)?.uri ?? pathToFileURL(path).href,
      found,
    ]),
  );
}

/**
 * Sends every document whose diagnostics changed, and clears the ones that
 * have none any more.
 *
 * @param editor - where diagnostics go.
 * @param shown - what each URI shows now, as JSON; updated in place.
 * @param view - what the diagnostics are made from.
 */
export function publish(editor: Editor, shown: Map<string, string>, view: View): void {
  const next = diagnosticsByUri(view);
  for (const [uri, found] of next) {
    const json = JSON.stringify(found);
    if (shown.get(uri) !== json) {
      shown.set(uri, json);
      editor.publish(uri, found);
    }
  }
  for (const uri of [...shown.keys()]) {
    if (!next.has(uri)) {
      shown.delete(uri);
      editor.publish(uri, []);
    }
  }
}
