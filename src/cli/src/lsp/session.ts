/**
 * @file The language server's policy (`inwards server`, ADR-041): when to check
 * what. A whole-project pass (`checkWorkspace`) runs at start, on a save,
 * when a workspace folder comes or goes, and when the file watchers report a
 * change that matters (`events.ts`), collected for 100 ms. A keystroke checks
 * only that document (`checkAlone`), and keeps the findings only a whole pass
 * can make (import cycles, cross-file FastAPI wiring) from the last pass.
 * Every check reads the config, the baseline and the listing again, so
 * nothing kept here can go stale; only the extraction cache bound into the
 * check lives longer. Checks run one at a time, in order. No I/O of its own.
 */
import type { ConfigError, Diagnostic } from "@inwards/core";
import { checkAlone, checkWorkspace, type ServerDeps, without } from "./checks.ts";
import type { FileChange, LanguageServer } from "./contracts.ts";
import { messageOf } from "./convert.ts";
import { needsPass } from "./events.ts";
import { type OpenDoc, publish } from "./publish.ts";

/** How long file events and saves are collected before a pass runs. */
const DEBOUNCE_MS = 100;

/**
 * Builds the language server's policy around an editor and a check.
 *
 * @param deps - the editor, the check, and what routing reads.
 * @returns the handlers the LSP connection calls.
 */
export function createLanguageServer(deps: ServerDeps): LanguageServer {
  return new Session(deps);
}

/** One editor session's state: the folders, the open documents and the last pass. */
class Session implements LanguageServer {
  readonly #deps: ServerDeps;
  #folders: string[] = [];
  readonly #docs = new Map<string, OpenDoc>();
  #whole = new Map<string, Diagnostic[]>();
  #problems = new Map<string, ConfigError>();
  /** The config errors already popped up, so the same one after an edit doesn't pop up again. */
  #popped = new Map<string, string>();
  /** What each URI shows now, as JSON, so only changes are sent. */
  readonly #shown = new Map<string, string>();
  #queue: Promise<void> = Promise.resolve();
  #timer: ReturnType<typeof setTimeout> | undefined;
  #passQueued = false;
  #started = false;
  #stopped = false;

  /**
   * Keeps the dependencies; nothing runs until `start`.
   *
   * @param deps - the editor, the check, and what routing reads.
   */
  constructor(deps: ServerDeps) {
    this.#deps = deps;
  }

  /**
   * Starts checking with the editor's workspace folders.
   *
   * @param folders - the workspace folders, absolute.
   */
  start(folders: readonly string[]): void {
    this.#folders = [...folders];
    this.#started = true;
    this.#queuePass();
  }

  /**
   * Starts tracking an opened document and checks it.
   *
   * @param doc - the document.
   * @param doc.uri - its URI, as the editor spells it.
   * @param doc.path - its absolute path.
   * @param doc.text - its text.
   * @param doc.version - its version.
   */
  opened({
    uri,
    path,
    text,
    version,
  }: {
    uri: string;
    path: string;
    text: string;
    version: number;
  }): void {
    const doc: OpenDoc = {
      uri,
      path,
      text,
      version,
      basis: undefined,
      own: [],
      extra: [],
      queued: false,
    };
    this.#docs.set(path, doc);
    this.#queueAlone(doc);
  }

  /**
   * Takes an open document's new text and checks it alone.
   *
   * @param path - its absolute path.
   * @param text - its whole new text.
   * @param version - its new version; an older one than known is ignored.
   */
  changed(path: string, text: string, version: number): void {
    const doc = this.#docs.get(path);
    if (doc === undefined || version < doc.version) {
      return;
    }
    doc.text = text;
    doc.version = version;
    this.#queueAlone(doc);
  }

  /**
   * Checks the workspace again soon after a save: other files' findings may
   * depend on the saved one.
   *
   * @param path - the saved document's absolute path.
   */
  saved(path: string): void {
    if (this.#docs.has(path)) {
      this.#schedulePass();
    }
  }

  /**
   * Stops tracking a closed document; the pass's findings for it show again,
   * and a pass runs when it had text the disk doesn't.
   *
   * @param path - its absolute path.
   */
  closed(path: string): void {
    const doc = this.#docs.get(path);
    if (doc === undefined) {
      return;
    }
    this.#docs.delete(path);
    if (doc.basis !== doc.text) {
      this.#schedulePass();
    }
    this.#enqueue(() => this.#publish());
  }

  /**
   * Checks the workspace again soon when a reported change matters.
   *
   * @param events - each event's kind and absolute path.
   */
  filesChanged(events: readonly { kind: FileChange; path: string }[]): void {
    if (needsPass(this.#folders, events)) {
      this.#schedulePass();
    }
  }

  /**
   * Follows the workspace folders and checks the workspace again.
   *
   * @param added - the new folders, absolute.
   * @param removed - the folders gone, absolute.
   */
  foldersChanged(added: readonly string[], removed: readonly string[]): void {
    this.#folders = [...this.#folders.filter((f) => !removed.includes(f)), ...added];
    if (this.#started) {
      this.#queuePass();
    }
  }

  /** Stops the timer and the queue, once the editor said exit. */
  stop(): void {
    this.#stopped = true;
    clearTimeout(this.#timer);
  }

  /**
   * Runs a task after the ones already queued; an error goes to the log.
   *
   * @param task - the work.
   */
  #enqueue(task: () => void | Promise<void>): void {
    this.#queue = this.#queue
      .then(task)
      .catch((err: unknown) => this.#deps.editor.log(`inwards server: ${messageOf(err)}`));
  }

  /** Queues a whole pass, unless one is queued already and hasn't started. */
  #queuePass(): void {
    if (this.#passQueued || this.#stopped) {
      return;
    }
    this.#passQueued = true;
    this.#enqueue(async () => {
      this.#passQueued = false;
      await this.#pass();
    });
  }

  /**
   * Queues a whole pass once events have stopped coming for a moment, so a
   * branch switch, or a save the watcher reports too, runs one pass.
   */
  #schedulePass(): void {
    if (!this.#started || this.#stopped) {
      return;
    }
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      this.#queuePass();
    }, DEBOUNCE_MS);
  }

  /**
   * The open documents' text, which every check reads instead of the disk's.
   *
   * @returns text by absolute path.
   */
  #texts(): Map<string, string> {
    return new Map([...this.#docs.values()].map((doc) => [doc.path, doc.text]));
  }

  /** Checks the whole workspace, settles the open documents and publishes what changed. */
  async #pass(): Promise<void> {
    const texts = this.#texts();
    const { found, errors } = await checkWorkspace(this.#deps, this.#folders, texts);
    this.#whole = found;
    this.#problems = errors;
    this.#popUp();
    for (const [path, text] of texts) {
      const doc = this.#docs.get(path);
      if (doc !== undefined) {
        // biome-ignore lint/performance/noAwaitInLoops: checks run one at a time, in order.
        const own = await checkAlone(this.#deps, path, texts);
        doc.basis = text;
        doc.extra = without(found.get(path) ?? [], own);
        if (doc.text === text) {
          doc.own = own;
        }
      }
    }
    this.#publish();
  }

  /**
   * Queues a check of one open document alone, unless one is queued already:
   * the queued one reads the latest text when it runs.
   *
   * @param doc - the open document.
   */
  #queueAlone(doc: OpenDoc): void {
    if (doc.queued) {
      return;
    }
    doc.queued = true;
    this.#enqueue(async () => {
      doc.queued = false;
      if (this.#docs.get(doc.path) !== doc) {
        return; // closed meanwhile
      }
      const { text, path } = doc;
      const own = await checkAlone(this.#deps, path, this.#texts());
      if (doc.text === text) {
        doc.own = own;
      }
      if (doc.basis === undefined) {
        // Opened after the last pass, which read the disk.
        doc.basis = this.#diskText(path);
        doc.extra = without(this.#whole.get(path) ?? [], own);
      }
      this.#publish();
    });
  }

  /**
   * Reads a file as the last pass did, for a document opened after it.
   *
   * @param path - an absolute path.
   * @returns its text, or undefined when it can't be read (a new file).
   */
  #diskText(path: string): string | undefined {
    try {
      return this.#deps.io.read.text(path);
    } catch {
      return undefined;
    }
  }

  /**
   * Pops up each config error once: a new or changed message pops up, the
   * same one after another edit doesn't.
   */
  #popUp(): void {
    const next = new Map<string, string>();
    for (const [config, err] of this.#problems) {
      next.set(config, err.message);
      if (this.#popped.get(config) !== err.message) {
        const first = err.message.split("\n")[0] ?? err.message;
        this.#deps.editor.showError(`Inwards is off for ${config} until it is fixed: ${first}`);
      }
    }
    this.#popped = next;
  }

  /** Sends the diagnostics that changed. */
  #publish(): void {
    publish(this.#deps.editor, this.#shown, {
      whole: this.#whole,
      docs: this.#docs,
      problems: this.#problems,
    });
  }
}
