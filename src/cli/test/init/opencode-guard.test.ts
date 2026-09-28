/**
 * @file Checks the OpenCode plugin makes before the config guard, for
 * arguments the guard never sees. A `bash` call may not run in Inwards' own
 * directories, and an edit of the config whose oldString matches more than
 * once is refused, since OpenCode would then pick a looser match. A deny
 * without a reason still blocks, and a hook run that takes too long is
 * stopped.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { INWARDS_LINE, initProject, load, PLUGIN, refusal } from "../support/opencode-helpers.ts";

/** The line of the plugin that sets the hook timeout. */
const TIMEOUT_LINE = /^const HOOK_TIMEOUT_MS = \d+;$/mu;

test("a command that runs in Inwards' own directories is refused, wherever it runs otherwise", async () => {
  const root = initProject();
  const { hooks } = await load(root);
  const dirs = [".inwards", ".inwards/", "./.inwards", join(root, ".inwards"), ".opencode/plugins"];
  const found = await Promise.all(
    dirs.map((workdir) => refusal(hooks, "bash", { command: "rm -f state.json", workdir })),
  );
  expect(found).toEqual(dirs.map(() => expect.stringContaining("may not run in")));
  expect(await refusal(hooks, "bash", { command: "ls", workdir: "shop" })).toBe("");
  // Without a workdir, a command runs where OpenCode was started.
  const inside = await load(root, join(root, ".opencode/plugins"));
  expect(await refusal(inside.hooks, "bash", { command: "rm inwards.js" })).toContain(
    "may not run in",
  );
});

test("an edit of the config whose oldString doesn't match exactly once is refused, even where the guard would allow it", async () => {
  const root = initProject();
  const config = join(root, "pyproject.toml");
  writeFileSync(
    config,
    `[project]\n# owner: shop.domain\nname = "shop"\n\n${readFileSync(config, "utf8")}`,
  );
  const { hooks } = await load(root);
  const edit = { filePath: config, oldString: "shop.domain", newString: "shop" };
  expect(await refusal(hooks, "edit", edit)).toContain("must match exactly once");
  // A leading BOM, which the guard drops: no exact match, so OpenCode's looser matches decide.
  const bom = { ...edit, oldString: "\uFEFF# owner: shop.domain", newString: "# owner: shop" };
  expect(await refusal(hooks, "edit", bom)).toContain("must match exactly once");
  // A BOM inside the file matches exactly, but the guard would still drop the one in oldString.
  writeFileSync(
    config,
    readFileSync(config, "utf8").replace('"shop.domain"', '"\uFEFFshop.domain"'),
  );
  const inner = { ...edit, oldString: "\uFEFFshop.domain", newString: "shop" };
  expect(await refusal(hooks, "edit", inner)).toContain("must match exactly once");
  // With replaceAll every exact match changes, which the guard simulates and judges.
  expect(await refusal(hooks, "edit", { ...edit, replaceAll: true })).toContain("[tool.inwards]");
  const unique = { ...edit, oldString: "# owner: shop.domain", newString: "# owner: shop" };
  expect(await refusal(hooks, "edit", unique)).toBe("");
});

describe.skipIf(process.platform === "win32")("hooks that misbehave", () => {
  test("a deny without a reason still blocks, and a hook that runs too long is stopped", async () => {
    const root = initProject();
    const path = join(root, PLUGIN);
    const plugin = readFileSync(path, "utf8");
    const deny = JSON.stringify({ hookSpecificOutput: { permissionDecision: "deny" } });
    const script = JSON.stringify(["sh", "-c", `echo '${deny}'`]);
    writeFileSync(path, plugin.replace(INWARDS_LINE, `const INWARDS = ${script};`));
    const denying = await load(root);
    expect(await refusal(denying.hooks, "bash", { command: "ls" })).toBe(
      "Inwards refused this call.",
    );

    // A fresh project: Bun caches the module by its path.
    const other = initProject();
    const slow = plugin
      .replace(INWARDS_LINE, 'const INWARDS = ["sh", "-c", "exec sleep 5"];')
      .replace(TIMEOUT_LINE, "const HOOK_TIMEOUT_MS = 200;");
    writeFileSync(join(other, PLUGIN), slow);
    const { hooks } = await load(other);
    const out = { output: "" };
    await hooks["tool.execute.after"](
      { tool: "write", sessionID: "ses_slow", args: { filePath: "shop/domain/order.py" } },
      out,
    );
    expect(out.output).toContain("Inwards couldn't check");
    expect(out.output).toContain("stopped (SIGTERM)");
  });
});
