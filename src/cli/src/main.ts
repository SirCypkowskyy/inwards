#!/usr/bin/env bun
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import {
  ConfigError,
  Engine,
  type Format,
  moduleNameFor,
  parseConfig,
  type Report,
  render,
  type SourceFile,
  VERSION,
} from "@inwards/core";
import { collectPythonFiles } from "./files.ts";
import { loadGrammars } from "./grammars.ts";

// Exit codes follow Ruff: 0 clean, 1 violations, 2 usage or config error.
const USAGE = `inwards ${VERSION}

Usage: inwards check [PATHS...] [--format text|json|sarif] [--config pyproject.toml]
       inwards hook claude-code    (reads a Claude Code hook payload on stdin)

Checks Python imports against the layers declared in [tool.inwards].`;

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      format: { type: "string", default: "text" },
      config: { type: "string" },
      version: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.version) return print(VERSION, 0);
  const [command, ...paths] = positionals;
  if (command === "hook" && !values.help) {
    return paths[0] === "claude-code" && paths.length === 1 ? hookClaudeCode() : print(USAGE, 2);
  }
  if (values.help || command !== "check") return print(USAGE, command ? 2 : 0);

  const format = values.format as Format;
  if (!["text", "json", "sarif"].includes(format)) return print(`Unknown --format ${format}`, 2);

  const configPath = values.config ? resolve(values.config) : findConfig(process.cwd());
  if (!configPath) return print("No pyproject.toml with [tool.inwards] found.", 2);

  const targets = paths.length > 0 ? paths.map((p) => resolve(p)) : undefined;
  const report = await runCheck(configPath, targets, process.cwd());

  // Agents and hooks read a pipe, and indentation there is wasted tokens.
  const pretty = process.stdout.isTTY === true;
  const color = process.env.FORCE_COLOR ? true : pretty && !process.env.NO_COLOR;
  process.stdout.write(`${render(report, format, { pretty, color })}\n`);
  return report.diagnostics.length > 0 ? 1 : 0;
}

/** Checks `targets` (default: the whole config root). Paths in the report are relative to `base`. */
async function runCheck(
  configPath: string,
  targets: string[] | undefined,
  base: string,
): Promise<Report> {
  const started = performance.now();
  const config = parseConfig(readFileSync(configPath, "utf8"));
  const root = resolve(dirname(configPath), config.root);
  const engine = await Engine.create(await loadGrammars(), config);
  const files = collectPythonFiles(targets ?? [root]).map(
    (abs): SourceFile => ({
      path: posix(relative(base, abs)),
      text: readFileSync(abs, "utf8"),
      ...moduleNameFor(relative(root, abs)),
    }),
  );
  const diagnostics = engine.checkFiles(files);
  return { diagnostics, filesChecked: files.length, durationMs: performance.now() - started };
}

interface ClaudeCodeHookInput {
  hook_event_name?: string;
  cwd?: string;
  tool_input?: { file_path?: unknown };
}

/**
 * Claude Code PostToolUse hook: checks the one file the agent just wrote.
 * Exit 2 puts stderr in front of the model, so violations and config errors go
 * there. Every other event and non-Python file passes silently with exit 0.
 */
async function hookClaudeCode(): Promise<number> {
  let input: ClaudeCodeHookInput;
  try {
    input = JSON.parse(await Bun.stdin.text());
  } catch {
    return print("inwards hook: stdin is not a Claude Code hook payload.", 1);
  }
  const file = input.tool_input?.file_path;
  if (input.hook_event_name !== "PostToolUse" || typeof file !== "string") return 0;
  if (!/\.pyi?$/.test(file)) return 0;

  const cwd = typeof input.cwd === "string" ? input.cwd : process.cwd();
  const configPath = findConfig(cwd);
  if (!configPath) {
    return print(
      `inwards: no pyproject.toml with [tool.inwards] above ${cwd}; nothing was checked.`,
      2,
    );
  }
  // The payload is agent-controlled: only files inside the project are checked.
  const abs = resolve(cwd, file);
  if (!existsSync(abs) || !isInside(dirname(configPath), abs)) return 0;

  const report = await runCheck(configPath, [abs], cwd);
  if (report.diagnostics.length === 0) return 0;
  process.stderr.write(`${render(report, "json", { pretty: false })}\n`);
  return 2;
}

function isInside(dir: string, file: string): boolean {
  const rel = relative(realpathSync(dir), realpathSync(file));
  return rel !== "" && rel.split(sep)[0] !== ".." && !isAbsolute(rel);
}

/** Walks up from `dir` to the first pyproject.toml that has a [tool.inwards] table. */
function findConfig(dir: string): string | undefined {
  for (let d = dir; ; d = dirname(d)) {
    const candidate = resolve(d, "pyproject.toml");
    if (existsSync(candidate) && readFileSync(candidate, "utf8").includes("[tool.inwards")) {
      return candidate;
    }
    if (dirname(d) === d) return undefined;
  }
}

/** Diagnostics and SARIF use forward slashes on every OS, so output is identical everywhere. */
const posix = (path: string) => path.split(sep).join("/");

// Not console.*: with FORCE_COLOR set, Bun paints console.error red, and the
// JSON an agent parses would arrive wrapped in ANSI codes.
function print(message: string, code: number): number {
  (code === 0 ? process.stdout : process.stderr).write(`${message}\n`);
  return code;
}

// exitCode, not exit(): Node-style exit() may drop writes still queued for a
// pipe, and a hook's stderr is the whole message to the agent.
main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
    process.exitCode = print(
      err instanceof ConfigError ? `config error: ${err.message}` : detail,
      2,
    );
  },
);
