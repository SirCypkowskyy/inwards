/**
 * @file Which pass the language server runs for a batch of file events. A
 * config change reloads, a created or deleted module refreshes the index and
 * the workspace pass, and with contexts a saved Python file reindexes. A
 * batch adds up to the strongest pass any event needs.
 */
import { expect, test } from "bun:test";
import { FileChangeType } from "vscode-languageserver/node";
import { type EventContext, passFor, stronger } from "../src/server/file-events.ts";

const CONTEXT: EventContext = {
  configPath: "/p/pyproject.toml",
  root: "/p",
  contexts: true,
  mayHoldModule: (_root: string, path: string): boolean => path.startsWith("/p/shop"),
};

test("each kind of event asks for its pass", () => {
  const changed = FileChangeType.Changed;
  expect(passFor([{ type: changed, path: "/p/pyproject.toml" }], CONTEXT)).toBe("reload");
  expect(passFor([{ type: FileChangeType.Created, path: "/p/shop/a.py" }], CONTEXT)).toBe(
    "refresh",
  );
  expect(passFor([{ type: changed, path: "/p/shop/api.py" }], CONTEXT)).toBe("reindex");
  expect(passFor([{ type: changed, path: "/p/README.md" }], CONTEXT)).toBeUndefined();
  expect(passFor([{ type: changed, path: "/p/.venv/lib/x.py" }], CONTEXT)).toBeUndefined();
});

test("without contexts, a saved file changes nothing a check reads", () => {
  const events: { type: FileChangeType; path: string }[] = [
    { type: FileChangeType.Changed, path: "/p/shop/api.py" },
  ];
  expect(passFor(events, { ...CONTEXT, contexts: false })).toBeUndefined();
});

test("a batch runs the strongest pass it needs", () => {
  expect(stronger("reindex", "refresh")).toBe("refresh");
  expect(stronger(undefined, "reindex")).toBe("reindex");
  expect(stronger("reload", "reindex")).toBe("reload");
  expect(stronger(undefined, undefined)).toBeUndefined();
});
