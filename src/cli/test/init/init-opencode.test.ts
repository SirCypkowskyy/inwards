/**
 * @file `inwards init --agent opencode` and the guard in the plugin it
 * writes. Init writes `.opencode/plugins/inwards.js`, keeps it out of git,
 * and refuses to replace anything it didn't write. The plugin, loaded as
 * OpenCode loads it, sends edits of `pyproject.toml` through the config
 * guard and refuses edits and patches of Inwards' files however the path is
 * spelled: patch headers with any spacing, links, relative paths from a
 * subdirectory. When Inwards can't run, a call that touches the rules is
 * refused rather than let through unchecked.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { PLUGIN_MARKER } from "../../src/claude-code/hook-host.ts";
import { type Hooks, initProject, load, PLUGIN } from "../support/opencode-helpers.ts";
import { inwards, LAYERS, project } from "../support/run.ts";

/**
 * Runs `inwards init --agent opencode` in a project.
 *
 * @param root - the project directory.
 * @returns the exit code and stderr.
 */
function init(root: string): { code: number; stderr: string } {
  return inwards(["init", "--agent", "opencode"], { cwd: root });
}

/** The line of the plugin that names the Inwards command. */
const INWARDS_LINE = /^const INWARDS = .*$/mu;

/**
 * Wraps one patch header in a patch.
 *
 * @param header - `*** Update File: …` and the like.
 * @returns the patch text.
 */
function patch(header: string): string {
  return `*** Begin Patch\n${header}\n@@\n-a\n+b\n*** End Patch\n`;
}

/**
 * Asks the plugin whether a tool call may run.
 *
 * @param hooks - the plugin's hooks.
 * @param tool - the OpenCode tool.
 * @param args - its arguments.
 * @returns the refusal's message, or "" when the call may run.
 */
async function refusal(hooks: Hooks, tool: string, args: Record<string, unknown>): Promise<string> {
  try {
    await hooks["tool.execute.before"]({ tool, sessionID: "ses_guard" }, { args });
    return "";
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
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
    expect(init(root).code).toBe(0);
    expect(readFileSync(join(root, PLUGIN), "utf8")).toBe(plugin);
  });

  test("refuses to replace a plugin it didn't write, a directory or a link, and changes nothing", () => {
    const own = "export const Mine = async () => ({});\n";
    const mine = project({ "pyproject.toml": LAYERS, [PLUGIN]: own });
    const result = init(mine);
    expect([result.code, result.stderr]).toEqual([
      2,
      expect.stringContaining("wasn't written by inwards init"),
    ]);
    expect(readFileSync(join(mine, PLUGIN), "utf8")).toBe(own);

    const dir = project({ "pyproject.toml": LAYERS });
    mkdirSync(join(dir, PLUGIN), { recursive: true });
    expect(init(dir).stderr).toContain("isn't a regular file");
    expect(readFileSync(join(dir, "pyproject.toml"), "utf8")).toBe(LAYERS);
  });
});

describe.skipIf(process.platform === "win32")("links", () => {
  test("init refuses a link at the plugin's path and writes nothing through it", () => {
    const link = project({ "pyproject.toml": LAYERS, ".opencode/plugins/x": "" });
    symlinkSync(join(link, "elsewhere.js"), join(link, PLUGIN));
    expect(init(link).stderr).toContain("isn't a regular file");
    expect(existsSync(join(link, "elsewhere.js"))).toBe(false);
  });

  test("a link to a protected file is refused like the file", async () => {
    const root = initProject();
    symlinkSync(join(root, PLUGIN), join(root, "alias.js"));
    symlinkSync(join(root, "pyproject.toml"), join(root, "config.toml"));
    symlinkSync(join(root, ".inwards/missing.json"), join(root, "dangling.json"));
    const { hooks } = await load(root);
    const found = await Promise.all([
      refusal(hooks, "write", { filePath: "alias.js", content: "" }),
      refusal(hooks, "write", { filePath: "dangling.json", content: "" }),
      refusal(hooks, "apply_patch", { patchText: patch("*** Update File: config.toml") }),
    ]);
    expect(found).toEqual([
      expect.stringContaining("is Inwards' own"),
      expect.stringContaining("is Inwards' own"),
      expect.stringContaining("apply_patch may not change"),
    ]);
  });
});

describe("the guard in the plugin", () => {
  const s = "ses_guard";

  test("an edit of [tool.inwards] goes through the config guard and is refused", async () => {
    const root = initProject();
    const { hooks } = await load(root);
    const args = {
      filePath: join(root, "pyproject.toml"),
      oldString: '"shop.domain"',
      newString: '"shop"',
    };
    await expect(
      hooks["tool.execute.before"]({ tool: "edit", sessionID: s }, { args }),
    ).rejects.toThrow();
    const fine = { filePath: join(root, "shop/domain/order.py"), content: "Y = 2\n" };
    await hooks["tool.execute.before"]({ tool: "write", sessionID: s }, { args: fine });
  });

  test("patches of the config or Inwards' files are refused, whatever the header spacing", async () => {
    const root = initProject();
    const { hooks } = await load(root);
    const headers = [
      "*** Update File: pyproject.toml",
      "*** Update File:pyproject.toml",
      "*** Delete File:\t.opencode/plugins/inwards.js",
      "***  Add File :  .inwards/state/x.json",
      "*** Update File: shop/x.py\n*** Move to:inwards-baseline.json",
    ];
    const found = await Promise.all(
      headers.map((h) => refusal(hooks, "apply_patch", { patchText: patch(h) })),
    );
    expect(found).toEqual(headers.map(() => expect.stringContaining("apply_patch may not change")));
  });

  test("started in a subdirectory, the plugin still checks against the project's config", async () => {
    const root = initProject();
    const { hooks } = await load(root, join(root, "shop"));
    const order = join(root, "shop/domain/order.py");
    writeFileSync(order, "import shop.infrastructure.db\n");
    const out = { output: "" };
    await hooks["tool.execute.after"](
      { tool: "write", sessionID: s, args: { filePath: "domain/order.py" } },
      out,
    );
    expect(out.output).toContain("INW001");
  });

  test("when Inwards can't run, a call that touches the rules is refused and an edit says so", async () => {
    const root = initProject();
    const path = join(root, PLUGIN);
    const text = readFileSync(path, "utf8").replace(
      INWARDS_LINE,
      'const INWARDS = ["/nonexistent/inwards"];',
    );
    writeFileSync(path, text);
    const { hooks } = await load(root);
    const args = { filePath: join(root, "pyproject.toml"), oldString: "a", newString: "b" };
    await expect(
      hooks["tool.execute.before"]({ tool: "edit", sessionID: s }, { args }),
    ).rejects.toThrow("couldn't check this call");
    await expect(
      hooks["tool.execute.before"](
        { tool: "bash", sessionID: s },
        { args: { command: "sed -i s/a/b/ pyproject.toml" } },
      ),
    ).rejects.toThrow("couldn't check this call");
    await hooks["tool.execute.before"]({ tool: "bash", sessionID: s }, { args: { command: "ls" } });
    const out = { output: "" };
    await hooks["tool.execute.after"](
      { tool: "write", sessionID: s, args: { filePath: "shop/domain/order.py" } },
      out,
    );
    expect(out.output).toContain("Inwards couldn't check");
  });
});
