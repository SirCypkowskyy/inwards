import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parseConfig } from "@inwards/core";
import { workspaceDiagnostics } from "../src/server/workspace.ts";

const TMP = mkdtempSync(join(tmpdir(), "inwards-workspace-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

const CONFIG = parseConfig(`[tool.inwards]
layers = [{ name = "app", modules = ["app"] }]

[[tool.inwards.shape]]
packages = ["app.*"]
allow = ["router"]
require = ["__init__", "router", "service"]
`);

/**
 * Writes files under the test directory.
 *
 * @param files - contents by path relative to it.
 */
function write(files: Record<string, string>): void {
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(TMP, rel)), { recursive: true });
    writeFileSync(join(TMP, rel), text);
  }
}

test("the workspace pass follows symlinks inside the root, and not those leaving it", () => {
  write({
    "root/app/__init__.py": "",
    "root/app/orders/__init__.py": "",
    "root/app/orders/router.py": "",
    "root/shared/service.py": "",
    "root/shared/users/__init__.py": "",
    "root/shared/users/router.py": "",
    "root/shared/users/helpers.py": "",
    "outside/billing/__init__.py": "",
    "outside/billing/helpers.py": "",
  });
  const root = join(TMP, "root");
  symlinkSync(join(root, "shared/service.py"), join(root, "app/orders/service.py"));
  symlinkSync(join(root, "shared/users"), join(root, "app/users"), "dir");
  symlinkSync(join(TMP, "outside/billing"), join(root, "app/billing"), "dir");
  symlinkSync(root, join(root, "app/orders/loop"), "dir");

  const found = [...workspaceDiagnostics(CONFIG, root)].flatMap(([path, ds]) =>
    ds.map((d) => [d.code, path.slice(root.length + 1).replaceAll("\\", "/")]),
  );
  // orders' service.py is a symlink and counts; users is reached through one;
  // billing points outside the root and the loop back to it isn't walked twice.
  expect(found.sort()).toEqual([
    ["INW007", "app/users/helpers.py"],
    ["INW008", "app/users/__init__.py"],
  ]);
});
