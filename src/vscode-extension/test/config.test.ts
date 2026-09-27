import { afterAll, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { DOCUMENT_SELECTOR } from "../src/client/selector.ts";
import { openProject, UNKNOWN_CODE } from "./config-helpers.ts";
import {
  type Harness,
  lspHarness,
  PYPROJECT,
  QUIET_MS,
  until,
  WATCHING,
  write,
} from "./lsp-harness.ts";

// The language server re-reads pyproject.toml when it changes, and shows a
// config error in the editor instead of only in its output channel (#163).
const harness: Harness = lspHarness();
const {
  tmp: TMP,
  published,
  codesOnceIncluding,
  diagnosticsOnce,
  popups,
  cleanup,
}: Harness = harness;
afterAll(cleanup);

test("a config error pops up once, sits on pyproject.toml, and clears when fixed", async () => {
  const from = popups().length;
  const { server, config, router, edit } = await openProject(
    harness,
    "broken",
    PYPROJECT,
    WATCHING,
  );
  try {
    expect(await codesOnceIncluding(router, "INW010")).toEqual(["INW010"]);

    // Broken TOML: the diagnostic sits on the parser's line, checking stops.
    edit(`${PYPROJECT}\n[tool.inwards.rules]\nignore = \n`);
    const syntax = await diagnosticsOnce(config, (found) => found.length === 1);
    expect(syntax.map((d) => [d.severity, d.range.start.line])).toEqual([[1, 9]]);
    expect(syntax[0]?.message).toContain("not valid TOML");
    expect(await codesOnceIncluding(router, "INW010", false)).toEqual([]);
    await until(() => popups().slice(from).length === 1);
    expect(popups().at(from)).toContain("Inwards is off until pyproject.toml is fixed");

    // Another error pops up again; the same one after another edit doesn't.
    edit(UNKNOWN_CODE);
    const unknown = await diagnosticsOnce(config, (found) =>
      (found[0]?.message ?? "").includes("INW099"),
    );
    expect(unknown.map((d) => d.range.start.line)).toEqual([0]);
    await until(() => popups().slice(from).length === 2);
    edit(`${UNKNOWN_CODE}# a comment\n`);
    await Bun.sleep(QUIET_MS);
    expect(popups().slice(from)).toHaveLength(2);
    expect(popups().at(from + 1)).toContain("INW099");

    // Fixed: the diagnostic goes, checking resumes without a restart.
    edit(PYPROJECT);
    expect(await diagnosticsOnce(config, (found) => found.length === 0)).toEqual([]);
    expect(await codesOnceIncluding(router, "INW010")).toEqual(["INW010"]);
  } finally {
    server.kill();
  }
}, 30_000);

test("a change to [tool.inwards.rules] takes effect without a restart", async () => {
  const { server, router, edit } = await openProject(harness, "relevel", PYPROJECT, WATCHING);
  try {
    const before = await diagnosticsOnce(router, (found) => found.length === 1);
    expect(before.map((d) => [d.code, d.severity])).toEqual([["INW010", 1]]);
    edit(`${PYPROJECT}\n[tool.inwards.rules]\nseverity = { INW010 = "warning" }\n`);
    const after = await diagnosticsOnce(router, (found) => found[0]?.severity === 2);
    expect(after.map((d) => [d.code, d.severity])).toEqual([["INW010", 2]]);
    edit(`${PYPROJECT}\n[tool.inwards.rules]\nignore = ["INW010"]\n`);
    expect(await codesOnceIncluding(router, "INW010", false)).toEqual([]);
  } finally {
    server.kill();
  }
}, 30_000);

test("without watched-file support, saving pyproject.toml re-reads the config", async () => {
  const from = popups().length;
  const { server, config, router } = await openProject(harness, "saved", UNKNOWN_CODE, {});
  try {
    const uri = pathToFileURL(config).href;
    const textDocument = { uri, languageId: "toml", version: 1, text: UNKNOWN_CODE };
    server.send({ method: "textDocument/didOpen", params: { textDocument } });
    const broken = await diagnosticsOnce(config, (found) => found.length === 1);
    expect(broken[0]?.message).toContain("INW099");
    await until(() => popups().slice(from).length === 1);
    expect(popups().slice(from)).toHaveLength(1);

    writeFileSync(config, PYPROJECT);
    server.send({
      method: "textDocument/didChange",
      params: { textDocument: { uri, version: 2 }, contentChanges: [{ text: PYPROJECT }] },
    });
    server.send({ method: "textDocument/didSave", params: { textDocument: { uri } } });
    expect(await diagnosticsOnce(config, (found) => found.length === 0)).toEqual([]);
    expect(await codesOnceIncluding(router, "INW010")).toEqual(["INW010"]);
  } finally {
    server.kill();
  }
}, 30_000);

test("a pyproject.toml without [tool.inwards] is not an error", async () => {
  const from = popups().length;
  const { server, config, router } = await openProject(
    harness,
    "other",
    '[project]\nname = "other"\n',
    WATCHING,
  );
  try {
    await Bun.sleep(QUIET_MS);
    expect(popups().slice(from)).toEqual([]);
    expect(published.has(pathToFileURL(config).href)).toBe(false);
    expect(published.has(pathToFileURL(router).href)).toBe(false);
  } finally {
    server.kill();
  }
}, 30_000);

test("the client syncs pyproject.toml, and the server never checks it as Python", async () => {
  // The language client drops a save outside its selector, so the didSave
  // fallback needs pyproject.toml in it.
  const patterns = DOCUMENT_SELECTOR.flatMap((filter) => filter.pattern ?? []);
  expect(DOCUMENT_SELECTOR).toContainEqual({ scheme: "file", language: "python" });
  expect(patterns.some((glob) => new Bun.Glob(glob).match("/work/shop/pyproject.toml"))).toBe(true);
  expect(patterns.some((glob) => new Bun.Glob(glob).match("/work/shop/app/router.py"))).toBe(false);

  const { server, config } = await openProject(harness, "synced", PYPROJECT, WATCHING);
  const nested = join(TMP, "synced/tools/pyproject.toml");
  write(TMP, { "synced/tools/pyproject.toml": PYPROJECT });
  try {
    // Text that would be INW010 if it were checked as Python.
    for (const path of [config, nested]) {
      const uri = pathToFileURL(path).href;
      const text = "import app.pricing\n";
      server.send({
        method: "textDocument/didOpen",
        params: { textDocument: { uri, languageId: "toml", version: 1, text } },
      });
      server.send({
        method: "textDocument/didChange",
        params: { textDocument: { uri, version: 2 }, contentChanges: [{ text }] },
      });
      server.send({ method: "textDocument/didSave", params: { textDocument: { uri } } });
      server.send({ method: "textDocument/didClose", params: { textDocument: { uri } } });
    }
    await Bun.sleep(QUIET_MS);
    expect(published.has(pathToFileURL(config).href)).toBe(false);
    expect(published.has(pathToFileURL(nested).href)).toBe(false);
  } finally {
    server.kill();
  }
}, 30_000);
