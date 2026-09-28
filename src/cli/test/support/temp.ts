/**
 * @file Temporary directories for the CLI tests. `bun test` fires neither `exit`
 * nor `beforeExit`, and a helper module is loaded once for every test file,
 * so an `afterAll` in it would run after the first file. Instead every
 * directory is registered here and `preload.ts`, which bunfig.toml loads,
 * removes them all once the last test file has run. Run `bun test` from the
 * repository root, as CI does, so bunfig.toml applies. It also points
 * `XDG_STATE_HOME` at a temporary directory (`STATE_HOME`).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

/** Every directory `tempDir` made in this process. */
const made: string[] = [];

/**
 * The state home every test sees: a temporary directory, set here as soon as
 * this module loads (the preload and `run.ts` both import it, before any test
 * or captured environment), so the session start witnesses (#88) never land
 * in the developer's own `~/.local/state`, even when `bun test` runs without
 * the preload.
 */
export const STATE_HOME: string = tempDir("inwards-state-home-");
process.env["XDG_STATE_HOME"] = STATE_HOME;

/**
 * Creates a temporary directory that is removed after the whole run.
 *
 * @param prefix - the name's start, e.g. `inwards-e2e-`.
 * @returns the new directory's absolute path.
 */
export function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  made.push(dir);
  return dir;
}

/**
 * Removes every directory `tempDir` made. Called once, after all test files.
 */
export function removeTempDirs(): void {
  for (const dir of made.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
}
