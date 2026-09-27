import { expect, test } from "bun:test";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { collectPythonFiles } from "../src/adapters/file-walk.ts";
import { tempDir } from "./temp.ts";

test("walks build/dist/site inside packages, skips venvs and hidden dirs", () => {
  const root = tempDir("inwards-files-");
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

test("lists a file under every name Python could import it by, and survives a cycle", () => {
  const root = tempDir("inwards-files-");
  mkdirSync(join(root, "real/pkg"), { recursive: true });
  writeFileSync(join(root, "real/pkg/mod.py"), "");
  mkdirSync(join(root, "shop"));
  symlinkSync(join(root, "real/pkg"), join(root, "shop/pkg"));
  symlinkSync(join(root, "shop"), join(root, "real/pkg/loop"));
  const found = collectPythonFiles([root]).map((f) => relative(root, f).split(sep).join("/"));
  expect(found).toEqual(["real/pkg/mod.py", "shop/pkg/mod.py"]);
});

test("never follows a link out of the directory it was asked to walk", () => {
  const outside = tempDir("inwards-outside-");
  writeFileSync(join(outside, "secret.py"), "");
  const root = tempDir("inwards-files-");
  symlinkSync(outside, join(root, "home"));
  symlinkSync(join(outside, "secret.py"), join(root, "linked.py"));
  expect(collectPythonFiles([root])).toEqual([]);
});
