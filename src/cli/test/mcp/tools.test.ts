/**
 * @file The three `inwards mcp` tools through the SDK's own client, in
 * process: `check_files` over the whole project, named paths and text not
 * yet written (in a package that doesn't exist yet), `explain_rule` serving
 * the docs page, and `where_should_this_go` judging imports in each layer.
 * Each test works in its own throwaway project; nothing is written to it.
 */
import { afterEach, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Client } from "@modelcontextprotocol/client";
import { call, connectInProcess } from "../support/mcp-client.ts";
import { LAYERS, project } from "../support/run.ts";

const THREE_LAYERS = `[tool.inwards]
layers = [
  { name = "domain", modules = ["shop.domain"] },
  { name = "application", modules = ["shop.application"] },
  { name = "infrastructure", modules = ["shop.infrastructure"] },
]
`;
const LEAK = "import shop.infrastructure.db\n";
const clients: Client[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

/**
 * Connects a client to a server working in a project.
 *
 * @param root - the project.
 * @returns the client.
 */
async function connect(root: string): Promise<Client> {
  const client = await connectInProcess(root);
  clients.push(client);
  return client;
}

/**
 * Reads the codes of a diagnostics@1 report's findings.
 *
 * @param data - the report.
 * @returns each diagnostic's code and file.
 */
function findings(data: Record<string, unknown>): string[] {
  const list = Array.isArray(data["diagnostics"]) ? data["diagnostics"] : [];
  return list.map((d: { code?: unknown; file?: unknown }) => `${String(d.code)} ${String(d.file)}`);
}

test("lists the three tools, read-only, with their schemas and the server's instructions", async () => {
  const client = await connect(project({ "pyproject.toml": LAYERS }));
  const { tools } = await client.listTools();
  expect(tools.map((t) => t.name).sort()).toEqual([
    "check_files",
    "explain_rule",
    "where_should_this_go",
  ]);
  for (const tool of tools) {
    expect(tool.annotations?.readOnlyHint).toBe(true);
  }
  const explain = tools.find((t) => t.name === "explain_rule");
  expect(explain?.inputSchema.required).toEqual(["rule"]);
  expect(client.getInstructions()).toContain("where_should_this_go");
});

test("check_files reports the whole project as inwards check --format json does", async () => {
  const root = project({ "pyproject.toml": LAYERS, "shop/domain/bad.py": LEAK });
  const answer = await call(await connect(root), "check_files", {});
  expect(answer.isError).toBe(false);
  expect(answer.data["schema"]).toBe("inwards/diagnostics@1");
  expect(findings(answer.data)).toEqual(["INW001 shop/domain/bad.py"]);
  expect(JSON.parse(answer.text)).toEqual(answer.data);
});

test("check_files checks text not yet written, in a package that doesn't exist, and writes nothing", async () => {
  const root = project({ "pyproject.toml": LAYERS, "shop/domain/order.py": "" });
  const client = await connect(root);
  const path = "shop/domain/pricing/rules.py";
  const leaking = await call(client, "check_files", { contents: { [path]: LEAK } });
  expect(findings(leaking.data)).toEqual([`INW001 ${path}`]);
  expect(existsSync(join(root, "shop/domain/pricing"))).toBe(false);
  // The new module is in the index too: a file importing it passes INW010.
  const both = await call(client, "check_files", {
    contents: {
      [path]: "from shop.domain.order import *\n",
      "shop/domain/user.py": "from shop.domain.pricing import rules\n",
    },
  });
  expect(findings(both.data)).toEqual([]);
  expect(both.data["summary"]).toMatchObject({ filesChecked: 2 });
});

test("check_files caps the diagnostics, refuses non-Python contents, and reports a broken config", async () => {
  const root = project({
    "pyproject.toml": LAYERS,
    "shop/domain/a.py": LEAK,
    "shop/domain/b.py": LEAK,
  });
  const client = await connect(root);
  const capped = await call(client, "check_files", { paths: ["shop"], maxDiagnostics: 1 });
  expect(findings(capped.data)).toHaveLength(1);
  expect(capped.data["summary"]).toMatchObject({ violations: 2, omitted: 1 });
  const toml = await call(client, "check_files", { contents: { "pyproject.toml": "" } });
  expect(toml.isError).toBe(true);
  expect(toml.text).toContain("Python files only");
  const broken = project({ "pyproject.toml": "[tool.inwards]\nlayers = 3\n", "a.py": "" });
  const answer = await call(await connect(broken), "check_files", {});
  expect(answer.isError).toBe(true);
  expect(answer.text).toStartWith("config error: ");
});

test("explain_rule serves the rule page's sections, by code or by name", async () => {
  const client = await connect(project({ "pyproject.toml": LAYERS }));
  const answer = await call(client, "explain_rule", { rule: "inw001" });
  expect(answer.isError).toBe(false);
  expect(answer.data).toMatchObject({
    code: "INW001",
    name: "layer-dependency",
    severity: "error",
  });
  const sections = answer.data["sections"];
  expect(Array.isArray(sections) ? sections.map((s: { id: string }) => s.id) : []).toEqual([
    "what-it-does",
    "why-is-this-bad",
    "example",
    "how-to-fix",
  ]);
  expect(answer.text).toContain("## How to fix");
  expect(answer.text).not.toContain("<!-- e2e -->");
  expect(answer.text).toContain("](https://sircypkowskyy.github.io/inwards/rules/INW011/)");
  const full = await call(client, "explain_rule", { rule: "async-blocking", full: true });
  expect(full.data["code"]).toBe("INW013");
  expect(full.text).toContain("## Known limitations");
  const unknown = await call(client, "explain_rule", { rule: "INW999" });
  expect(unknown.isError).toBe(true);
  expect(unknown.text).toContain("INW001");
});

test("where_should_this_go puts code in the innermost layer its imports pass in", async () => {
  const root = project({
    "pyproject.toml": THREE_LAYERS,
    "shop/domain/order.py": "class Order: ...\n",
    "shop/application/__init__.py": "",
    "shop/infrastructure/db.py": "",
  });
  const client = await connect(root);
  const answer = await call(client, "where_should_this_go", {
    imports: ["shop.infrastructure.db", "shop.domain.order.Order"],
  });
  expect(answer.data["suggestion"]).toEqual({
    layer: "infrastructure",
    module: "shop.infrastructure.new_module",
    file: "shop/infrastructure/new_module.py",
    basis: "imports",
  });
  const candidates = answer.data["candidates"];
  const blocked = Array.isArray(candidates)
    ? candidates.map((c: { layer: string; blocked: { code: string }[] }) => [
        c.layer,
        c.blocked.map((b) => b.code),
      ])
    : [];
  expect(blocked).toEqual([
    ["domain", ["INW001"]],
    ["application", ["INW001"]],
    ["infrastructure", []],
  ]);
});

test("where_should_this_go judges a named module, and names a missing first-party import", async () => {
  const root = project({
    "pyproject.toml": THREE_LAYERS,
    "shop/domain/order.py": "",
    "shop/application/__init__.py": "",
    "shop/infrastructure/db.py": "",
  });
  const client = await connect(root);
  const named = await call(client, "where_should_this_go", {
    module: "shop.domain.pricing",
    imports: ["shop.infrastructure.db", "shop.domain.prices"],
  });
  expect(named.data["module"]).toMatchObject({
    module: "shop.domain.pricing",
    file: "shop/domain/pricing.py",
    layer: "domain",
  });
  expect(named.data["module"]).toMatchObject({
    blocked: [
      { import: "shop.infrastructure.db", code: "INW001" },
      { import: "shop.domain.prices", code: "INW010" },
    ],
  });
  expect(named.data["suggestion"]).toBeUndefined();
  expect(named.text).toContain("No suggestion");
});

test("where_should_this_go follows the description when it names a layer or a role", async () => {
  const root = project({
    "pyproject.toml": THREE_LAYERS,
    "shop/domain/order.py": "",
    "shop/application/__init__.py": "",
    "shop/infrastructure/db.py": "",
  });
  const client = await connect(root);
  const sql = await call(client, "where_should_this_go", {
    description: "SQL repository for orders",
    imports: ["sqlalchemy", "shop.domain.order"],
  });
  expect(sql.data["suggestion"]).toMatchObject({
    layer: "infrastructure",
    module: "shop.infrastructure.sql_repository_orders",
    basis: "description",
  });
  // The innermost layer denies database clients by default (INW005).
  expect(sql.text).toContain("- domain: `sqlalchemy` (INW005)");
  const port = await call(client, "where_should_this_go", {
    description: "port for sending emails",
  });
  expect(port.data["suggestion"]).toMatchObject({ layer: "domain", basis: "description" });
  const vague = await call(client, "where_should_this_go", { description: "helpers" });
  expect(vague.data["suggestion"]).toBeUndefined();
  const bad = await call(client, "where_should_this_go", { imports: ["not a module"] });
  expect(bad.isError).toBe(true);
  const outside = await call(client, "where_should_this_go", { path: "/" });
  expect(outside.isError).toBe(true);
  expect(outside.text).toContain("No pyproject.toml with [tool.inwards]");
});
