import { afterAll, expect, test } from "bun:test";
import { chmodSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { readConfig } from "../src/config-file.ts";
import { openProject } from "./config-helpers.ts";
import { type Harness, lspHarness, PYPROJECT, until, WATCHING, write } from "./lsp-harness.ts";

// A config that can't be read is a config error, as in the CLI, never a
// missing config that silently turns the checks off (#163).
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

test("a config that can't be read is an error too, not a missing config", async () => {
  const from = popups().length;
  const { server, config, router, edit } = await openProject(
    harness,
    "unreadable",
    PYPROJECT,
    WATCHING,
  );
  const uri = pathToFileURL(config).href;
  /**
   * Reports the config changed without writing it.
   */
  function touched(): void {
    const changes = [{ uri, type: 2 }];
    server.send({ method: "workspace/didChangeWatchedFiles", params: { changes } });
  }
  try {
    expect(await codesOnceIncluding(router, "INW010")).toEqual(["INW010"]);

    // A directory in its place: the popup, no diagnostic, checking off.
    rmSync(config);
    mkdirSync(config);
    touched();
    expect(await codesOnceIncluding(router, "INW010", false)).toEqual([]);
    await until(() => popups().length > from);
    expect(popups().slice(from)).toHaveLength(1);
    expect(popups().at(from)).toContain("pyproject.toml can't be read");
    expect(published.get(uri) ?? []).toEqual([]);
    rmSync(config, { recursive: true });
    edit(PYPROJECT);
    expect(await codesOnceIncluding(router, "INW010")).toEqual(["INW010"]);
  } finally {
    server.kill();
  }
}, 30_000);

test("a config without read permission gets the popup and the diagnostic", async () => {
  if (process.platform === "win32" || process.getuid?.() === 0) {
    return; // Windows has no unreadable files this way, and root ignores the bit
  }
  const { server, config, router } = await openProject(harness, "denied", PYPROJECT, WATCHING);
  const changes = [{ uri: pathToFileURL(config).href, type: 2 }];
  try {
    expect(await codesOnceIncluding(router, "INW010")).toEqual(["INW010"]);
    chmodSync(config, 0);
    server.send({ method: "workspace/didChangeWatchedFiles", params: { changes } });
    const denied = await diagnosticsOnce(config, (found) => found.length === 1);
    expect(denied[0]?.message).toContain("pyproject.toml can't be read");
    expect(await codesOnceIncluding(router, "INW010", false)).toEqual([]);
    chmodSync(config, 0o644);
    server.send({ method: "workspace/didChangeWatchedFiles", params: { changes } });
    expect(await diagnosticsOnce(config, (found) => found.length === 0)).toEqual([]);
    expect(await codesOnceIncluding(router, "INW010")).toEqual(["INW010"]);
  } finally {
    server.kill();
  }
}, 30_000);

test("a missing file, a dangling symlink and a file for a parent are no config", () => {
  const dir = join(TMP, "missing");
  write(dir, { "file.txt": "" });
  symlinkSync(join(dir, "gone.toml"), join(dir, "pyproject.toml"));
  expect(readConfig(join(dir, "nothing.toml"))).toBeUndefined();
  expect(readConfig(join(dir, "pyproject.toml"))).toBeUndefined();
  expect(readConfig(join(dir, "file.txt", "pyproject.toml"))).toBeUndefined();
});

test("a config symlinked into a directory the user can't enter is an error, not missing", async () => {
  if (process.platform === "win32" || process.getuid?.() === 0) {
    return; // Windows has no unreadable directories this way, and root ignores the bit
  }
  const { server, config, router } = await openProject(harness, "linked", PYPROJECT, WATCHING);
  const locked = join(TMP, "linked-locked");
  write(locked, { "pyproject.toml": PYPROJECT });
  const changes = [{ uri: pathToFileURL(config).href, type: 2 }];
  const from = popups().length;
  try {
    expect(await codesOnceIncluding(router, "INW010")).toEqual(["INW010"]);
    rmSync(config);
    symlinkSync(join(locked, "pyproject.toml"), config);
    chmodSync(locked, 0);
    server.send({ method: "workspace/didChangeWatchedFiles", params: { changes } });
    const denied = await diagnosticsOnce(config, (found) => found.length === 1);
    expect(denied[0]?.message).toContain("pyproject.toml can't be read");
    expect(await codesOnceIncluding(router, "INW010", false)).toEqual([]);
    expect(popups().slice(from)).toHaveLength(1);
    chmodSync(locked, 0o755);
    server.send({ method: "workspace/didChangeWatchedFiles", params: { changes } });
    expect(await diagnosticsOnce(config, (found) => found.length === 0)).toEqual([]);
    expect(await codesOnceIncluding(router, "INW010")).toEqual(["INW010"]);
  } finally {
    chmodSync(locked, 0o755);
    server.kill();
  }
}, 30_000);

test("a project directory that can't be entered gets the popup and no stale findings", async () => {
  if (process.platform === "win32" || process.getuid?.() === 0) {
    return; // Windows has no unreadable directories this way, and root ignores the bit
  }
  const { server, config, router } = await openProject(harness, "sealed", PYPROJECT, WATCHING);
  const project = join(TMP, "sealed");
  const changes = [{ uri: pathToFileURL(config).href, type: 2 }];
  const from = popups().length;
  try {
    expect(await codesOnceIncluding(router, "INW010")).toEqual(["INW010"]);
    chmodSync(project, 0);
    server.send({ method: "workspace/didChangeWatchedFiles", params: { changes } });
    expect(await codesOnceIncluding(router, "INW010", false)).toEqual([]);
    await until(() => popups().length > from);
    expect(popups().at(from)).toContain("pyproject.toml can't be read");
    expect(published.get(pathToFileURL(config).href) ?? []).toEqual([]);
    chmodSync(project, 0o755);
    server.send({ method: "workspace/didChangeWatchedFiles", params: { changes } });
    expect(await codesOnceIncluding(router, "INW010")).toEqual(["INW010"]);
  } finally {
    chmodSync(project, 0o755);
    server.kill();
  }
}, 30_000);
