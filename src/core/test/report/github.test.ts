/**
 * @file Tests the `github` reporter: one workflow command per diagnostic, the
 * escaping `@actions/core` uses for messages and properties, and the columns
 * left out of a span over several lines. The paths are whatever the adapter
 * passes; making them relative to the checkout is the CLI's test.
 */
import { describe, expect, test } from "bun:test";
import { render } from "../../src/index.ts";
import { check, file } from "../support/helpers.ts";

describe("github reporter", () => {
  const diagnostics = check(file("shop/domain/order.py", "import shop.infrastructure.db\n"));
  const report = { diagnostics, filesChecked: 1, durationMs: 1.23 };
  const [error] = diagnostics;

  test("one workflow command per diagnostic, then the summary", () => {
    const [command, summary, ...rest] = render(report, "github").split("\n");
    expect(command).toStartWith(
      "::error file=shop/domain/order.py,line=1,endLine=1,col=8,endColumn=",
    );
    expect(command).toContain(",title=INW001::");
    expect(command).toContain("%0AFix: ");
    expect(summary).toStartWith("Found 1 violation");
    expect(rest).toEqual([]);
  });

  test("escapes the message and the properties as @actions/core does", () => {
    const odd = error
      ? [{ ...error, file: "a,b:c%.py", message: "100% off\r\nnext", severity: "warning" as const }]
      : [];
    const [command] = render({ ...report, diagnostics: odd }, "github").split("\n");
    expect(command).toStartWith("::warning file=a%2Cb%3Ac%25.py,line=1,");
    expect(command).toContain("::100%25 off%0D%0Anext%0AFix: ");
  });

  test("leaves out columns on a span over several lines", () => {
    const wide = error ? [{ ...error, endLine: 3 }] : [];
    const [command] = render({ ...report, diagnostics: wide }, "github").split("\n");
    expect(command).toStartWith(
      "::error file=shop/domain/order.py,line=1,endLine=3,title=INW001::",
    );
  });

  test("a named path that gave nothing to check is a warning with no file", () => {
    const notChecked = [{ path: "docs", message: "docs has no Python files: 50% done" }];
    const out = render({ ...report, diagnostics: [], filesChecked: 0, notChecked }, "github");
    expect(out.split("\n")).toEqual([
      "::warning::docs has no Python files: 50%25 done",
      "Nothing checked: 0 files (1.2 ms).",
    ]);
  });
});
