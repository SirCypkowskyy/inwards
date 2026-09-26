import { expect, test } from "bun:test";
import { chmodSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";
import { CLAUDE_USER_DIR, CMD, project } from "./run.ts";

// The getting-started guides as E2E cases. A fence after a `<!-- e2e -->`
// line and one blank line (without it, the comment breaks a list item) runs,
// in page order, in one fresh project per page: `sh` fences in bash with
// `inwards` on PATH (the compiled binary in CI), and a fence with
// `title="<file>"` is written to that file. Untagged fences are prose and
// never run. Needs bash, so it does nothing on Windows.
const GUIDES = resolve(import.meta.dir, "../../../docs/chapters/guides");
const TAGGED =
  /^(?<indent> *)<!-- e2e -->\n\n\k<indent>```(?<lang>\w+)(?<info>[^\n]*)\n(?<body>[\s\S]*?)\n\k<indent>```$/gmu;
const TITLE = /title="(?<file>[^"]+)"/u;

/**
 * Turns the tagged fences of a guide into one bash script, in page order.
 * Fences may sit in a list item, so the item's indent is removed from each line.
 *
 * @param markdown - the guide's text.
 * @returns the script, empty when the guide tags nothing.
 */
function script(markdown: string): string {
  return [...markdown.matchAll(TAGGED)]
    .map(({ groups: g = {} }) => {
      const indent = g["indent"] ?? "";
      const body = (g["body"] ?? "")
        .split("\n")
        .map((line) => line.slice(indent.length))
        .join("\n");
      const file = TITLE.exec(g["info"] ?? "")?.groups?.["file"];
      if (file !== undefined) {
        return `cat > '${file}' <<'E2E_EOF'\n${body}\nE2E_EOF`;
      }
      return g["lang"] === "sh"
        ? body
        : `echo 'a tagged ${g["lang"]} fence needs title=' >&2; exit 1`;
    })
    .join("\n");
}

// `inwards` on PATH for the snippets: a shim that runs whatever the other tests run.
const BIN = project({ inwards: `#!/bin/sh\nexec ${CMD.map((a) => `'${a}'`).join(" ")} "$@"\n` });
chmodSync(join(BIN, "inwards"), 0o755);

// What a reader has after "add [tool.inwards] to pyproject.toml": one module per
// layer, imports pointing inward, and a git repository.
const SEED = {
  "pyproject.toml": `[tool.inwards]
layers = [
  { name = "domain", modules = ["shop.domain"] },
  { name = "application", modules = ["shop.application"] },
  { name = "infrastructure", modules = ["shop.infrastructure"] },
]
`,
  "shop/domain/order.py": "",
  "shop/application/place.py": "import shop.domain.order\n",
  "shop/infrastructure/db.py": "import shop.domain.order\n",
};

const guides = readdirSync(GUIDES)
  .filter((f) => f.endsWith(".md"))
  .sort();

test("guides tag at least one runnable snippet", () => {
  expect(guides.map((g) => script(readFileSync(join(GUIDES, g), "utf8"))).join("")).not.toBe("");
});

test.each(guides)("every e2e marker in %s tags a fence", (guide) => {
  const markdown = readFileSync(join(GUIDES, guide), "utf8");
  expect([...markdown.matchAll(TAGGED)].length).toBe(markdown.split("<!-- e2e -->").length - 1);
});

test.each(guides)("tagged snippets in %s run", (guide) => {
  if (process.platform === "win32") {
    return; // the snippets are POSIX shell
  }
  const root = project(SEED);
  Bun.spawnSync(["git", "init", "-q"], { cwd: root });
  const env = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        ([name]) => name !== "CLAUDE_PROJECT_DIR" && name !== "INWARDS_RUN_LOG",
      ),
    ),
    PATH: `${BIN}:${process.env["PATH"] ?? ""}`,
    CLAUDE_CONFIG_DIR: CLAUDE_USER_DIR,
  };
  const body = script(readFileSync(join(GUIDES, guide), "utf8"));
  // -x traces each command, so a failure shows which documented line broke.
  const p = Bun.spawnSync(["bash", "-euxo", "pipefail", "-c", body], { cwd: root, env });
  const out = `${p.stdout.toString()}${p.stderr.toString()}`;
  expect({ code: p.exitCode, out }).toMatchObject({ code: 0 });
});
