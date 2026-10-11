/**
 * @file The CLI's usage text: the overview `inwards --help` prints, and each
 * command's own usage for `inwards COMMAND --help` and that command's usage
 * errors. The style and agent lists come from `init`'s own constants, so a new
 * preset shows up here without an edit. It only builds strings; `main.ts`
 * decides when to print them and with which exit code.
 */
import { VERSION } from "@inwards/core";
import { AGENTS } from "../init/contracts.ts";
import { STYLE_NAMES } from "../init/styles.ts";

/** Every command `main.ts` routes, in the order the overview lists them. */
export const COMMANDS = [
  "check",
  "baseline",
  "init",
  "context",
  "import-config",
  "stats",
  "hook",
  "daemon",
  "server",
  "mcp",
] as const;
export type Command = (typeof COMMANDS)[number];

/** One command's usage: its synopsis lines and what it does. */
interface CommandHelp {
  /** Synopsis lines without the leading `inwards`; continuation lines start with spaces. */
  synopsis: readonly string[];
  /** A short note for the overview, after the synopsis. */
  note: string;
  /** What `inwards COMMAND --help` says below the synopsis. */
  about: string;
}

/** The widest overview line that keeps a note beside its synopsis. */
const WIDTH = 110;

/** Where an overview note starts on its own line: under the first option, after `Usage: inwards COMMAND `. */
const NOTE_INDENT: number = "Usage: inwards  ".length;

const CONFIG_OPTION =
  "--config FILE: the pyproject.toml to read, instead of the nearest one with [tool.inwards].";

const HELP: Readonly<Record<Command, CommandHelp>> = {
  check: {
    synopsis: [
      "check [PATHS...] [--format text|concise|json|sarif] [--max-diagnostics N]",
      "      [--config pyproject.toml] [--log] [--no-cache]",
    ],
    note: "(PATHS: those files only; whole-project checks such as dead layer\nprefixes, import cycles and symlinks in layers run without PATHS)",
    about: `Checks Python imports against the layers declared in [tool.inwards].

PATHS: check those files or directories only; whole-project checks such as
dead layer prefixes, import cycles and symlinks in layers run without PATHS.
--format: text (default), concise, json (inwards/diagnostics@1) or sarif.
--max-diagnostics N: print at most N findings (not with sarif).
${CONFIG_OPTION}
--log: append this run to .inwards/runs.jsonl even when the run log is off.
--no-cache: parse every file again instead of reusing the extraction cache.

Exit codes: 0 clean or warnings only, 1 errors, 2 usage or config error.`,
  },
  baseline: {
    synopsis: ["baseline [--config pyproject.toml] [--no-cache]"],
    note: "(accept today's violations)",
    about: `Records today's violations in inwards-baseline.json next to the config, so check
reports only new ones.

${CONFIG_OPTION}
--no-cache: parse every file again instead of reusing the extraction cache.`,
  },
  init: {
    synopsis: [
      `init --style ${STYLE_NAMES.join("|")}`,
      "     [--scaffold] [--package NAME] [--agent ...] [--dry-run]",
      `init --agent ${AGENTS.join("|")} [--launcher "uv run"] [--shared] [--dry-run]`,
      "init --brief [--dry-run]",
      "init --list-styles [--package NAME]",
    ],
    note: "(--list-styles: the presets; --brief: also the architecture brief in AGENTS.md)",
    about: `Sets Inwards up: a preset's [tool.inwards], an example scaffold and an agent's wiring.
On a terminal with no flags it asks; elsewhere it needs --style, --agent or --brief.

--style: write that preset's [tool.inwards] (--list-styles describes each one).
--scaffold: also write the preset's example package; --package NAME names it.
--agent: wire the hook (claude), the plugin (opencode), the lint command (aider)
or the instructions (agents-md); --launcher sets the command that runs inwards.
--shared: with --agent claude, write the hooks into the committed .claude/settings.json
and the MCP server into .mcp.json; needs --launcher or inwards on PATH.
--brief: also write the architecture brief into AGENTS.md.
--dry-run: print the changes instead of writing them.`,
  },
  context: {
    synopsis: ["context [--config pyproject.toml] [--write]"],
    note: "(the architecture brief; --write: into AGENTS.md)",
    about: `Prints the architecture brief for agents, built from [tool.inwards].

${CONFIG_OPTION}
--write: write it into AGENTS.md instead of printing it.`,
  },
  "import-config": {
    synopsis: ["import-config [FILE] [--write]"],
    note: "(import-linter contracts as [tool.inwards]; --write: into pyproject.toml)",
    about: `Converts import-linter contracts into a [tool.inwards] table and prints it.

FILE: the import-linter config (.importlinter, setup.cfg or pyproject.toml);
without it, the first one found in the working directory.
--write: append the table to the pyproject.toml beside FILE.`,
  },
  stats: {
    synopsis: ["stats [DIR] [--format text|json] [--export FILE [--redact]]"],
    note: "(hypothesis numbers from the run logs)",
    about: `Summarises the run logs of the project in DIR (default: the working directory).

--format: text (default) or json.
--export FILE: write the merged run log to FILE; --redact replaces its paths and
fingerprints with keyed hashes.`,
  },
  hook: {
    synopsis: ["hook claude-code"],
    note: "(reads a Claude Code hook payload on stdin)",
    about: `Runs one Claude Code hook: reads its JSON payload on stdin.
Claude Code runs it; inwards init --agent claude wires it in.`,
  },
  daemon: {
    synopsis: ["daemon [status|stop] [--idle SECONDS]"],
    note: "(keeps PostToolUse warm; hooks start it)",
    about: `Keeps the engine warm for the PostToolUse hook, for the project in the working directory.
Hooks start it, and it exits after --idle SECONDS without a request (default 600).

status: say whether this project's daemon is running.
stop: stop it.`,
  },
  server: {
    synopsis: ["server [--stdio]"],
    note: "(the language server, LSP over stdio; editors start it)",
    about:
      "Runs the language server over stdio. Editors start it; --stdio is accepted and changes nothing.",
  },
  mcp: {
    synopsis: ["mcp"],
    note: "(the MCP server over stdio; agents' MCP clients start it)",
    about: "Runs the MCP server over stdio. Agents' MCP clients start it.",
  },
};

/**
 * Tells whether a positional names a command.
 *
 * @param word - the first positional, if any.
 * @returns true for one of {@link COMMANDS}.
 */
export function isCommand(word: string | undefined): word is Command {
  return COMMANDS.some((name) => name === word);
}

/**
 * Lays synopsis lines out after a prefix, indenting continuation lines under
 * the first one's command and every further `inwards` line under the first.
 *
 * @param prefix - what goes before the first line, e.g. `Usage: `.
 * @param lines - the synopsis lines, each starting with the command or with spaces.
 * @returns the lines joined, each new command prefixed with `inwards`.
 */
function synopsisLines(prefix: string, lines: readonly string[]): string[] {
  const pad = " ".repeat(prefix.length);
  return lines.map((line, i) => {
    const lead = i === 0 ? prefix : pad;
    return line.startsWith(" ") ? `${pad}        ${line}` : `${lead}inwards ${line}`;
  });
}

/**
 * Builds the overview `inwards --help` prints: every command's synopsis with
 * its note, and how to get one command's usage.
 *
 * @returns the text, without a trailing newline.
 */
export function overview(): string {
  const body = COMMANDS.flatMap((command, i) => {
    const { synopsis, note } = HELP[command];
    const lines = synopsisLines(i === 0 ? "Usage: " : "       ", synopsis);
    const [only] = lines;
    if (lines.length === 1 && only !== undefined && !note.includes("\n")) {
      const inline = `${only}    ${note}`;
      if (inline.length <= WIDTH) {
        return [inline];
      }
    }
    const indent = " ".repeat(NOTE_INDENT + command.length);
    return [...lines, ...note.split("\n").map((part) => `${indent}${part}`)];
  });
  return `inwards ${VERSION}

${body.join("\n")}

Run inwards COMMAND --help for one command's options.
Checks Python imports against the layers declared in [tool.inwards].`;
}

/**
 * Builds one command's usage, for `inwards COMMAND --help` and its usage errors.
 *
 * @param command - which command, e.g. `check`.
 * @returns its synopsis and what it does, without a trailing newline.
 */
export function commandUsage(command: Command): string {
  const { synopsis, about } = HELP[command];
  return `${synopsisLines("Usage: ", synopsis).join("\n")}\n\n${about}`;
}
