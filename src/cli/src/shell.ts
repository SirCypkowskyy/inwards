/**
 * Reading a Bash command the way the config guard needs to: does any command
 * in it run `inwards hook` or `inwards baseline`? A word-by-word reading, not
 * one regex, so it stays linear on any input and can skip what bash never
 * runs (quoted heredoc bodies, backticks in single quotes).
 */

/** Where a new command can start in a shell line: separators, subshells, substitutions. */
const COMMAND_BREAK = /[;&|\n`(]|\$\(/u;
const WHITESPACE = /\s+/u;
/** Quotes around a word, and the `(` or `)` of a subshell or substitution next to it. */
const QUOTES = /^["'(]+|["')]+$/gu;
/** `<<'EOF'` or `<<"EOF"`: bash expands nothing in that heredoc's body. */
const QUOTED_HEREDOC = /<<-?\s*(?<quote>['"])(?<end>\w+)\k<quote>/u;
const SINGLE_QUOTED = /'[^'\n]*'/gu;
const BACKTICK = /`/gu;
/** A version or extra after a package name: `inwards@latest`, `inwards==0.2`. */
const PACKAGE_SUFFIX = /(?:@|==|\[).*$/u;
const ASSIGNMENT = /^\w+=/u;
const PATH_SEPARATOR = /[\\/]/u;
/** `-u` or `--from`; a lone `-` (a Markdown bullet in a heredoc) isn't one. */
const OPTION = /^--?[A-Za-z]/u;
const PYTHON = /^(?:python[\d.]*|py)$/u;
/** Words that run the next word as a command, and the second word of `uv run` and the like. */
const RUNNERS: ReadonlySet<string> = new Set([
  "uvx",
  "bunx",
  "npx",
  "env",
  "sudo",
  "command",
  "exec",
  "nice",
  "time",
  "nohup",
  "uv",
  "bun",
  "pipx",
  "poetry",
  "pdm",
  "hatch",
  "bash",
  "sh",
  "zsh",
  "run",
  "x",
  "tool",
  "-m",
  "-c",
]);

/**
 * Tells whether a shell command runs `inwards hook` or `inwards baseline`,
 * directly or behind a runner (`uvx --from inwards inwards baseline`,
 * `env X=1 inwards hook`, `python -m inwards baseline`). Each command in the
 * line is read word by word, so a commit message or a grep that mentions the
 * words isn't caught, and the time stays linear in the command's length.
 *
 * @param command - the Bash tool's `command`.
 * @returns true when some command in it runs one of the two.
 */
export function runsInwards(command: string): boolean {
  return shellText(command)
    .split(COMMAND_BREAK)
    .some((segment) => {
      const words = segment
        .trim()
        .split(WHITESPACE)
        .map((w) => w.replace(QUOTES, ""));
      for (let i = 0; i < words.length; i += 1) {
        if (callsInwards(words, i)) {
          return true;
        }
        if (!mayPrecede(words, i)) {
          return false;
        }
      }
      return false;
    });
}

/**
 * Drops the text bash never runs, so a commit message or PR body that quotes
 * a command isn't read as one: the bodies of quoted heredocs, and backticks
 * inside single quotes (literal there).
 *
 * @param command - the Bash tool's `command`.
 * @returns the command with that text removed or neutralised.
 */
function shellText(command: string): string {
  const kept: string[] = [];
  let end: string | undefined;
  for (const line of command.split("\n")) {
    if (end !== undefined) {
      end = line.trim() === end ? undefined : end;
      continue;
    }
    kept.push(line.replace(SINGLE_QUOTED, (quoted) => quoted.replace(BACKTICK, " ")));
    end = QUOTED_HEREDOC.exec(line)?.groups?.["end"];
  }
  return kept.join("\n");
}

/**
 * Tells whether the words at `i` are `inwards hook` or `inwards baseline`.
 *
 * @param words - one command's words, unquoted.
 * @param i - the position to look at.
 * @returns true for the executable (any path, `.exe`, `@version`) followed by one of the two.
 */
function callsInwards(words: readonly string[], i: number): boolean {
  const name = (words[i]?.split(PATH_SEPARATOR).at(-1) ?? "").replace(PACKAGE_SUFFIX, "");
  return (
    (name === "inwards" || name === "inwards.exe") &&
    ["hook", "baseline"].includes(words[i + 1] ?? "")
  );
}

/**
 * Tells whether a word can come before the command a runner starts: a runner,
 * an option or its value, or a `VAR=value` assignment.
 *
 * @param words - one command's words, unquoted.
 * @param i - the position of the word.
 * @returns true when reading may go on to the next word.
 */
function mayPrecede(words: readonly string[], i: number): boolean {
  const word = words[i] ?? "";
  const optionValue = i > 0 && OPTION.test(words[i - 1] ?? "");
  return (
    RUNNERS.has(word) ||
    PYTHON.test(word) ||
    OPTION.test(word) ||
    ASSIGNMENT.test(word) ||
    optionValue
  );
}
