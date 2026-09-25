#!/usr/bin/env bun
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
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
  const color = process.env["FORCE_COLOR"] ? true : pretty && !process.env["NO_COLOR"];
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
  const files = collectPythonFiles(targets ?? [root])
    .filter((abs) => isInside(root, abs))
    .map(
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
 * there. Exit 1 reaches only the user: a bad payload or a bug in Inwards is not
 * the model's to fix. Anything else passes silently with exit 0.
 */
async function hookClaudeCode(): Promise<number> {
  if (process.stdin.isTTY) return print(USAGE, 2);
  let input: ClaudeCodeHookInput | null = null;
  try {
    // Sync on purpose: awaiting Bun.stdin in the Windows binary let the process
    // exit before main() settled, i.e. exit 0 and the violation lost.
    input = JSON.parse(readFileSync(0, "utf8"));
  } catch {}
  if (typeof input !== "object" || input === null) {
    return print("inwards hook: stdin is not a Claude Code hook payload.", 1);
  }
  const file = input.tool_input?.file_path;
  if (input.hook_event_name !== "PostToolUse" || typeof file !== "string") return 0;
  if (!/\.pyi?$/.test(file)) return 0;

  // The payload is agent-controlled. Compare real paths, so `..` and symlinks
  // can't reach a file outside the project, and check regular files only.
  const cwd = realpath(typeof input.cwd === "string" ? input.cwd : process.cwd());
  if (!cwd) return 0;
  const project = realpath(process.env["CLAUDE_PROJECT_DIR"] || cwd);
  const abs = realpath(resolve(cwd, file));
  if (!abs || !project || !isInside(project, abs) || !statSync(abs).isFile()) return 0;

  // The nearest config above the file, so each package in a monorepo uses its own.
  // No config at all means this project doesn't use Inwards (the hook may be user-wide).
  const configPath = findConfig(dirname(abs));
  if (!configPath) return 0;
  try {
    const report = await runCheck(configPath, [abs], cwd);
    if (report.diagnostics.length === 0) return 0;
    process.stderr.write(`${render(report, "json", { pretty: false })}\n`);
    return 2;
  } catch (err) {
    if (err instanceof ConfigError) return print(`inwards: config error: ${err.message}`, 2);
    return print(`inwards hook: ${err instanceof Error ? err.message : String(err)}`, 1);
  }
}

function realpath(path: string): string | undefined {
  try {
    return realpathSync(path);
  } catch {
    return undefined;
  }
}

function isInside(dir: string, file: string): boolean {
  const rel = relative(dir, file);
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
