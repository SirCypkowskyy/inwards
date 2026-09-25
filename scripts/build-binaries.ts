/**
 * Cross-compiles `stratum` into single-file executables, one per target.
 *
 *   bun run scripts/build-binaries.ts                 # every target
 *   bun run scripts/build-binaries.ts bun-linux-x64   # just one
 *
 * Output: dist/stratum-<os>-<arch>[.exe]
 */
import { mkdirSync } from "node:fs";

const ALL_TARGETS = [
  "bun-linux-x64",
  "bun-linux-arm64",
  "bun-linux-x64-musl",
  "bun-darwin-x64",
  "bun-darwin-arm64",
  "bun-windows-x64",
] as const;

const requested = process.argv.slice(2);
const targets = requested.length > 0 ? requested : ALL_TARGETS;
mkdirSync("dist", { recursive: true });

for (const target of targets) {
  const name = `stratum-${target.replace(/^bun-/, "")}`;
  const outfile = `dist/${name}${target.includes("windows") ? ".exe" : ""}`;
  const result = await Bun.build({
    entrypoints: ["src/cli/src/main.ts"],
    minify: true,
    sourcemap: "linked",
    compile: { target: target as Bun.Build.CompileTarget, outfile },
  });
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    process.exit(1);
  }
  console.log(`built ${outfile}`);
}
