/**
 * @file Which `inwards` the client starts (ADR-043): the setting, then the
 * bundled binary, then PATH, on POSIX and Windows paths alike. The file system
 * is a set of paths, so every platform's rules run on any machine.
 */
import { expect, test } from "bun:test";
import { findServer, type Lookup } from "../src/client/binary.ts";

/** VS Code's placeholder for the first workspace folder, as a user types it. */
// biome-ignore lint/suspicious/noTemplateCurlyInString: the literal placeholder, not a template.
const FOLDER = "${workspaceFolder}";

/**
 * Builds a POSIX lookup over a fixed set of files.
 *
 * @param files - the paths that exist.
 * @param over - fields to change.
 * @returns the lookup.
 */
function posix(files: string[], over: Partial<Lookup> = {}): Lookup {
  return {
    configured: "",
    bundledDir: "/ext/bin",
    platform: "linux",
    path: "/usr/local/bin:/usr/bin",
    home: "/home/me",
    workspaceFolder: "/work/app",
    isFile: (path: string): boolean => files.includes(path),
    ...over,
  };
}

/**
 * Builds a Windows lookup over a fixed set of files.
 *
 * @param files - the paths that exist.
 * @param over - fields to change.
 * @returns the lookup.
 */
function windows(files: string[], over: Partial<Lookup> = {}): Lookup {
  return {
    configured: "",
    bundledDir: "C:\\Users\\Me Too\\.vscode\\extensions\\inwards\\bin",
    platform: "win32",
    path: 'C:\\Windows;"C:\\Program Files\\Inwards";relative\\dir',
    home: "C:\\Users\\Me Too",
    workspaceFolder: "D:\\work\\app",
    isFile: (path: string): boolean => files.includes(path),
    ...over,
  };
}

test("the bundled binary comes before PATH", () => {
  expect(findServer(posix(["/ext/bin/inwards", "/usr/bin/inwards"]))).toEqual({
    command: "/ext/bin/inwards",
    source: "bundled",
  });
});

test("without a bundled binary, PATH is searched in order", () => {
  expect(findServer(posix(["/usr/bin/inwards"]))).toEqual({
    command: "/usr/bin/inwards",
    source: "path",
  });
});

test("the setting wins over the bundled binary, with ~ and the workspace folder expanded", () => {
  const files = ["/ext/bin/inwards", "/home/me/bin/inwards", "/work/app/.venv/bin/inwards"];
  expect(findServer(posix(files, { configured: "~/bin/inwards" }))).toEqual({
    command: "/home/me/bin/inwards",
    source: "setting",
  });
  expect(findServer(posix(files, { configured: `${FOLDER}/.venv/bin/inwards` }))).toEqual({
    command: "/work/app/.venv/bin/inwards",
    source: "setting",
  });
  expect(findServer(posix(files, { configured: ".venv/bin/inwards" }))).toEqual({
    command: "/work/app/.venv/bin/inwards",
    source: "setting",
  });
});

test("a bare name in the setting is looked up on PATH", () => {
  expect(findServer(posix(["/usr/bin/inwards-dev"], { configured: "inwards-dev" }))).toEqual({
    command: "/usr/bin/inwards-dev",
    source: "setting",
  });
});

test("a setting that points at nothing is reported, never replaced by another binary", () => {
  const found = findServer(posix(["/ext/bin/inwards"], { configured: "/opt/inwards" }));
  expect(found).toEqual({
    problem: "The `inwards.path` setting is /opt/inwards, and there is no file at /opt/inwards.",
  });
  const noFolder = findServer(
    posix([], { configured: `${FOLDER}/inwards`, workspaceFolder: undefined }),
  );
  expect("problem" in noFolder && noFolder.problem).toContain("no folder is open");
});

test("nothing anywhere names the setting and the platform", () => {
  const found = findServer(posix([], { platform: "linux" }));
  expect("problem" in found && found.problem).toContain("`inwards.path`");
  expect("problem" in found && found.problem).toContain("linux");
});

test("Windows: inwards.exe in a bundled path with spaces, quoted PATH entries, no relative ones", () => {
  const bundled = "C:\\Users\\Me Too\\.vscode\\extensions\\inwards\\bin\\inwards.exe";
  expect(findServer(windows([bundled]))).toEqual({ command: bundled, source: "bundled" });
  expect(findServer(windows(["C:\\Program Files\\Inwards\\inwards.exe"]))).toEqual({
    command: "C:\\Program Files\\Inwards\\inwards.exe",
    source: "path",
  });
  expect("problem" in findServer(windows(["relative\\dir\\inwards.exe"]))).toBe(true);
  // A .cmd shim can't be spawned without a shell, so it doesn't count.
  expect("problem" in findServer(windows(["C:\\Windows\\inwards.cmd"]))).toBe(true);
});

test("Windows: the setting takes backslashes, ~ and a bare name", () => {
  const venv = "D:\\work\\app\\.venv\\Scripts\\inwards.exe";
  expect(
    findServer(windows([venv], { configured: `${FOLDER}\\.venv\\Scripts\\inwards.exe` })),
  ).toEqual({ command: venv, source: "setting" });
  expect(findServer(windows([venv], { configured: ".venv\\Scripts\\inwards.exe" }))).toEqual({
    command: venv,
    source: "setting",
  });
  const home = "C:\\Users\\Me Too\\tools\\inwards.exe";
  expect(findServer(windows([home], { configured: "~\\tools\\inwards.exe" }))).toEqual({
    command: home,
    source: "setting",
  });
  expect(findServer(windows(["C:\\Windows\\inwards.exe"], { configured: "inwards" }))).toEqual({
    command: "C:\\Windows\\inwards.exe",
    source: "setting",
  });
});
