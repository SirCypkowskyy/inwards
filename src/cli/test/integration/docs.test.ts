/**
 * @file Runs the documented shell snippets: every guide and rule page tags its
 * runnable commands with `<!-- e2e -->`, and each one must work against the
 * compiled CLI with the output the page shows. The harness is written for bash
 * 3.2, which macOS ships.
 */
import { expect, test } from "bun:test";
import { chmodSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";
import { CLAUDE_USER_DIR, CMD, project } from "../support/run.ts";

// The getting-started guides and the rule pages as E2E cases. A fence after a
// `<!-- e2e -->` line and one blank line (without it, the comment breaks a list
// item) runs, in page order, in one fresh project per page: `sh` fences in bash
// with `inwards` on PATH (the compiled binary in CI), and a fence with
// `title="<file>"` is written to that file, its directories created. A tagged
// `text` fence right after a tagged `sh` fence is that command's documented
// output: the command may then exit non-zero (a check that finds something
// exits 1), and the text must appear verbatim in what it prints (stdout and
// stderr). Untagged fences are prose and never run.
// Needs bash, so it does nothing on Windows.
const CHAPTERS = resolve(import.meta.dir, "../../../../docs/chapters");
const TAGGED =
  /^(?<indent> *)<!-- e2e -->\n\n\k<indent>```(?<lang>\w+)(?<info>[^\n]*)\n(?<body>[\s\S]*?)\n\k<indent>```$/gmu;
// Any spelling of the marker, so a near miss fails instead of silently not running.
const MARKER = /<!--\s*e2e\s*-->/gu;
const TITLE = /title="(?<file>[^"]+)"/u;
// A rule's own page, such as rules/INW001.md or rules/FAPI002.md.
const RULE_PAGE = /^rules\/[A-Z]+\d{3}\.md$/u;

/** One tagged fence, with the list item's indent already removed. */
interface Fence {
  lang: string;
  file: string | undefined;
  body: string;
}

/**
 * Reads the tagged fences of a page, in page order.
 * Fences may sit in a list item, so the item's indent is removed from each line.
 *
 * @param markdown - the page's text.
 * @returns each tagged shell fence with its expected output, in page order.
 */
function fences(markdown: string): Fence[] {
  return [...markdown.matchAll(TAGGED)].map(({ groups: g = {} }) => {
    const indent = g["indent"] ?? "";
    const body = (g["body"] ?? "")
      .split("\n")
      .map((line) => line.slice(indent.length))
      .join("\n");
    return { lang: g["lang"] ?? "", file: TITLE.exec(g["info"] ?? "")?.groups?.["file"], body };
  });
}

/**
 * Tells whether a fence is the documented output of the command before it.
 *
 * @param fence - the fence, or undefined past the last one.
 * @returns true for an untitled `text` fence.
 */
function isOutput(fence: Fence | undefined): boolean {
  return fence?.lang === "text" && fence.file === undefined;
}

/**
 * Turns the tagged fences of a page into one bash script, in page order.
 *
 * @param markdown - the page's text.
 * @returns the script, empty when the page tags nothing.
 */
function script(markdown: string): string {
  const all = fences(markdown);
  return all
    .map((fence, i) => {
      if (fence.file !== undefined) {
        const mkdir = `mkdir -p -- "$(dirname -- '${fence.file}')"`;
        return `${mkdir}\ncat > '${fence.file}' <<'E2E_EOF'\n${fence.body}\nE2E_EOF`;
      }
      // Text goes into $(...) only through a function: bash 3.2 (macOS /bin/bash)
      // matches quotes inside $(...) across a heredoc body, so the apostrophe in
      // a documented "Don't" there ends the script with "unexpected EOF".
      if (fence.lang === "sh" && isOutput(all[i + 1])) {
        // The exit code is free; the documented output below must appear in full.
        return `e2e_run() {\n${fence.body}\n}\nE2E_OUT=$(e2e_run 2>&1) || true`;
      }
      if (fence.lang === "sh") {
        return fence.body;
      }
      if (isOutput(fence) && all[i - 1]?.lang === "sh") {
        return [
          `e2e_want() {\ncat <<'E2E_EOF'\n${fence.body}\nE2E_EOF\n}`,
          "E2E_WANT=$(e2e_want)",
          `[[ "$E2E_OUT" == *"$E2E_WANT"* ]] || { printf 'documented output not in:\\n%s\\n' "$E2E_OUT" >&2; exit 1; }`,
        ].join("\n");
      }
      return `echo 'a tagged ${fence.lang} fence needs title=, or must follow a tagged sh fence' >&2; exit 1`;
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

// Pages relative to docs/chapters: every guide and every rule page.
const guides = ["guides", "rules"]
  .flatMap((dir) =>
    readdirSync(join(CHAPTERS, dir))
      .filter((f) => f.endsWith(".md"))
      .map((f) => `${dir}/${f}`),
  )
  .sort();

test("guides tag at least one runnable snippet", () => {
  expect(guides.map((g) => script(readFileSync(join(CHAPTERS, g), "utf8"))).join("")).not.toBe("");
});

// Every rule page that ships a check; a registered rule whose check is still
// planned (`status: planned`) has nothing to show yet.
const shipped = guides.filter(
  (g) =>
    RULE_PAGE.test(g) && !readFileSync(join(CHAPTERS, g), "utf8").includes("\nstatus: planned\n"),
);

test.each(shipped)("%s shows a flagged example with its documented output", (page) => {
  const tagged = fences(readFileSync(join(CHAPTERS, page), "utf8"));
  expect(tagged.some((fence, i) => fence.lang === "sh" && isOutput(tagged[i + 1]))).toBe(true);
});

test.each(guides)("every e2e marker in %s tags a fence", (guide) => {
  const markdown = readFileSync(join(CHAPTERS, guide), "utf8");
  expect([...markdown.matchAll(TAGGED)].length).toBe([...markdown.matchAll(MARKER)].length);
});

test.each(guides)("tagged snippets in %s run", (guide) => {
  if (process.platform === "win32") {
    return; // the snippets are POSIX shell
  }
  const root = project(SEED);
  // No inherited GIT_* variables or user git config: the snippets see a plain repository.
  const env = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        ([name]) =>
          name !== "CLAUDE_PROJECT_DIR" &&
          name !== "INWARDS_RUN_LOG" &&
          name !== "FORCE_COLOR" &&
          !name.startsWith("GIT_"),
      ),
    ),
    PATH: `${BIN}:${process.env["PATH"] ?? ""}`,
    CLAUDE_CONFIG_DIR: CLAUDE_USER_DIR,
    GIT_CONFIG_GLOBAL: "/dev/null",
  };
  Bun.spawnSync(["git", "init", "-q"], { cwd: root, env });
  const body = script(readFileSync(join(CHAPTERS, guide), "utf8"));
  // -x traces each command, so a failure shows which documented line broke.
  const p = Bun.spawnSync(["bash", "-euxo", "pipefail", "-c", body], { cwd: root, env });
  const out = `${p.stdout.toString()}${p.stderr.toString()}`;
  expect({ code: p.exitCode, out }).toMatchObject({ code: 0 });
});
