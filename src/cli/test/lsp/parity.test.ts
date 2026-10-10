/**
 * @file `inwards server` shows what `inwards check` reports (#63's acceptance):
 * on examples/, opened as a two-folder workspace, every published diagnostic
 * equals a finding of `inwards check` run in that folder, and nothing is
 * missing. The two folders route to two configs (broken-app's own, and the
 * repository's for clean-app), so this is also the multi-root case. The
 * server's findings under examples/ are pinned in a snapshot.
 */
import { afterAll, expect, test } from "bun:test";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type LspClient, type Seen, startServer } from "../support/lsp-client.ts";
import { inwards } from "../support/run.ts";

const REPO = resolve(import.meta.dir, "../../../..");
const FOLDERS = ["examples/broken-app", "examples/clean-app"].map((rel) => resolve(REPO, rel));

/** One finding, as both sides can spell it. */
interface Row {
  file: string;
  code: string;
  severity: string;
  start: string;
  end: string;
  message: string;
}

/** A finding in `inwards check --format json`, with the fields compared. */
interface Reported {
  file: string;
  code: string;
  severity: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  message: string;
  fix: { summary: string };
}

/**
 * Orders rows so two lists compare regardless of publish order.
 *
 * @param rows - findings from either side, sorted in place.
 * @returns the same array, ordered by each row's JSON.
 */
function sorted(rows: Row[]): Row[] {
  return rows.sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1));
}

/**
 * Runs `inwards check` in each folder, as a user would.
 *
 * @returns its findings, with paths relative to the repository.
 */
function checked(): Row[] {
  return sorted(
    FOLDERS.flatMap((folder) => {
      const { stdout } = inwards(["check", "--format", "json", "--no-cache"], { cwd: folder });
      const report: { diagnostics: Reported[] } = JSON.parse(stdout);
      return report.diagnostics.map((d) => ({
        file: relative(REPO, resolve(folder, d.file)).replaceAll("\\", "/"),
        code: d.code,
        severity: d.severity,
        start: `${d.line}:${d.column}`,
        end: `${d.endLine}:${d.endColumn}`,
        message: d.fix.summary === "" ? d.message : `${d.message}\n${d.fix.summary}`,
      }));
    }),
  );
}

/**
 * Reads what the server published.
 *
 * @param server - the server's client.
 * @returns its findings, with paths relative to the repository, 1-based like the CLI's.
 */
function shown(server: LspClient): Row[] {
  return sorted(
    [...server.published].flatMap(([at, found]) =>
      found.map((d: Seen) => ({
        file: relative(REPO, fileURLToPath(at)).replaceAll("\\", "/"),
        code: String(d.code),
        severity: d.severity === 1 ? "error" : "warning",
        start: `${d.range.start.line + 1}:${d.range.start.character + 1}`,
        end: `${d.range.end.line + 1}:${d.range.end.character + 1}`,
        message: typeof d.message === "string" ? d.message : d.message.value,
      })),
    ),
  );
}

let client: LspClient | undefined;
afterAll(async () => {
  await client?.close();
});

test("inwards server publishes what inwards check reports on examples/", async () => {
  const expected = checked();
  // broken-app's INW001, and the repository config's INW006 about shop.cli.
  expect(expected.map((row) => row.code).sort()).toEqual(["INW001", "INW006"]);
  client = await startServer(FOLDERS);
  const server = client;
  await server.until(() => JSON.stringify(shown(server)) === JSON.stringify(expected));
  expect(shown(server)).toEqual(expected);
  // Only broken-app is pinned: the repository's pyproject.toml moves with every edit.
  expect(shown(server).filter((row) => row.file.startsWith("examples/"))).toMatchSnapshot();
  expect(server.errors).toEqual([]);
}, 30_000);
