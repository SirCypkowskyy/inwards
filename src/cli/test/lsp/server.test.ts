/**
 * @file `inwards server` end to end, over stdio: findings in files nobody
 * opened, a keystroke checked against unsaved text, INW010 clearing once a
 * module is created on disk, a broken config shown once and cleared when
 * fixed, a workspace folder added later, a save rerunning the pass for an
 * editor without file watching, and stdout carrying nothing but LSP. Each
 * test runs its own server on a throwaway project.
 */
import { afterEach, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { type LspClient, type Seen, startServer, uri } from "../support/lsp-client.ts";
import { inwards, LAYERS, project } from "../support/run.ts";

const LEAK = "import shop.infrastructure.db\n";
const started: LspClient[] = [];

afterEach(async () => {
  for (const client of started.splice(0)) {
    // biome-ignore lint/performance/noAwaitInLoops: each server ends on its own.
    const code = await client.close();
    if (client.errors.length > 0 || code !== 0) {
      throw new Error(`inwards server: exit ${code}, stdout errors ${client.errors.join("; ")}`);
    }
  }
});

/**
 * Starts a server and remembers it, so the test's end closes it.
 *
 * @param folders - the workspace folders.
 * @param watching - whether the client watches files.
 * @returns the client.
 */
async function serve(folders: string[], watching = true): Promise<LspClient> {
  const client = await startServer(folders, watching);
  started.push(client);
  return client;
}

/**
 * Lists the codes of some diagnostics.
 *
 * @param found - the diagnostics.
 * @returns their codes, as strings.
 */
function codes(found: Seen[]): string[] {
  return found.map((d) => String(d.code));
}

test("a file nobody opened shows its violation, and a keystroke is checked unsaved", async () => {
  const root = project({
    "pyproject.toml": LAYERS,
    "shop/domain/bad.py": LEAK,
    "shop/domain/order.py": "",
  });
  const client = await serve([root]);
  const bad = await client.diagnostics(join(root, "shop/domain/bad.py"), (f) => f.length > 0);
  expect(codes(bad)).toEqual(["INW001"]);
  expect(bad[0]?.codeDescription?.href).toContain("/rules/INW001/");

  const order = join(root, "shop/domain/order.py");
  client.open(order, "");
  client.change(order, `x = 1\n${LEAK}`);
  const leaked = await client.diagnostics(order, (f) => f.length > 0);
  expect(codes(leaked)).toEqual(["INW001"]);
  expect(leaked[0]?.range.start.line).toBe(1);
  client.change(order, "x = 1\n");
  expect(await client.diagnostics(order, (f) => f.length === 0)).toEqual([]);
}, 30_000);

test("INW010 on an open document clears once the module is created on disk", async () => {
  const root = project({ "pyproject.toml": LAYERS, "shop/domain/order.py": "" });
  const client = await serve([root]);
  const order = join(root, "shop/domain/order.py");
  client.open(order, "import shop.domain.pricing\n");
  expect(codes(await client.diagnostics(order, (f) => f.length > 0))).toEqual(["INW010"]);
  const pricing = join(root, "shop/domain/pricing.py");
  writeFileSync(pricing, "");
  client.files([[pricing, 1]]);
  expect(await client.diagnostics(order, (f) => f.length === 0)).toEqual([]);
}, 30_000);

test("a broken config pops up once, shows on pyproject.toml, and clears when fixed", async () => {
  const root = project({ "pyproject.toml": LAYERS, "shop/domain/order.py": LEAK });
  const config = join(root, "pyproject.toml");
  writeFileSync(config, '[tool.inwards]\nlayers = "domain"\n');
  const client = await serve([root]);
  const shown = await client.diagnostics(config, (f) => f.length > 0);
  expect(shown[0]?.severity).toBe(1);
  await client.until(() => client.popups.length > 0);
  expect(client.popups).toHaveLength(1);
  expect(client.popups[0]).toContain("Inwards is off for");

  writeFileSync(config, LAYERS);
  client.files([[config, 2]]);
  expect(await client.diagnostics(config, (f) => f.length === 0)).toEqual([]);
  const order = await client.diagnostics(join(root, "shop/domain/order.py"), (f) => f.length > 0);
  expect(codes(order)).toEqual(["INW001"]);
  expect(client.popups).toHaveLength(1);
}, 30_000);

test("a workspace folder added later is checked with its own config", async () => {
  const first = project({ "pyproject.toml": LAYERS, "shop/domain/order.py": LEAK });
  const second = project({ "pyproject.toml": LAYERS, "shop/domain/order.py": LEAK });
  const client = await serve([first]);
  await client.diagnostics(join(first, "shop/domain/order.py"), (f) => f.length > 0);
  const order = join(second, "shop/domain/order.py");
  expect(client.published.has(uri(order))).toBe(false);
  client.addFolder(second);
  expect(codes(await client.diagnostics(order, (f) => f.length > 0))).toEqual(["INW001"]);
}, 30_000);

test("without file watching, a save checks the workspace again", async () => {
  const root = project({
    "pyproject.toml": LAYERS,
    "shop/domain/order.py": "",
    "shop/domain/other.py": "import shop.domain.pricing\n",
  });
  const client = await serve([root], false);
  const other = join(root, "shop/domain/other.py");
  expect(codes(await client.diagnostics(other, (f) => f.length > 0))).toEqual(["INW010"]);
  writeFileSync(join(root, "shop/domain/pricing.py"), "");
  const order = join(root, "shop/domain/order.py");
  client.open(order, "");
  client.save(order);
  expect(await client.diagnostics(other, (f) => f.length === 0)).toEqual([]);
}, 30_000);

test("inwards server with an argument is a usage error on stderr, not stdout", () => {
  const { code, stdout, stderr } = inwards(["server", "extra"], { cwd: project({}) });
  expect(code).toBe(2);
  expect(stdout).toBe("");
  expect(stderr).toContain("inwards server");
});
