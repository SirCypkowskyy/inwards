#!/usr/bin/env bun
import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  ConfigError,
  Engine,
  type Format,
  moduleNameFor,
  parseConfig,
  render,
  type SourceFile,
  VERSION,
} from "@stratum-lint/core";
import { collectPythonFiles } from "./files.ts";
import { loadGrammars } from "./grammars.ts";

// Exit codes follow Ruff: 0 clean, 1 violations, 2 usage or config error.
const USAGE = `stratum ${VERSION}

Usage: stratum check [PATHS...] [--format text|json|sarif] [--config pyproject.toml]

Checks Python imports against the layers declared in [tool.stratum].`;

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
  if (values.help || command !== "check") return print(USAGE, command ? 2 : 0);

  const format = values.format as Format;
  if (!["text", "json", "sarif"].includes(format)) return print(`Unknown --format ${format}`, 2);

  const configPath = values.config ? resolve(values.config) : findConfig(process.cwd());
  if (!configPath) return print("No pyproject.toml with [tool.stratum] found.", 2);

  const started = performance.now();
  const config = parseConfig(readFileSync(configPath, "utf8"));
  const root = resolve(dirname(configPath), config.root);
  const engine = await Engine.create(await loadGrammars(), config);

  const targets = paths.length > 0 ? paths.map((p) => resolve(p)) : [root];
  const files = collectPythonFiles(targets).map(
    (abs): SourceFile => ({
      path: relative(process.cwd(), abs),
      text: readFileSync(abs, "utf8"),
      ...moduleNameFor(relative(root, abs)),
    }),
  );
  const diagnostics = engine.checkFiles(files);
  const durationMs = performance.now() - started;

  // Agents and hooks read a pipe, and indentation there is wasted tokens.
  const pretty = process.stdout.isTTY === true;
  const color = process.env.FORCE_COLOR ? true : pretty && !process.env.NO_COLOR;
  const report = { diagnostics, filesChecked: files.length, durationMs };
  console.log(render(report, format, { pretty, color }));
  return diagnostics.length > 0 ? 1 : 0;
}

/** Walks up from `dir` to the first pyproject.toml that has a [tool.stratum] table. */
function findConfig(dir: string): string | undefined {
  for (let d = dir; ; d = dirname(d)) {
    const candidate = resolve(d, "pyproject.toml");
    if (existsSync(candidate) && readFileSync(candidate, "utf8").includes("[tool.stratum")) {
      return candidate;
    }
    if (dirname(d) === d) return undefined;
  }
}

function print(message: string, code: number): number {
  (code === 2 ? console.error : console.log)(message);
  return code;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err instanceof ConfigError ? `config error: ${err.message}` : err);
    process.exit(2);
  },
);
