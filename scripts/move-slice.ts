/**
 * @file Moves TypeScript modules with `git mv` and rewrites every relative
 * import that pointed at them, for the slice migration of ADR-047. Each step
 * passes its moves as `old=new` pairs, so a rebase onto a newer `develop`
 * takes the base's version of a conflicting file and reruns the same command.
 *
 * A specifier is rewritten only when it no longer resolves: it is read from
 * where its file sat before the move and mapped through the moves. One that
 * already resolves is left alone, so a second run changes nothing. It rewrites
 * the `./` and `../` specifiers of `from "..."`, `import "..."` and
 * `import("...")`, comments included; paths spelled in plain strings or prose
 * (docs, test probes) are left to the author.
 *
 * Usage: `bun run scripts/move-slice.ts OLD=NEW...` with repo-relative paths.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import process from "node:process";

const ROOT = join(import.meta.dir, "..");
/** The folders whose modules may import a moved one. */
const SCANNED = ["src", "eval", "scripts", "bench"];
/** A relative module specifier after `from`, a bare `import` or `import(`. */
const SPECIFIER =
  /(?<lead>\bfrom\s*|\bimport\s*\(?\s*)(?<quote>["'])(?<spec>\.{1,2}\/[^"'\n]+)\k<quote>/gu;

/**
 * Rewrites one module's relative specifiers after a move.
 *
 * @param text - the module's source.
 * @param module - where the module sits.
 * @param module.file - its absolute path now.
 * @param module.before - its absolute path before the move (`file` when it didn't move).
 * @param moves - absolute old path to absolute new path.
 * @param exists - tells whether an absolute path is a file now.
 * @returns the source with each broken specifier pointing at the moved module.
 */
export function rewriteSpecifiers(
  text: string,
  { file, before }: { file: string; before: string },
  moves: ReadonlyMap<string, string>,
  exists: (path: string) => boolean,
): string {
  return text.replace(SPECIFIER, (match, lead: string, quote: string, spec: string) => {
    if (exists(resolve(dirname(file), spec))) {
      return match;
    }
    const old = resolve(dirname(before), spec);
    const target = moves.get(old) ?? old;
    if (!exists(target)) {
      return match;
    }
    const path = relative(dirname(file), target);
    return `${lead}${quote}${path.startsWith(".") ? path : `./${path}`}${quote}`;
  });
}

/**
 * Lists the TypeScript files below a directory, `node_modules` excluded.
 *
 * @param dir - an absolute directory.
 * @returns absolute file paths.
 */
function typescriptFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "node_modules" ? [] : typescriptFiles(path);
    }
    return entry.name.endsWith(".ts") ? [path] : [];
  });
}

/**
 * Parses the `old=new` arguments into absolute paths.
 *
 * @param args - the command-line arguments.
 * @returns absolute old path to absolute new path.
 * @throws {Error} when an argument isn't `old=new`.
 */
function parseMoves(args: readonly string[]): Map<string, string> {
  return new Map(
    args.map((arg) => {
      const [from, to, ...rest] = arg.split("=");
      if (!(from && to) || rest.length > 0) {
        throw new Error(`expected OLD=NEW, got ${arg}`);
      }
      return [resolve(ROOT, from), resolve(ROOT, to)];
    }),
  );
}

/**
 * Runs the moves still to do with `git mv`, then rewrites the imports.
 *
 * @param args - the `old=new` pairs.
 * @returns the exit code: 0 on success, 1 when a move fails.
 * @throws {Error} when an argument isn't `old=new`.
 */
function main(args: readonly string[]): number {
  const moves = parseMoves(args);
  if (moves.size === 0) {
    console.error("usage: bun run scripts/move-slice.ts OLD=NEW...");
    return 1;
  }
  for (const [from, to] of moves) {
    if (!existsSync(from) || existsSync(to)) {
      continue;
    }
    mkdirSync(dirname(to), { recursive: true });
    const run = Bun.spawnSync(["git", "mv", from, to], { cwd: ROOT });
    if (run.exitCode !== 0) {
      console.error(`git mv ${relative(ROOT, from)} failed: ${run.stderr.toString()}`);
      return 1;
    }
  }
  const back = new Map([...moves].map(([from, to]) => [to, from]));
  for (const file of SCANNED.flatMap((dir) => typescriptFiles(join(ROOT, dir)))) {
    const text = readFileSync(file, "utf8");
    const next = rewriteSpecifiers(
      text,
      { file, before: back.get(file) ?? file },
      moves,
      existsSync,
    );
    if (next !== text) {
      writeFileSync(file, next);
      console.log(`rewrote ${relative(ROOT, file)}`);
    }
  }
  return 0;
}

if (import.meta.main) {
  process.exit(main(process.argv.slice(2)));
}
