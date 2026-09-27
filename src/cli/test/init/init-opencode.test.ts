/**
 * @file `inwards init --agent opencode` and the plugin it writes. Init writes
 * `.opencode/plugins/inwards.js`, keeps it out of git, and refuses to replace
 * a plugin it didn't write. The plugin is loaded here as OpenCode loads it,
 * with a stand-in client, and driven through a session: the config guard
 * refuses an edit to `pyproject.toml`, apply_patch can't reach Inwards' files,
 * a bad edit gets the diagnostics in the tool output, and the Stop gate sends
 * the agent back to work once, with a preface that says who is speaking.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PLUGIN_MARKER } from "../../src/claude-code/hook-host.ts";
import { inwards, LAYERS, project, type RunResult } from "../support/run.ts";

const PLUGIN = ".opencode/plugins/inwards.js";

/**
 * Runs `inwards init --agent opencode` in a project.
 *
 * @param root - the project directory.
 * @returns the exit code and output.
 */
function init(root: string): RunResult {
  return inwards(["init", "--agent", "opencode"], { cwd: root });
}

/** A message the plugin sent through the stand-in client. */
interface Sent {
  id: string;
  text: string;
}

/** The hooks the plugin returns, as the tests call them. */
interface Hooks {
  event: (input: { event: { type: string; properties: unknown } }) => Promise<void>;
  "chat.message": (input: { sessionID: string }) => Promise<void>;
  "tool.execute.before": (
    input: { tool: string; sessionID: string },
    output: { args: Record<string, unknown> },
  ) => Promise<void>;
  "tool.execute.after": (
    input: { tool: string; sessionID: string; args: Record<string, unknown> },
    output: { output: string },
  ) => Promise<void>;
}

/**
 * Loads the plugin init wrote, as OpenCode would, with a client that records
 * the messages it sends.
 *
 * @param root - the project directory.
 * @returns the plugin's hooks and the messages sent so far.
 */
async function load(root: string): Promise<{ hooks: Hooks; sent: Sent[] }> {
  const sent: Sent[] = [];
  const client = {
    session: {
      promptAsync: ({
        path,
        body,
      }: {
        path: { id: string };
        body: { parts: { text: string }[] };
      }): Promise<void> => {
        sent.push({ id: path.id, text: body.parts.map((p) => p.text).join("") });
        return Promise.resolve();
      },
    },
  };
  const mod: Record<string, (ctx: unknown) => Promise<Hooks>> = await import(join(root, PLUGIN));
  const plugin = mod["Inwards"];
  if (plugin === undefined) {
    throw new Error(`${PLUGIN} exports no Inwards plugin`);
  }
  return { hooks: await plugin({ client, directory: root }), sent };
}

describe("inwards init --agent opencode", () => {
  test("writes the plugin, keeps it out of git and pins required-version; a second run is a no-op", () => {
    const root = project({ "pyproject.toml": LAYERS, "shop/domain/order.py": "X = 1\n" });
    expect(init(root).code).toBe(0);
    const plugin = readFileSync(join(root, PLUGIN), "utf8");
    expect(plugin.startsWith(PLUGIN_MARKER)).toBe(true);
    expect(readFileSync(join(root, ".gitignore"), "utf8")).toContain(PLUGIN);
    expect(readFileSync(join(root, "pyproject.toml"), "utf8")).toContain("required-version");
    expect(existsSync(join(root, ".claude"))).toBe(false);
    const again = init(root);
    expect(again.code).toBe(0);
    expect(readFileSync(join(root, PLUGIN), "utf8")).toBe(plugin);
  });

  test("refuses to replace a plugin it didn't write", () => {
    const own = "export const Mine = async () => ({});\n";
    const root = project({ "pyproject.toml": LAYERS, [PLUGIN]: own });
    const result = init(root);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("wasn't written by inwards init");
    expect(readFileSync(join(root, PLUGIN), "utf8")).toBe(own);
  });
});

describe("the plugin", () => {
  test("the config guard and the protected files hold", async () => {
    const root = project({ "pyproject.toml": LAYERS, "shop/domain/order.py": "X = 1\n" });
    expect(init(root).code).toBe(0);
    const { hooks } = await load(root);
    const s = "ses_guard";
    const edit = {
      filePath: join(root, "pyproject.toml"),
      oldString: '"shop.domain"',
      newString: '"shop"',
    };
    await expect(
      hooks["tool.execute.before"]({ tool: "edit", sessionID: s }, { args: edit }),
    ).rejects.toThrow();
    const patch = "*** Begin Patch\n*** Update File: pyproject.toml\n@@\n-a\n+b\n*** End Patch\n";
    await expect(
      hooks["tool.execute.before"](
        { tool: "apply_patch", sessionID: s },
        { args: { patchText: patch } },
      ),
    ).rejects.toThrow("apply_patch may not change");
    await expect(
      hooks["tool.execute.before"](
        { tool: "write", sessionID: s },
        { args: { filePath: PLUGIN, content: "" } },
      ),
    ).rejects.toThrow("is Inwards' own");
    const fine = { filePath: join(root, "shop/domain/order.py"), content: "Y = 2\n" };
    await hooks["tool.execute.before"]({ tool: "write", sessionID: s }, { args: fine });
  });

  test("a bad edit gets its diagnostics, and the Stop gate sends the agent back once", async () => {
    const root = project({ "pyproject.toml": LAYERS, "shop/domain/order.py": "X = 1\n" });
    expect(init(root).code).toBe(0);
    const { hooks, sent } = await load(root);
    const s = "ses_stop";
    await hooks.event({ event: { type: "session.created", properties: { info: { id: s } } } });
    const order = join(root, "shop/domain/order.py");
    writeFileSync(order, "import shop.infrastructure.db\n");
    const out = { output: "Edit applied." };
    await hooks["tool.execute.after"](
      { tool: "write", sessionID: s, args: { filePath: order } },
      out,
    );
    expect(out.output).toContain("INW001");

    await hooks.event({ event: { type: "session.idle", properties: { sessionID: s } } });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.id).toBe(s);
    expect(sent[0]?.text).toStartWith(
      "Inwards Stop gate (sent by the Inwards plugin, not the user)",
    );
    expect(sent[0]?.text).toContain("INW001");

    await hooks["chat.message"]({ sessionID: s }); // the plugin's own message
    writeFileSync(order, "X = 1\n");
    await hooks.event({ event: { type: "session.idle", properties: { sessionID: s } } });
    expect(sent).toHaveLength(1);
  });

  test("a subagent's edits are checked, and only the top-level session hits the Stop gate", async () => {
    const root = project({ "pyproject.toml": LAYERS, "shop/domain/order.py": "X = 1\n" });
    expect(init(root).code).toBe(0);
    const { hooks, sent } = await load(root);
    const [top, child] = ["ses_top", "ses_child"];
    await hooks.event({ event: { type: "session.created", properties: { info: { id: top } } } });
    await hooks.event({
      event: { type: "session.created", properties: { info: { id: child, parentID: top } } },
    });
    const order = join(root, "shop/domain/order.py");
    writeFileSync(order, "import shop.infrastructure.db\n");
    const out = { output: "" };
    await hooks["tool.execute.after"](
      { tool: "write", sessionID: child, args: { filePath: order } },
      out,
    );
    expect(out.output).toContain("INW001");
    await hooks.event({ event: { type: "session.idle", properties: { sessionID: child } } });
    expect(sent).toEqual([]);
    await hooks.event({ event: { type: "session.idle", properties: { sessionID: top } } });
    expect(sent.map((m) => m.id)).toEqual([top]);
  });

  test("the Stop gate asks for the plugin back when it is gone", async () => {
    const root = project({ "pyproject.toml": LAYERS, "shop/domain/order.py": "X = 1\n" });
    expect(init(root).code).toBe(0);
    const { hooks, sent } = await load(root);
    const s = "ses_gone";
    await hooks.event({ event: { type: "session.created", properties: { info: { id: s } } } });
    rmSync(join(root, PLUGIN));
    await hooks.event({ event: { type: "session.idle", properties: { sessionID: s } } });
    expect(sent.map((m) => m.text).join("")).toContain("--agent opencode");
  });
});
