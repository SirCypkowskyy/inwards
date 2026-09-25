import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectPythonFiles } from "../src/files.ts";

test("walks build/dist/site inside packages, skips venvs and hidden dirs", () => {
  const root = mkdtempSync(join(tmpdir(), "inwards-files-"));
  const put = (rel: string) => {
    mkdirSync(join(root, rel, ".."), { recursive: true });
    writeFileSync(join(root, rel), "");
  };
  put("shop/domain/build/leak.py");
  put("shop/dist/x.py");
  put(".venv/lib/site.py");
  writeFileSync(join(root, ".venv/pyvenv.cfg"), "");
  put("env/lib/y.py");
  writeFileSync(join(root, "env/pyvenv.cfg"), "");
  put(".git/hooks/z.py");
  const found = collectPythonFiles([root]).map((f) => f.slice(root.length + 1));
  expect(found).toEqual(["shop/dist/x.py", "shop/domain/build/leak.py"]);
});
