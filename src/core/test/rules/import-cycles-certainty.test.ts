/**
 * @file When the import skeleton is certain to match the full parse, which
 * INW004 relies on to skip confirming a file. Plain code, comments, one-line
 * strings, brackets that close, and string prefixes are certain. An import
 * line inside a triple-quoted string, inside open brackets, after a backslash
 * continuation or inside a continued string is not, nor one after an
 * unclosed one-line string or a stray closing bracket. What comes after the
 * last import-looking line doesn't matter.
 */
import { expect, test } from "bun:test";
import { skeletonIsCertain as scan } from "../../src/python/import-certainty.ts";

/** A line the prescan copies as an import. */
const STARTS_IMPORT = /^[ \t]*(?:import[ \t]|from[ \t][^#\n]*[ \t]import\b)/u;

/**
 * Asks whether a text's skeleton is certain, with the skeleton's last import
 * on the last line that starts like one, as the prescan would report it.
 *
 * @param text - a file's text.
 * @returns what \`skeletonIsCertain\` says.
 */
function skeletonIsCertain(text: string): boolean {
  const lines = text.split("\n");
  const last = lines.findLastIndex((line) => STARTS_IMPORT.test(line));
  return scan(text, last + 1);
}

test("ordinary files are certain", () => {
  for (const text of [
    "import os\nfrom shop import domain\n",
    "# import os\nx = 'import os'\ny = \"from a import b\"\n",
    "items = (\n    1,\n    2,\n)\nimport os\n",
    "from x import (\n    a,\n    b,\n)\n",
    'DOC = """plain text"""\nimport os\n',
    "path = r'C:\\\\new'\nvalue = b'\\x00'\nimport os\n",
    "def f():\n    import os\n",
  ]) {
    expect([text, skeletonIsCertain(text)]).toEqual([text, true]);
  }
});

test("an import line the skeleton would read wrongly makes the file uncertain", () => {
  for (const text of [
    'NOTE = """\nimport os\n"""\n',
    "NOTE = '''\nfrom a import b\n'''\n",
    "items = (\nimport os\n)\n",
    "total = 1 + \\\nimport os\n",
    "text = 'a \\\nimport os'\n",
  ]) {
    expect([text, skeletonIsCertain(text)]).toEqual([text, false]);
  }
});

test("only what comes before the last import-looking line matters", () => {
  expect(skeletonIsCertain("import os\nx = (\n")).toBe(true);
  expect(skeletonIsCertain('import os\nx = """\n')).toBe(true);
  expect(skeletonIsCertain("x = )\nimport os\n")).toBe(false);
  expect(skeletonIsCertain("x = 'abc\nimport os\n")).toBe(false);
});
