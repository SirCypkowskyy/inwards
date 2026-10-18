/**
 * @file The engine's own architecture (#176), checked by behaviour rather than
 * by reading: a core module can't import a Node module or use the `process`
 * global (Biome rejects a probe file), every source folder and every rule has
 * a fallow zone, the rules share only `rules/shared`, and no core zone may
 * import anything outside core. A module named `_x.ts` is private to its
 * folder, and a migrated slice keeps the names of ADR-047. These tests fail if
 * a refactor lets the engine do I/O or lets one rule reach into another.
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { lintAs, misnamed } from "./support/architecture.ts";

const REPO = resolve(import.meta.dir, "../../..");
const SRC = join(REPO, "src/core/src");
const FALLOW = join(REPO, "node_modules/.bin/fallow");
/**
 * Timeout for the tests that start Biome or `fallow guard` as a child
 * process. They take about 250 ms on CI, but a slow self-hosted runner took
 * 5.7 s for a Biome probe (its neighbours ran 6 to 8 times slower than usual
 * too) and a hosted ubuntu-24.04 runner more than 5 s for a `fallow guard`
 * call, past Bun's 5 s default. Each is a cold start of the tool, so the time
 * follows the runner, not the engine's code.
 */
const CHILD_TOOL_TIMEOUT_MS = 30_000;
/**
 * Folders under src/core/src already moved to the slice layout of ADR-047.
 * Each migration step adds its folders, so a moved slice can't drift back.
 */
const MIGRATED_SLICES: readonly string[] = [
  "baseline",
  "config",
  "diagram",
  "report",
  "rules/adapter-conformance",
  "rules/async-blocking",
  "rules/construct-only-in",
  "rules/context-independence",
  "rules/diagram-forbidden-edge",
  "rules/diagram-missing-dependency",
  "rules/diagram-unknown-name",
  "rules/dynamic-import",
  "rules/fastapi",
  "rules/fastapi/model",
  "rules/import-cycles",
  "rules/layer-dependency",
  "rules/orm-naming",
  "rules/package-shape",
  "rules/ports-abstract",
  "rules/private-module",
  "rules/public-api-only",
  "rules/pure-domain",
  "rules/suppression-comment",
  "rules/thin-endpoint",
  "rules/unassigned-module",
  "rules/unknown-first-party",
  "rules/unsupported-encoding",
];
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
    CHILD_TOOL_TIMEOUT_MS,
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
    CHILD_TOOL_TIMEOUT_MS,
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

  test(
    "a file in a new folder has no zone, and fallow reports it until it gets one",
    () => {
      const [fresh] = guard(["src/core/src/new-folder/module.ts"]);
      expect(fresh?.zone).toBeNull();
      expect(fresh?.boundary.coverage_required).toBe(true);
    },
    CHILD_TOOL_TIMEOUT_MS,
  );
});

describe("slices (ADR-047)", () => {
  test(
    "a module may import its own folder's or its parent's _x.ts, never another slice's",
    () => {
      const from = "src/core/src/rules/probe/module.ts";
      for (const specifier of ["../other/_check.ts", "./sub/_check.ts", "../../engine/_x.ts"]) {
        const result = lintAs(from, `export { check } from "${specifier}";\n`);
        expect(result.code).not.toBe(0);
        expect(result.out).toContain("noRestrictedImports");
      }
      for (const specifier of ["./_check.ts", "../_check.ts"]) {
        const result = lintAs(
          from,
          `import { check } from "${specifier}";\n\n/** Runs. */\nexport const run = check;\n`,
        );
        expect(result.out).not.toContain("noRestrictedImports");
      }
    },
    CHILD_TOOL_TIMEOUT_MS,
  );

  test("every migrated slice keeps the slice names", () => {
    expect(misnamed(SRC, MIGRATED_SLICES)).toEqual([]);
  });

  test("the naming check reports a stray module and a subfolder without index.ts", () => {
    const root = mkdtempSync(join(tmpdir(), "inwards-core-slices-"));
    try {
      for (const path of [
        "s/index.ts",
        "s/_a.ts",
        "s/stray.ts",
        "s/mini/index.ts",
        "s/mini/_b.ts",
        "s/loose/c.ts",
        "s/adapters/fs.ts",
      ]) {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), "");
      }
      expect(misnamed(root, ["s"]).sort()).toEqual(["s/loose", "s/stray.ts"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
