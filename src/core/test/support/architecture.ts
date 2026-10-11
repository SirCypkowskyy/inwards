/**
 * @file Helpers the engine's and the CLI's architecture tests share: a Biome
 * probe that lints text as if it sat at a repo path, and the naming check for
 * vertical slices (ADR-047). A migrated slice holds only `index.ts`,
 * `contracts.ts`, `cli.ts`, private `_*.ts` modules and `*.d.ts` typings, and
 * each subfolder is `adapters/` or a mini-domain with its own `index.ts`.
 * Which folders count as migrated is each caller's list.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

const REPO = resolve(import.meta.dir, "../../../..");
const BIOME = join(REPO, "node_modules/.bin/biome");

/** The file names a slice may hold. */
const SLICE_FILE = /^(?:index|contracts|cli)\.ts$|^_.+\.ts$|\.d\.ts$/u;

/**
 * Lints some source as if it were a file at a path, with the repo's Biome
 * config. Biome shows no rule findings for stdin, so the text goes into a
 * temporary tree next to a copy of biome.jsonc, removed afterwards.
 *
 * @param path - repo-relative path the text pretends to live at.
 * @param text - the source.
 * @returns Biome's exit code and output.
 */
export function lintAs(path: string, text: string): { code: number | null; out: string } {
  const root = mkdtempSync(join(tmpdir(), "inwards-arch-"));
  try {
    copyFileSync(join(REPO, "biome.jsonc"), join(root, "biome.jsonc"));
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
    const run = Bun.spawnSync(
      [BIOME, "lint", "--vcs-enabled=false", `--config-path=${root}`, join(root, path)],
      { cwd: root },
    );
    return { code: run.exitCode, out: `${run.stdout.toString()}${run.stderr.toString()}` };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/**
 * Lists the paths in migrated slices that break the naming convention.
 *
 * @param src - the package's absolute `src/` directory.
 * @param slices - the migrated slices, as folder paths relative to `src`.
 * @returns each misnamed file, or subfolder without an `index.ts`, relative to `src`.
 */
export function misnamed(src: string, slices: readonly string[]): string[] {
  return slices.flatMap((slice) => walk(join(src, slice)).map((path) => relative(src, path)));
}

/**
 * Walks one slice or mini-domain. `adapters/` is skipped: its modules are
 * named after what they adapt.
 *
 * @param dir - an absolute folder.
 * @returns absolute paths that break the convention.
 */
function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (!entry.isDirectory()) {
      return SLICE_FILE.test(entry.name) ? [] : [path];
    }
    if (entry.name === "adapters") {
      return [];
    }
    return existsSync(join(path, "index.ts")) ? walk(path) : [path];
  });
}
