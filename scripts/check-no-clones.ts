/**
 * @file Fails when fallow finds any clone group at all. fallow's own gate is a
 * percentage (`duplicates.threshold`), and 0 there means "no limit", not
 * "no duplication" (fallow 3.28.0); `--fail-on-issues` doesn't fail on clones
 * either. This reads `fallow dupes --format json` and fails on the first
 * group, so copy-paste has to be refactored or explicitly reviewed (#176).
 *
 * Run by `bun run fallow` (CI). Exit 0 with no clone groups, 1 otherwise.
 */
import process from "node:process";

const run = Bun.spawnSync(["fallow", "dupes", "--format", "json", "--no-fragments"], {
  stderr: "inherit",
});
/** The part of `fallow dupes --format json` this check reads. */
interface DupesReport {
  stats: { clone_groups: number; duplicated_lines: number };
}
const report: DupesReport = JSON.parse(run.stdout.toString());
const groups: number = report.stats.clone_groups;
const lines: number = report.stats.duplicated_lines;
if (groups > 0) {
  process.stderr.write(
    `fallow found ${groups} clone group(s), ${lines} duplicated lines. Run \`bun x fallow dupes\` to see them.\n`,
  );
}
process.exitCode = groups === 0 ? 0 : 1;
