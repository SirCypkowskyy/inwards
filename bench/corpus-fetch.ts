/**
 * Checks out the repos of bench/corpus.json for bench/corpus.ts: shallow,
 * sparse, at the pinned commit, reusing a clean checkout from an earlier run.
 */
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import type { Repo } from "./corpus-manifest.ts";

/** The `[tool.inwards]` file bench/corpus.ts writes into each checkout. */
export const CONFIG_FILE = "inwards-corpus.toml";
/** Fetch attempts per repo, and the pause after the first failure (doubles, then triples). */
const FETCH_ATTEMPTS = 3;
const FETCH_BACKOFF_MS = 5000;

/**
 * Runs a command and throws unless it exits 0.
 *
 * @param cmd - the command and its arguments.
 * @returns stdout.
 * @throws {Error} with stderr when the command fails.
 */
function run(cmd: string[]): string {
  const res = Bun.spawnSync(cmd, { stderr: "pipe" });
  if (res.exitCode !== 0) {
    throw new Error(`${cmd.join(" ")} exited ${res.exitCode}: ${res.stderr.toString()}`);
  }
  return res.stdout.toString();
}

/**
 * Sets the checkout's sparse paths from the manifest, or turns sparse
 * checkout off when the entry has none, so a reused checkout can't keep
 * paths from an older manifest.
 *
 * @param repo - the manifest entry.
 * @param dir - the checkout.
 */
function applySparse(repo: Repo, dir: string): void {
  run(
    repo.paths
      ? ["git", "-C", dir, "sparse-checkout", "set", ...repo.paths]
      : ["git", "-C", dir, "sparse-checkout", "disable"],
  );
}

/**
 * Tells whether a checkout can be reused: at the pinned commit, with the
 * manifest's sparse paths, and nothing changed but the config this script
 * writes. An edited or extra .py file would change the corpus.
 *
 * @param repo - the manifest entry.
 * @param dir - the checkout.
 * @returns true when the checkout is as a fresh fetch would leave it.
 */
function reusable(repo: Repo, dir: string): boolean {
  const head = Bun.spawnSync(["git", "-C", dir, "rev-parse", "HEAD"], { stderr: "ignore" });
  if (!existsSync(join(dir, ".git")) || head.stdout.toString().trim() !== repo.sha) {
    return false;
  }
  applySparse(repo, dir);
  const changed = run(["git", "-C", dir, "status", "--porcelain"])
    .split("\n")
    .filter((l) => l !== "" && l !== `?? ${CONFIG_FILE}`);
  if (changed.length > 0) {
    process.stderr.write(`${repo.name}: checkout has local changes, fetching again\n`);
  }
  return changed.length === 0;
}

/**
 * Checks out a repo at its pinned commit: one shallow fetch of that commit,
 * without blobs outside the sparse paths. Reuses a clean checkout already
 * there, and retries a failed fetch with a growing pause (network blips on
 * a nightly job shouldn't fail it).
 *
 * @param repo - the manifest entry.
 * @param dir - where the checkout goes.
 * @throws {Error} from the last attempt when every fetch fails.
 */
export function fetchRepo(repo: Repo, dir: string): void {
  if (reusable(repo, dir)) {
    return;
  }
  for (let attempt = 1; ; attempt += 1) {
    try {
      rmSync(dir, { recursive: true, force: true });
      run(["git", "init", "-q", dir]);
      run(["git", "-C", dir, "remote", "add", "origin", repo.url]);
      run([
        "git",
        "-C",
        dir,
        "fetch",
        "-q",
        "--depth",
        "1",
        "--filter=blob:none",
        "origin",
        repo.sha,
      ]);
      applySparse(repo, dir);
      run(["git", "-C", dir, "checkout", "-q", "--detach", "FETCH_HEAD"]);
      return;
    } catch (err) {
      if (attempt >= FETCH_ATTEMPTS) {
        throw err;
      }
      process.stderr.write(`${repo.name}: fetch attempt ${attempt} failed, retrying\n`);
      Bun.sleepSync(FETCH_BACKOFF_MS * attempt);
    }
  }
}
