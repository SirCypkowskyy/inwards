import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { collectPythonFiles } from "../src/files.ts";

test("walks build/dist/site inside packages, skips venvs and hidden dirs", () => {
  const root = mkdtempSync(join(tmpdir(), "inwards-files-"));
  /**
   * Creates an empty file, and its parent directories, under the temp root.
   *
   * @param rel - path relative to the temp root.
   */
  function put(rel: string): void {
    mkdirSync(join(root, rel, ".."), { recursive: true });
    writeFileSync(join(root, rel), "");
  }
  put("shop/domain/build/leak.py");
  put("shop/dist/x.py");
  put(".venv/lib/site.py");
  writeFileSync(join(root, ".venv/pyvenv.cfg"), "");
  put("env/lib/y.py");
  writeFileSync(join(root, "env/pyvenv.cfg"), "");
  put(".git/hooks/z.py");
  const found = collectPythonFiles([root]).map((f) => relative(root, f).split(sep).join("/"));
  expect(found).toEqual(["shop/dist/x.py", "shop/domain/build/leak.py"]);
});

test("follows symlinked packages once, even through a link cycle", () => {
  const root = mkdtempSync(join(tmpdir(), "inwards-files-"));
  mkdirSync(join(root, "real/pkg"), { recursive: true });
  writeFileSync(join(root, "real/pkg/mod.py"), "");
  mkdirSync(join(root, "shop"));
  symlinkSync(join(root, "real/pkg"), join(root, "shop/pkg"));
  symlinkSync(join(root, "shop"), join(root, "real/pkg/loop"));
  const found = collectPythonFiles([join(root, "shop")]).map((f) =>
    relative(root, f).split(sep).join("/"),
  );
  expect(found).toEqual(["shop/pkg/mod.py"]);
});
