/**
 * @file `inwards mcp` over stdio, as an MCP client starts it: the SDK's client
 * spawns the CLI (`run.ts`'s `CMD`, so the compiled binary in CI), lists the
 * tools and calls each one, and nothing but MCP ever reaches stdout (a
 * stray line would surface as a transport error). The server ends with code
 * 0 when the client closes stdin, and a stray argument is a usage error on
 * stderr with an empty stdout.
 */
import { expect, test } from "bun:test";
import { call, connectStdio } from "../support/mcp-client.ts";
import { inwards, LAYERS, project } from "../support/run.ts";

test("speaks MCP over stdio: lists the tools and answers each, with nothing else on stdout", async () => {
  const root = project({
    "pyproject.toml": LAYERS,
    "shop/domain/bad.py": "import shop.infrastructure.db\n",
  });
  const session = await connectStdio(root);
  const { client, errors } = session;
  try {
    expect(client.getServerVersion()?.name).toBe("inwards");
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "check_files",
      "explain_rule",
      "where_should_this_go",
    ]);
    const report = await call(client, "check_files", { paths: ["shop/domain/bad.py"] });
    expect(report.data["summary"]).toMatchObject({ filesChecked: 1, violations: 1 });
    const rule = await call(client, "explain_rule", { rule: "INW001" });
    expect(rule.text).toContain("## What it does");
    const where = await call(client, "where_should_this_go", {
      imports: ["shop.infrastructure.db"],
    });
    expect(where.data["suggestion"]).toMatchObject({ layer: "infrastructure" });
  } finally {
    await client.close();
  }
  expect(errors).toEqual([]);
}, 30_000);

test("serves a client that opens with the 2026-07-28 revision too", async () => {
  const root = project({ "pyproject.toml": LAYERS });
  const { client, errors } = await connectStdio(root, "2026-07-28");
  try {
    expect(client.getNegotiatedProtocolVersion()).toBe("2026-07-28");
    const rule = await call(client, "explain_rule", { rule: "INW010" });
    expect(rule.data["name"]).toBe("unknown-first-party");
  } finally {
    await client.close();
  }
  expect(errors).toEqual([]);
}, 30_000);

test("a stray argument is a usage error on stderr, with nothing on stdout", () => {
  const root = project({ "pyproject.toml": LAYERS });
  const result = inwards(["mcp", "extra"], { cwd: root });
  expect(result.code).toBe(2);
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain("inwards mcp");
});

test("ends with code 0 when the client closes stdin", () => {
  const root = project({ "pyproject.toml": LAYERS });
  const result = inwards(["mcp"], { cwd: root, stdin: "", timeout: 20_000 });
  expect(result.code).toBe(0);
  expect(result.stdout).toBe("");
});
