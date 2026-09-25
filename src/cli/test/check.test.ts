import { expect, test } from "bun:test";
import { inwards, LAYERS, project } from "./run.ts";

const leak = project({
  "pyproject.toml": LAYERS,
  "shop/domain/deep/order.py": "import shop.infrastructure.db\n",
});

test("diagnostic paths use forward slashes on every OS", () => {
  const { code, stdout } = inwards(["check", "--format", "json"], { cwd: leak });
  expect(code).toBe(1);
  expect(JSON.parse(stdout).diagnostics[0].file).toBe("shop/domain/deep/order.py");
});

test("SARIF artifact URIs use forward slashes on every OS", () => {
  const { stdout } = inwards(["check", "--format", "sarif"], { cwd: leak });
  const uri = JSON.parse(stdout).runs[0].results[0].locations[0].physicalLocation.artifactLocation;
  expect(uri).toEqual({ uri: "shop/domain/deep/order.py", uriBaseId: "%SRCROOT%" });
});
