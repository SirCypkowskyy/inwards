/**
 * Cross-compiles `inwards` into single-file executables, one per target.
 *
 *   bun run scripts/build-binaries.ts                 # every target
 *   bun run scripts/build-binaries.ts bun-linux-x64   # just one
 *
 * Output: dist/inwards-<os>-<arch>[.exe]
 */
import { mkdirSync } from "node:fs";
import process from "node:process";

const ALL_TARGETS = [
  "bun-linux-x64",
  "bun-linux-arm64",
  "bun-linux-x64-musl",
  "bun-darwin-x64",
  "bun-darwin-arm64",
  "bun-windows-x64",
] as const;

const requested = process.argv.slice(2);
const targets: readonly string[] = requested.length > 0 ? requested : ALL_TARGETS;
mkdirSync("dist", { recursive: true });

for (const target of targets) {
  const name = `inwards-${target.replace(/^bun-/u, "")}`;
  const outfile = `dist/${name}${target.includes("windows") ? ".exe" : ""}`;
  // biome-ignore lint/performance/noAwaitInLoops: one compile at a time; each embeds a full Bun runtime.
  const result = await Bun.build({
    entrypoints: ["src/cli/src/main.ts"],
    minify: true,
    sourcemap: "linked",
    // biome-ignore lint/nursery/noUnsafeTypeAssertion: argv goes straight to Bun.build, which rejects unknown targets.
    compile: { target: target as Bun.Build.CompileTarget, outfile },
  });
  if (!result.success) {
    for (const log of result.logs) {
      console.error(log);
    }
    process.exit(1);
  }
  console.log(`built ${outfile}`);
}
