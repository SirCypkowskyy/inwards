/**
 * @file INW010 and a namespace package shared with an installed distribution
 * (#161): a local `acme/platform/billing/` under the implicit namespace
 * packages `acme` and `acme.platform`, and `acme/platform/auth/` installed in
 * the project's `.venv`. The CLI hands the engine the virtualenv's
 * site-packages as another portion, so `acme.platform.auth.tokens` passes and
 * a made-up module inside the local part is still reported; without a
 * virtualenv, `namespace-packages` does the same, the PostToolUse hook
 * agrees with `inwards check`, and the config guard keeps an agent from
 * adding the key itself.
 */
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { denied, pre } from "../support/guard-helpers.ts";
import { inwards, payload, project } from "../support/run.ts";

const CONFIG = `[project]
name = "acme-billing"
version = "0.1.0"

[tool.inwards]
layers = [{ name = "billing", modules = ["acme.platform.billing"] }]
`;
const INVOICES = "acme/platform/billing/invoices.py";
const SITE = ".venv/lib/python3.13/site-packages";
const INSTALLED = {
  [`${SITE}/acme/platform/auth/__init__.py`]: "",
  [`${SITE}/acme/platform/auth/tokens.py`]: "",
};

/**
 * Builds the project with one import in the billing module.
 *
 * @param source - the text of `acme/platform/billing/invoices.py`.
 * @param extra - more files, such as the virtualenv or another config.
 * @returns the project root.
 */
function billing(source: string, extra: Record<string, string> = {}): string {
  return project({
    "pyproject.toml": CONFIG,
    "acme/platform/billing/__init__.py": "",
    [INVOICES]: source,
    ...extra,
  });
}

/**
 * Runs `inwards check --format json` and keeps the finding codes and modules.
 *
 * @param root - the project root.
 * @returns the exit code and each finding as `code message-head`.
 */
function check(root: string): { code: number; found: string[] } {
  const { code, stdout } = inwards(["check", "--format", "json"], { cwd: root });
  const report: { diagnostics: { code: string; message: string }[] } = JSON.parse(stdout);
  return {
    code,
    found: report.diagnostics.map((d) => `${d.code} ${d.message.split(" ")[0] ?? ""}`),
  };
}

describe("namespace packages shared with an installed distribution (#161)", () => {
  test("a module the project's .venv holds reports nothing", () => {
    const root = billing("import acme.platform.auth.tokens\n", INSTALLED);
    expect(check(root)).toEqual({ code: 0, found: [] });
  });

  test("a made-up module inside the local package is still reported", () => {
    const root = billing("from acme.platform.billing.pricing import Price\n", INSTALLED);
    expect(check(root)).toEqual({
      code: 1,
      found: ['INW010 "acme.platform.billing.pricing"'],
    });
  });

  test("without a .venv the installed module is reported, and namespace-packages accepts it", () => {
    const src = "import acme.platform.auth.tokens\n";
    expect(check(billing(src))).toEqual({
      code: 1,
      found: ['INW010 "acme.platform.auth.tokens"'],
    });
    const listed = { "pyproject.toml": `${CONFIG}namespace-packages = ["acme.platform"]\n` };
    expect(check(billing(src, listed))).toEqual({ code: 0, found: [] });
  });

  test("the PostToolUse hook sees the .venv too", () => {
    const src = "import acme.platform.auth.tokens\n";
    /**
     * Sends PostToolUse for the billing module.
     *
     * @param root - the project root.
     * @returns the hook's exit code.
     */
    function posted(root: string): number {
      const stdin = payload("post-write-order", root, {
        tool_input: { file_path: join(root, INVOICES), content: src },
      });
      return inwards(["hook", "claude-code"], { cwd: root, stdin }).code;
    }
    expect(posted(billing(src, INSTALLED))).toBe(0);
    expect(posted(billing(src))).toBe(2);
  });

  test("an Edit that adds namespace-packages is denied", () => {
    const edit = {
      file_path: "pyproject.toml",
      old_string: "[tool.inwards]\n",
      new_string: '[tool.inwards]\nnamespace-packages = ["acme.platform"]\n',
    };
    expect(denied(pre(billing(""), "Edit", edit))).toBeDefined();
  });
});
