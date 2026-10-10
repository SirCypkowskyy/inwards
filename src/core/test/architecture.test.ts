/**
 * @file The engine's own architecture (#176), checked by behaviour rather than
 * by reading: a core module can't import a Node module or use the `process`
 * global (Biome rejects a probe file), every source folder and every rule has
 * a fallow zone, the rules share only `rules/shared`, and no core zone may
 * import anything outside core. These tests fail if a refactor lets the engine
 * do I/O or lets one rule reach into another.
 */
import { describe, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

const REPO = resolve(import.meta.dir, "../../..");
const SRC = join(REPO, "src/core/src");
const BIOME = join(REPO, "node_modules/.bin/biome");
const FALLOW = join(REPO, "node_modules/.bin/fallow");
/**
 * Timeout for the tests that start Biome once per probe. They take about
 * 250 ms on CI, but a slow self-hosted runner took 5.7 s for the first one
 * (its neighbours ran 6 to 8 times slower than usual too), past Bun's 5 s
 * default. Each probe is a cold Biome start, so the time follows the runner,
 * not the engine's code.
 */
const BIOME_PROBE_TIMEOUT_MS = 30_000;
/** The extension of a single-module rule. */
const TS_SUFFIX = /\.ts$/u;

/** What `fallow guard --format json` says about one file. */
interface Guarded {
  path: string;
  zone: { name: string } | null;
  boundary: {
    unrestricted: boolean;
    allowed_zones: string[];
    allowed_type_only_zones: string[];
    forbidden_calls: string[];
    coverage_required: boolean;
  };
}

/**
 * Asks fallow which zone and rules apply to files, the way its checks apply
 * them (first matching zone wins), rather than re-reading the config here.
 *
 * @param paths - repo-relative paths; they need not exist.
 * @returns fallow's answer for each path.
 */
function guard(paths: readonly string[]): Guarded[] {
  const run = Bun.spawnSync([FALLOW, "guard", "--format", "json", ...paths], { cwd: REPO });
  const parsed: { files: Guarded[] } = JSON.parse(run.stdout.toString());
  return parsed.files;
}

/**
 * Lists the TypeScript modules below a directory.
 *
 * @param dir - an absolute directory.
 * @returns absolute paths.
 */
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return sources(path);
    }
    return entry.name.endsWith(".ts") ? [path] : [];
  });
}

/**
 * Names the zone a core source file must be in: `core-api` for index.ts,
 * `core-rule-<name>` for a rule's module or folder, `core-rules-shared` for
 * rules/shared, and `core-<folder>` for everything else.
 *
 * @param path - a repo-relative path under src/core/src.
 * @returns the expected zone name.
 */
function expectedZone(path: string): string {
  const [top, next] = path.slice("src/core/src/".length).split("/");
  if (top === "index.ts") {
    return "core-api";
  }
  if (top === "rules" && next !== undefined) {
    return next === "shared" ? "core-rules-shared" : `core-rule-${next.replace(TS_SUFFIX, "")}`;
  }
  return `core-${top}`;
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
  test(
    "a core module can't import a Node module or use the process global",
    () => {
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
    },
    BIOME_PROBE_TIMEOUT_MS,
  );

  test(
    "a core module can't reach the network or read the clock",
    () => {
      const probes: [string, string][] = [
        [
          '/** Fetches. */\nexport const load = (): Promise<Response> => fetch("https://x");\n',
          "noRestrictedGlobals",
        ],
        ["/** Stamps. */\nexport const now = (): number => Date.now();\n", "noRestrictedGlobals"],
        ["/** Stamps. */\nexport const now = (): string => Date();\n", "noRestrictedGlobals"],
        [
          "const D = Date;\n\n/** Stamps. */\nexport const now = (): unknown => new D();\n",
          "noRestrictedGlobals",
        ],
        [
          "/** Stamps. */\nexport const now = (): number => Date.parse(new Date(Date.now()).toISOString());\n",
          "noRestrictedGlobals",
        ],
        [
          '/** Stamps. */\nexport const now = (): unknown => (globalThis as Record<string, unknown>)["Date"];\n',
          "noRestrictedGlobals",
        ],
        [
          '/** Escapes. */\nexport const g = (): unknown => Function("return this")();\n',
          "noRestrictedGlobals",
        ],
      ];
      for (const [text, rule] of probes) {
        const result = lintAs("src/core/src/rules/probe.ts", text);
        expect(result.code).not.toBe(0);
        expect(result.out).toContain(rule);
      }
    },
    BIOME_PROBE_TIMEOUT_MS,
  );
});

describe("zones, as fallow applies them", () => {
  const files = sources(SRC).map((path) => relative(REPO, path));
  const guarded = guard(files);

  test("every source file sits in its own folder's or rule's zone", () => {
    expect(guarded.length).toBe(files.length);
    for (const file of guarded) {
      expect({ path: file.path, zone: file.zone?.name }).toEqual({
        path: file.path,
        zone: expectedZone(file.path),
      });
      expect(file.boundary.unrestricted).toBe(false);
      expect(file.boundary.forbidden_calls).toEqual(expect.arrayContaining(["fs.*", "process.*"]));
    }
  });

  test("a rule may import rules/shared and the folders below, never another rule", () => {
    const ruleFiles = guarded.filter((f) => f.zone?.name.startsWith("core-rule-"));
    expect(ruleFiles.length).toBeGreaterThan(0);
    for (const file of ruleFiles) {
      const reachable = [...file.boundary.allowed_zones, ...file.boundary.allowed_type_only_zones];
      expect(reachable.filter((z) => z.startsWith("core-rule-") && z !== file.zone?.name)).toEqual(
        [],
      );
      expect(reachable).not.toContain("core-engine");
    }
  });

  test("no production core file may import outside core", () => {
    for (const file of guarded) {
      const reachable = [...file.boundary.allowed_zones, ...file.boundary.allowed_type_only_zones];
      expect(reachable.filter((z) => !z.startsWith("core-") || z === "core-dev")).toEqual([]);
    }
  });

  test("a file in a new folder has no zone, and fallow reports it until it gets one", () => {
    const [fresh] = guard(["src/core/src/new-folder/module.ts"]);
    expect(fresh?.zone).toBeNull();
    expect(fresh?.boundary.coverage_required).toBe(true);
  });
});
