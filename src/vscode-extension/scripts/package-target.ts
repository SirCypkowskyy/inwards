/**
 * @file Packages the extension as VSIX files, one per VS Code platform that
 * Inwards has a binary for, each with that binary in `bin/` (ADR-043), plus a
 * universal VSIX without one for every other platform. It copies a binary in,
 * runs `vsce package --target`, and takes the binary out again. It doesn't
 * build: `bun run build` writes `dist/extension.js` first.
 *
 *   bun run scripts/package-target.ts all <binaries-dir> <out-dir> <tag>
 *
 * writes `<out-dir>/inwards-vscode-<target>-<tag>.vsix` for each target in
 * `TARGETS` from the `inwards-*` files in `<binaries-dir>` (cd.yml's `dist/`).
 */
import { chmodSync, copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";

/** The extension package's root. */
const PACKAGE = resolve(import.meta.dir, "..");
/** Where a platform VSIX keeps the binary; the client looks there. */
const BIN = join(PACKAGE, "bin");
/** rwxr-xr-x: the binary must stay executable inside the VSIX. */
const EXECUTABLE = 0o755;

/**
 * The VS Code platforms Inwards ships a binary for, and the release file of
 * each (scripts/build-binaries.ts names them). `alpine-x64` is VS Code's name
 * for musl Linux on x64.
 */
export const TARGETS: Readonly<Record<string, string>> = {
  "linux-x64": "inwards-linux-x64",
  "linux-arm64": "inwards-linux-arm64",
  "alpine-x64": "inwards-linux-x64-musl",
  "darwin-x64": "inwards-darwin-x64",
  "darwin-arm64": "inwards-darwin-arm64",
  "win32-x64": "inwards-windows-x64.exe",
};

/** One VSIX to package. */
export interface PackageJob {
  /** A key of `TARGETS`, or `universal` for the VSIX without a binary. */
  target: string;
  /** The binary to bundle; ignored for `universal`. */
  binary?: string;
  /** The VSIX file to write. */
  out: string;
}

/**
 * Packages one VSIX: the binary goes in as `bin/inwards` (`bin/inwards.exe`
 * for Windows) with its execute bit, which `vsce` keeps in the archive.
 *
 * @param job - the target, the binary and the output file.
 * @throws {Error} when `dist/extension.js` isn't built, the target needs a
 *   binary that is missing, or `vsce` fails.
 */
export function packageTarget(job: PackageJob): void {
  if (!existsSync(join(PACKAGE, "dist", "extension.js"))) {
    throw new Error("dist/extension.js is missing: run `bun run build` first");
  }
  rmSync(BIN, { recursive: true, force: true });
  const args = ["x", "vsce", "package", "--no-dependencies", "-o", resolve(job.out)];
  try {
    if (job.target === "universal") {
      // `files` lists bin/, which the universal VSIX leaves empty on purpose.
      args.push("--allow-unused-files-pattern");
    } else {
      if (job.binary === undefined || !existsSync(job.binary)) {
        throw new Error(`${job.target} needs a binary; ${job.binary ?? "none"} doesn't exist`);
      }
      const file = job.target.startsWith("win32-") ? "inwards.exe" : "inwards";
      mkdirSync(BIN);
      copyFileSync(job.binary, join(BIN, file));
      chmodSync(join(BIN, file), EXECUTABLE);
      args.push("--target", job.target);
    }
    const run = Bun.spawnSync([process.execPath, ...args], { cwd: PACKAGE });
    if (run.exitCode !== 0) {
      throw new Error(`vsce package failed for ${job.target}:\n${run.stdout}${run.stderr}`);
    }
  } finally {
    rmSync(BIN, { recursive: true, force: true });
  }
}

/**
 * Packages every target in `TARGETS` and the universal VSIX.
 *
 * @param binaries - the directory with the release binaries.
 * @param outDir - where to write the VSIX files.
 * @param tag - the release tag, part of each file name.
 * @returns the VSIX files written.
 * @throws {Error} when any packaging fails (see `packageTarget`).
 */
function packageAll(binaries: string, outDir: string, tag: string): string[] {
  const jobs: PackageJob[] = [
    ...Object.entries(TARGETS).map(([target, file]) => ({
      target,
      binary: join(binaries, file),
      out: join(outDir, `inwards-vscode-${target}-${tag}.vsix`),
    })),
    { target: "universal", out: join(outDir, `inwards-vscode-universal-${tag}.vsix`) },
  ];
  for (const job of jobs) {
    packageTarget(job);
  }
  return jobs.map((job) => job.out);
}

if (import.meta.main) {
  const [mode, binaries, outDir, tag] = process.argv.slice(2);
  if (mode !== "all" || binaries === undefined || outDir === undefined || tag === undefined) {
    process.stderr.write("usage: package-target.ts all <binaries-dir> <out-dir> <tag>\n");
    process.exit(2);
  }
  for (const out of packageAll(resolve(binaries), resolve(outDir), tag)) {
    process.stdout.write(`packaged ${out}\n`);
  }
}
