/**
 * @file The engine's own architecture (#176), checked by behaviour rather than
 * by reading: a core module can't import a Node module or use the `process`
 * global (Biome rejects a probe file), every source folder and every rule has
 * a fallow zone, the rules share only `rules/shared`, and no core zone may
 * import anything outside core. These tests fail if a refactor lets the engine
 * do I/O or lets one rule reach into another.
 */
import { describe, expect, test } from "bun:test";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const REPO = resolve(import.meta.dir, "../../..");
const SRC = join(REPO, "src/core/src");
const BIOME = join(REPO, "node_modules/.bin/biome");
/** A whole-line `//` comment in `.fallowrc.jsonc`. */
const LINE_COMMENT = /^\s*\/\/.*$/gmu;
/** The extension of a single-module rule. */
const TS_SUFFIX = /\.ts$/u;

/** The part of `.fallowrc.jsonc` these tests read. */
interface FallowConfig {
  boundaries: {
    zones: { name: string; patterns: string[] }[];
    rules: { from: string; allow: string[] }[];
  };
}

/**
 * Reads the fallow configuration, comments dropped.
 *
 * @returns the zones and their rules.
 */
function fallowConfig(): FallowConfig {
  const text = readFileSync(join(REPO, ".fallowrc.jsonc"), "utf8").replace(LINE_COMMENT, "");
  return JSON.parse(text);
}

/**
 * Lints some source as if it were a file at a path, with the repo's Biome
 * config. Biome shows no rule findings for stdin, so the text goes into a
 * temporary tree next to a copy of biome.jsonc, removed afterwards.
 *
 * @param path - repo-relative path the text pretends to live at.
 * @param text - the source.
 * @returns Biome's exit code and output.
 */
function lintAs(path: string, text: string): { code: number | null; out: string } {
  const root = mkdtempSync(join(tmpdir(), "inwards-core-arch-"));
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

describe("no I/O in the engine", () => {
  test("a core module can't import a Node module or use the process global", () => {
    for (const folder of ["rules", "engine", "lookup"]) {
      const imports = lintAs(
        `src/core/src/${folder}/probe.ts`,
        'import { readFileSync } from "node:fs";\n\n/** Reads. */\nexport const read = readFileSync;\n',
      );
      expect(imports.code).not.toBe(0);
      expect(imports.out).toContain("noNodejsModules");
      const global = lintAs(
        `src/core/src/${folder}/probe.ts`,
        "/** Reads. */\nexport const cwd = (): string => process.cwd();\n",
      );
      expect(global.code).not.toBe(0);
      expect(global.out).toContain("noRestrictedGlobals");
    }
  });
});

describe("zones", () => {
  const config = fallowConfig();
  const zones = config.boundaries.zones.filter((zone) => zone.name.startsWith("core-"));
  const rules = new Map(config.boundaries.rules.map((rule) => [rule.from, rule.allow]));

  test("every source folder and every rule has a zone", () => {
    const patterns = zones.flatMap((zone) => zone.patterns);
    const folders = readdirSync(SRC, { withFileTypes: true }).filter((e) => e.isDirectory());
    for (const folder of folders.filter((f) => f.name !== "rules")) {
      expect(patterns).toContain(`src/core/src/${folder.name}/**`);
    }
    for (const entry of readdirSync(join(SRC, "rules"), { withFileTypes: true })) {
      const name = entry.name.replace(TS_SUFFIX, "");
      const pattern = entry.isDirectory()
        ? `src/core/src/rules/${name}/**`
        : `src/core/src/rules/${name}.ts`;
      expect(patterns).toContain(pattern);
    }
  });

  test("the rules share only rules/shared", () => {
    const ruleZones = zones
      .map((zone) => zone.name)
      .filter((name) => name.startsWith("core-rule-"));
    expect(ruleZones.length).toBeGreaterThan(0);
    for (const zone of ruleZones) {
      const allowed = rules.get(zone) ?? [];
      expect(allowed.filter((target) => target.startsWith("core-rule-"))).toEqual([]);
      expect(allowed).not.toContain("core-engine");
    }
  });

  test("no production core zone imports outside core", () => {
    for (const zone of zones.filter((z) => z.name !== "core-dev")) {
      for (const target of rules.get(zone.name) ?? []) {
        expect(target.startsWith("core-")).toBe(true);
        expect(target).not.toBe("core-dev");
      }
    }
  });
});
