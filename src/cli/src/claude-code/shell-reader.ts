/**
 * @file Reading a Bash command the way the config guard needs to: does any command
 * in it run `inwards hook` or `inwards baseline`, and does it only read? A
 * word-by-word reading, not one regex, so it stays linear on any input and can
 * skip what bash never runs (quoted heredoc bodies, backticks in single quotes).
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

/** One word of a simple command, as bash hands it to the program. */
interface Word {
  /** The word with its quotes and backslashes removed. */
  readonly text: string;
  /** False when an unquoted `$` or glob character lets bash turn it into other words. */
  readonly literal: boolean;
}

/** Where the reader stands in the command: the words so far and the one being read. */
interface Reading {
  /** The simple commands read so far; the last one is still being filled. */
  readonly commands: Word[][];
  text: string;
  literal: boolean;
  /** True once the current word has begun (`""` begins an empty word). */
  started: boolean;
  quote: "'" | '"' | undefined;
}

/**
 * Programs that only read the files they are given, each with the arguments
 * that would make it write or run a command: `find -delete`/`-exec`/`-fprint`,
 * `rg --pre`, `file -C` or any long option of `file` (GNU accepts abbreviations
 * such as `--comp` for `--compile`), `git … --output`. Where there
 * are such arguments, a word bash could expand (a glob matching a file named
 * `-delete`, a variable) is refused too.
 */
const READERS: ReadonlyMap<string, RegExp | undefined> = new Map([
  ["cat", undefined],
  ["head", undefined],
  ["tail", undefined],
  ["grep", undefined],
  ["wc", undefined],
  ["ls", undefined],
  ["stat", undefined],
  ["diff", undefined],
  ["find", /^-(?:delete|exec|execdir|ok|okdir|fprint0?|fprintf|fls)$/u],
  ["rg", /^--pre/u],
  ["file", /^(?:-[^-]*C|--)/u],
  ["git", /^--output/u],
]);
/** The only `git` subcommands read as read-only. */
const GIT_READS: ReadonlySet<string> = new Set(["status", "diff", "log", "show"]);
const BLANKS: ReadonlySet<string> = new Set([" ", "\t"]);
const SEPARATORS: ReadonlySet<string> = new Set([";", "&", "|", "\n"]);
/** Unquoted, these redirect, group or substitute; a command holding one isn't read as read-only. */
const UNSAFE: ReadonlySet<string> = new Set(["<", ">", "(", ")", "{", "}", "`"]);
/** Unquoted, these expand: parameters and globs. */
const EXPANDS: ReadonlySet<string> = new Set(["$", "*", "?", "["]);
/** What a backslash escapes inside double quotes; before anything else it stays. */
const DOUBLE_ESCAPES: ReadonlySet<string> = new Set(["$", "`", '"', "\\", "\n"]);

/**
 * Tells whether a shell command only reads files: a chain or pipeline
 * (`&&`, `||`, `;`, `|`) of `cat`, `head`, `tail`, `grep`, `rg`, `wc`, `ls`,
 * `stat`, `file`, `diff`, `find` and `git status|diff|log|show`, with none of
 * their writing options, and no redirection, substitution, subshell or group.
 *
 * The command is read once, character by character, the way bash splits it
 * into words (quotes, backslashes), so the time is linear in its length and a
 * quoted `-delete` is still seen. Anything the reader doesn't model counts as
 * not read-only, so the guard falls back to denying.
 *
 * @param command - the Bash tool's `command`.
 * @returns true when every command in it is one of the readers above.
 */
export function readsOnly(command: string): boolean {
  const commands = simpleCommands(command);
  return commands !== undefined && commands.length > 0 && commands.every(readerCommand);
}

/**
 * Splits a command line into simple commands and their words.
 *
 * @param command - the Bash tool's `command`.
 * @returns the non-empty simple commands, or undefined when the line holds
 *   something this reader doesn't model (redirection, substitution, a group,
 *   an unclosed quote).
 */
function simpleCommands(command: string): Word[][] | undefined {
  const reading: Reading = {
    commands: [[]],
    text: "",
    literal: true,
    started: false,
    quote: undefined,
  };
  let i = 0;
  while (i < command.length) {
    const read = step(reading, command, i);
    if (read === undefined) {
      return undefined;
    }
    i += read;
  }
  if (reading.quote !== undefined) {
    return undefined;
  }
  endWord(reading);
  return reading.commands.filter((words) => words.length > 0);
}

/**
 * Reads the character at `i` in the current quoting context.
 *
 * @param reading - the reader's state, updated in place.
 * @param command - the whole command.
 * @param i - the position to read.
 * @returns how many characters were read, or undefined to give up.
 */
function step(reading: Reading, command: string, i: number): number | undefined {
  if (reading.quote === "'") {
    return singleQuoted(reading, command[i] ?? "");
  }
  if (reading.quote === '"') {
    return doubleQuoted(reading, command, i);
  }
  return unquoted(reading, command, i);
}

/**
 * Reads one unquoted character: a blank, a separator, a quote, an escape or
 * part of a word.
 *
 * @param reading - the reader's state, updated in place.
 * @param command - the whole command.
 * @param i - the position to read.
 * @returns how many characters were read, or undefined to give up.
 */
function unquoted(reading: Reading, command: string, i: number): number | undefined {
  const c = command[i] ?? "";
  if (UNSAFE.has(c)) {
    return undefined;
  }
  if (BLANKS.has(c) || SEPARATORS.has(c)) {
    endWord(reading);
    if (SEPARATORS.has(c)) {
      reading.commands.push([]);
    }
    return 1;
  }
  if (c === "\\") {
    return escaped(reading, command[i + 1]);
  }
  if (c === "'" || c === '"') {
    reading.quote = c;
    reading.started = true;
    return 1;
  }
  if (EXPANDS.has(c)) {
    reading.literal = false;
  }
  append(reading, c);
  return 1;
}

/**
 * Reads one character inside single quotes, where everything is literal.
 *
 * @param reading - the reader's state, updated in place.
 * @param c - the character.
 * @returns 1.
 */
function singleQuoted(reading: Reading, c: string): number {
  if (c === "'") {
    reading.quote = undefined;
  } else {
    append(reading, c);
  }
  return 1;
}

/**
 * Reads one character inside double quotes, where `$` still expands and a
 * backslash escapes only `$`, a backtick, `"`, `\` and a newline.
 *
 * @param reading - the reader's state, updated in place.
 * @param command - the whole command.
 * @param i - the position to read.
 * @returns how many characters were read, or undefined at a substitution.
 */
function doubleQuoted(reading: Reading, command: string, i: number): number | undefined {
  const c = command[i] ?? "";
  const next = command[i + 1] ?? "";
  if (c === "`" || (c === "$" && next === "(")) {
    return undefined;
  }
  if (c === '"') {
    reading.quote = undefined;
    return 1;
  }
  if (c === "\\" && DOUBLE_ESCAPES.has(next)) {
    return escaped(reading, next);
  }
  if (c === "$") {
    reading.literal = false;
  }
  append(reading, c);
  return 1;
}

/**
 * Reads the character after a backslash: a newline joins two lines, anything
 * else is taken as it is.
 *
 * @param reading - the reader's state, updated in place.
 * @param next - the escaped character, if any.
 * @returns 2, the backslash and the character.
 */
function escaped(reading: Reading, next: string | undefined): number {
  if (next !== "\n") {
    append(reading, next ?? "");
  }
  return 2;
}

/**
 * Adds a character to the current word.
 *
 * @param reading - the reader's state, updated in place.
 * @param c - the character.
 */
function append(reading: Reading, c: string): void {
  reading.text += c;
  reading.started = true;
}

/**
 * Ends the current word, if one has begun, and adds it to the current command.
 *
 * @param reading - the reader's state, updated in place.
 */
function endWord(reading: Reading): void {
  if (reading.started) {
    reading.commands.at(-1)?.push({ text: reading.text, literal: reading.literal });
  }
  reading.text = "";
  reading.literal = true;
  reading.started = false;
}

/**
 * Tells whether one simple command is a reader with harmless arguments.
 *
 * @param words - one simple command, split into words the way bash does.
 * @returns true when its program is in READERS (`git` only with a subcommand
 *   in GIT_READS) and no argument is one that writes.
 */
function readerCommand(words: readonly Word[]): boolean {
  const [name, ...args] = words;
  if (!(name?.literal && READERS.has(name.text))) {
    return false;
  }
  if (name.text === "git" && !GIT_READS.has(args[0]?.text ?? "")) {
    return false;
  }
  const writes = READERS.get(name.text);
  return writes === undefined || args.every((w) => w.literal && !writes.test(w.text));
}
