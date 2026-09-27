/**
 * @file Which pass the language server runs for a batch of file events. The
 * config changing means reading it again (`reload`); a module created or
 * deleted means rebuilding the index and rerunning the workspace pass
 * (`refresh`); with contexts, a saved Python file means rebuilding the index
 * and rechecking the open documents (`reindex`), since INW003's fix names the
 * public module that exposes a name, from that module's text. Events of a
 * batch add up to the strongest pass any of them needs.
 */
import { FileChangeType } from "vscode-languageserver/node";

/** A pass the server can run, strongest first. */
export type Pass = "reload" | "refresh" | "reindex";
const ORDER: readonly Pass[] = ["reload", "refresh", "reindex"];
const PYTHON = /\.pyi?$/u;

/** What a batch of events is judged against. */
export interface EventContext {
  /** The config file, if the server has one. */
  configPath: string | undefined;
  /** The config root, when the config is valid. */
  root: string | undefined;
  /** True when the config declares contexts. */
  contexts: boolean;
  /**
   * Tells whether a path could hold a module.
   *
   * @param root - the config root.
   * @param path - an absolute path.
   * @returns true for a path a module lookup could read.
   */
  mayHoldModule: (root: string, path: string) => boolean;
}

/**
 * Picks the pass one batch of events needs.
 *
 * @param events - each event's kind and absolute path.
 * @param context - the config and what it declares.
 * @returns the pass, or undefined when nothing a check reads changed.
 */
export function passFor(
  events: readonly { type: FileChangeType; path: string }[],
  context: EventContext,
): Pass | undefined {
  const { configPath, root, contexts, mayHoldModule } = context;
  if (events.some(({ path }) => path === configPath)) {
    return "reload";
  }
  const moved = events.some(
    ({ type, path }) =>
      type !== FileChangeType.Changed && root !== undefined && mayHoldModule(root, path),
  );
  if (moved) {
    return "refresh";
  }
  const edited = events.some(
    ({ type, path }) => type === FileChangeType.Changed && PYTHON.test(path),
  );
  return contexts && edited ? "reindex" : undefined;
}

/**
 * Combines two passes into the one that does both.
 *
 * @param a - one pass, if any.
 * @param b - another, if any.
 * @returns the stronger of the two.
 */
export function stronger(a: Pass | undefined, b: Pass | undefined): Pass | undefined {
  return ORDER.find((pass) => pass === a || pass === b);
}
