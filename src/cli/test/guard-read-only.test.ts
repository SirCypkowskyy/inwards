import { describe, expect, test } from "bun:test";
import { denied, pre } from "./guard-helpers.ts";
import { session } from "./stop-helpers.ts";

describe("config guard: read-only Bash that names protected files (#135)", () => {
  const root = session();

  test.each([
    // The two commands the agent eval saw denied.
    "ls -la .inwards && find . -path ./.git -prune -o -type f -print | grep -v .git",
    "find . -path ./.git -prune -o -path ./.inwards -prune -o -type f -print",
    "find . -path ./.inwards -prune -o -type f",
    'find . -path ./.inwards -prune -o -name "*.py" -print',
    "ls -la .inwards",
    "cat .inwards/state/s.jsonl",
    "head -n 5 .inwards/state/s.jsonl",
    "tail -n 1 .inwards/runs.jsonl",
    "grep -c Stop .claude/settings.local.json",
    "rg -n INW001 .inwards",
    "wc -l inwards-baseline.json",
    "stat .inwards",
    "file inwards-baseline.json",
    "diff .claude/settings.json .claude/settings.local.json",
    "git status --short .inwards",
    "git diff -- inwards-baseline.json",
    "git log --oneline -- .claude/settings.json",
    "git show HEAD:inwards-baseline.json",
    "ls .inwards; cat .inwards/state/s.jsonl",
    "stat .inwards || ls -la",
    "cat .inwards/state/s.jsonl | grep Edit | wc -l",
    'grep -rn "a|b;c > d" .inwards',
    "ls \\\n  .inwards",
  ])("%j passes", (command) => {
    expect(denied(pre(root, "Bash", { command }))).toBeUndefined();
  });

  test.each([
    "rm -rf .inwards/state",
    "mv .inwards /tmp/elsewhere",
    "cp /tmp/x .inwards/state/s.jsonl",
    "cp /tmp/x inwards-baseline.json",
    "sed -i s/a/b/ inwards-baseline.json",
    "truncate -s 0 .inwards/state/s.jsonl",
    "cat /tmp/x > .inwards/state/s.jsonl",
    "cat /tmp/x >> inwards-baseline.json",
    "cat .inwards/x <> .inwards/y",
    "ls .inwards &> .inwards/log",
    "ls .inwards 2> .inwards/err",
    "find .inwards -delete",
    "find .inwards -type f -exec rm {} +",
    "find .inwards -execdir rm {} +",
    "find .inwards -ok rm {} ;",
    "find .inwards -fprint .inwards/list",
    'find .inwards "-del"ete',
    "find .inwards -de*",
    "ls .inwards | tee .inwards/x",
    "chmod 000 .inwards",
    "ln -sf /tmp .inwards/state",
    "ls .inwards | xargs rm -rf",
    "cat $(rm -rf .inwards)",
    "cat `rm -rf .inwards`",
    "diff <(rm -rf .inwards) x",
    "(rm -rf .inwards)",
    "ls .inwards && rm -rf .inwards",
    "ls .inwards\nrm -rf .inwards",
    "ls .inwards; sed -i s/Stop/X/ .claude/settings.local.json",
    "git diff --output=inwards-baseline.json",
    "rg --pre rm x .inwards",
    "file -C -m .inwards/magic",
    "file --comp -m .inwards/magic",
    "cat '.inwards/unclosed",
  ])("%j is denied", (command) => {
    expect(denied(pre(root, "Bash", { command }))).toContain("ask the user");
  });

  test("long commands are read in linear time", () => {
    const started = performance.now();
    const chain = "ls .inwards && ".repeat(20_000);
    expect(denied(pre(root, "Bash", { command: `${chain}cat x` }))).toBeUndefined();
    expect(denied(pre(root, "Bash", { command: `${chain}rm -rf .inwards` }))).toContain("ask");
    expect(denied(pre(root, "Bash", { command: ".claude ".repeat(40_000) }))).toBeUndefined();
    const quotes = `cat .inwards ${"'a'\\\"".repeat(40_000)}`;
    expect(denied(pre(root, "Bash", { command: quotes }))).toBeUndefined();
    expect(performance.now() - started).toBeLessThan(2000);
  });
});
