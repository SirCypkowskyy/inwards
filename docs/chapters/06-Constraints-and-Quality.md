# :material-speedometer: Constraints and quality

This chapter covers the rules the design has to live within, the quality goals it's judged by, what we've measured so far, and the risks we know about.

## Constraints

| # | Constraint | Why | Where it bites |
|---|---|---|---|
| C1 | Engine in TypeScript | Shared by CLI, language server and extension ([ADR-001](05-ADR.md#adr-001-typescript-for-the-engine)) | Raw parse speed, binary size |
| C2 | Python parsed with tree-sitter, WASM build | Portable across Bun, Node and every target ([ADR-002](05-ADR.md#adr-002-web-tree-sitter-wasm-not-native-bindings)) | About 12 ms of WASM start-up per process |
| C3 | Distributed as a Bun single-file executable | No runtime prerequisites; installs as a dev dependency ([ADR-003](05-ADR.md#adr-003-ship-a-bun-single-file-executable)) | 66 to 90 MB per binary depending on the platform (85 MB for Linux x64), almost all of it the Bun runtime |
| C4 | Never import or execute user code | Deterministic, safe on untrusted repos, no venv needed | Only dynamic imports with a literal target are visible (INW011); computed targets stay invisible |
| C5 | No network access at check time | Works offline, in sandboxes and in locked-down CI | Rule packs must ship inside the binary or the repo |
| C6 | Config in `pyproject.toml` under `[tool.inwards]` | Python convention ([ADR-005](05-ADR.md#adr-005-configuration-lives-in-pyprojecttoml)) | Protecting the config needs hooks or CODEOWNERS |
| C7 | Output contract `inwards/diagnostics@1` is additive only | Agents and scripts depend on it ([ADR-007](05-ADR.md#adr-007-a-versioned-output-contract-with-fix-steps-as-data)) | Renames need a new major schema |
| C8 | Linux, macOS and Windows on x64 and arm64 | Where agents and CI run | Path handling, CRLF, the release verify matrix |

## Quality goals

Ranked. When two goals conflict, the higher one wins.

| Rank | Goal | Scenario | Measure |
|---|---|---|---|
| 1 | :material-shield-check: **No false negatives** | An agent hides a forbidden import in a function, behind `TYPE_CHECKING`, via a relative path or a package import | Every form is reported, including `shop . infrastructure` with spaces, a backslash inside the name, NFKC identifiers and symlinked aliases of a layer. Dynamic imports with constant targets (`importlib.import_module`, `__import__`, `exec`) are reported as INW011. Known gaps: computed targets ([#46](https://github.com/SirCypkowskyy/inwards/issues/46)), and loaders reached through walrus, tuple assignment, attributes, `functools.partial` or other loading APIs ([#79](https://github.com/SirCypkowskyy/inwards/issues/79)). Unit tests plus the prescan differential test (0 misses on 65,262 generated and 1,921 stdlib files, dynamic imports included, and nightly on 6,543 files from five open-source services) |
| 2 | :material-lightning-bolt: **Agent-loop latency** | A hook checks one edited file | p95 < 100 ms wall time, process start included |
| 3 | :material-robot-outline: **Actionable for agents** | An agent gets INW001 | It fixes the violation within one retry in ≥ 80 % of cases (measured with design partners, see [chapter 2](02-Business-Context.md#the-hypothesis)) |
| 4 | :material-repeat: **Deterministic** | Same repo, same config, two runs | Identical diagnostics in identical order. Only the timing fields in the summary (`durationMs`) change |
| 5 | :material-timer-sand: **Full-repo throughput** | CI checks a 500k-line repo cold | About 1 s today on one core. Target < 300 ms with workers and cache |
| 6 | :material-package-variant: **Easy to adopt** | New team, existing codebase | One command wires in the agent (`inwards init`). The Stop gate checks only what a session changed, so old violations in other files don't block; the baseline (UC6, [#33](https://github.com/SirCypkowskyy/inwards/issues/33)) will cover the rest |

Correctness sits above speed on purpose. A guardrail that sometimes stays silent teaches the agent that the wrong move is fine, and that's worse than no guardrail.

## Measurements

All numbers come from the scaffold in this repository. Nothing here is projected. They were measured during M0; the spot check below shows how they have moved since.

**Setup.** Intel Core Ultra 7 155H laptop, 30 GB RAM, Fedora Linux, Bun 1.4.2, `inwards-linux-x64` built by `scripts/build-binaries.ts`. Everything runs on one thread, since the engine has no worker pool yet. The laptop was in normal desktop use (load average around 2 to 3), so these are realistic numbers rather than best-case ones.

**Synthetic repo.** 2,100 Python files, 496,000 lines, 8.0 MB, four layers with eight first-party imports and forty small functions per module. `bench/generate.py` rebuilds it exactly (fixed random seed).

**Regression gate.** Every pull request runs `.github/workflows/bench.yml`. It builds the base branch and the PR, runs both on the synthetic repo in alternation (40 hook runs on one file, 12 full checks), and fails when the PR is more than 20% slower on either metric, or when either build fails a run (the synthetic repo is clean, so every run must exit 0). Each side is built with its own `.bun-version`, so a Bun upgrade is measured too. The change is the median of per-pair ratios, so load that drifts during the job cancels out within a pair. The gate covers hook and full-check time only, not memory, start-up or binary size. The job summary shows p50/p95 for both builds (with 12 full runs, p95 is the slowest one) and the runner it ran on, and the raw samples are kept as an artifact. Locally, a build made 30% slower fails the gate, and ten runs of identical builds didn't fail it once (`bench/compare.ts`, `bench/test/compare.test.ts`).

**Real-repo corpus.** Stdlib and synthetic code don't look like a FastAPI or Django service, so `.github/workflows/corpus.yml` runs every night (and on any PR that changes the corpus or `prescan-diff.ts`) on five open-source repos pinned by commit in `bench/corpus.json`. `bench/corpus.ts` fetches each one shallow, only the pinned commit, and for three of them only the service directory (`backend/`, `server/`, `saleor/`; sparse cone mode also brings the files at the repo's top level), about 40 MB in all. It runs the prescan differential test on every `.py` file in the checkout and times the compiled binary: 5 full checks and 20 runs of `inwards check <file>` on one file per repo, after one warm-up each. None of these repos has a `[tool.inwards]` table, so the manifest gives each one a layering of ours (written to `inwards-corpus.toml` in the checkout and passed with `--config`). The violation counts come from that layering and say nothing about the projects. The job fails when the prescan misses an import, when a checkout's `.py` count differs from the manifest (a broken fetch would otherwise shrink the corpus), or when `inwards check` exits with anything but 0 or 1. A repo that still fails to fetch after three attempts, or whose run fails, is recorded in the results and fails the job; the other repos still run. The table goes to the job summary and the raw samples to the `corpus-result` artifact.

| Repo | License | Why it's in | Checked with |
|---|---|---|---|
| [fastapi/full-stack-fastapi-template](https://github.com/fastapi/full-stack-fastapi-template) `cb740b6`, `backend/` | MIT | FastAPI's official template, the layout many small services start from | core, services, api |
| [ivan-borovets/fastapi-clean-example](https://github.com/ivan-borovets/fastapi-clean-example) `9271723` | MIT | Clean architecture on FastAPI | core, outbound, inbound, main |
| [pgorecki/python-ddd](https://github.com/pgorecki/python-ddd) `429cd4b` | MIT | DDD modular monolith, three bounded contexts | domain, application, infrastructure, interface |
| [polarsource/polar](https://github.com/polarsource/polar) `cfae1ba`, `server/` | Apache-2.0 | A large FastAPI service in production, about 70 feature packages | kit, models, features, entrypoints |
| [saleor/saleor](https://github.com/saleor/saleor) `5ff5648`, `saleor/` | BSD-3-Clause | A large Django service, bigger than the synthetic repo | core, apps, api |

First run, on the laptop described under Setup (load average 3 to 4), `inwards` 0.1.0:

| Repo | `.py` files | Lines | Prescan refused | Prescan missed | Full check p50 / max | One file p50 / p95 | Violations |
|---|--:|--:|--:|--:|--:|--:|--:|
| full-stack-fastapi-template | 40 | 2,685 | 0 | 0 | 59 / 60 ms | 46 / 51 ms | 1 |
| fastapi-clean-example | 209 | 6,764 | 0 | 0 | 80 / 87 ms | 46 / 49 ms | 2 |
| python-ddd | 139 | 5,852 | 0 | 0 | 82 / 87 ms | 43 / 45 ms | 10 |
| polar | 1,831 | 435,688 | 22 (1.2 %) | 0 | 1.16 / 1.37 s | 124 / 142 ms | 358 |
| saleor | 4,324 | 847,875 | 13 (0.3 %) | 0 | 1.84 / 1.89 s | 59 / 62 ms | 491 |

Two things the synthetic repo didn't show. `inwards check` on polar's `subscription/service.py` (4,482 lines, 175 KB, two violations) takes about 125 ms here and 280 ms on a GitHub runner (AMD EPYC 7763, 2 cores), over the 100 ms budget; a small file in the same repo takes about 55 ms. The budget is written for the Claude Code hook, which runs the same one-file check (`runCheck` on the edited file) after reading its payload, so the hook can only be slower. Tracked in [#122](https://github.com/SirCypkowskyy/inwards/issues/122). Rerun locally after bytecode compilation ([#118](https://github.com/SirCypkowskyy/inwards/pull/118)) cut every one-file check by 20 to 40 ms: polar's file now takes 83 / 90 ms (p50 / p95), saleor's 27 / 30 ms. And a cold full check of saleor's 848,000 lines takes 1.8 s on one core (2.5 s on the GitHub runner), where the 496,000-line synthetic repo takes 0.4 s.

### Results

| Scenario | Result | Budget | Status |
|---|---|---|---|
| Cold full run, naive full parse (first design) | 7.5 s | < 1 s | :x: rejected, led to ADR-004 |
| Cold full run, import skeleton | 0.63 to 1.17 s (runs across two sessions) | < 1 s | :material-alert: at the edge |
| Single file, wall time incl. process start (30 runs) | p50 48.6 ms, p95 80.4 ms | p95 < 100 ms | :white_check_mark: with little headroom |
| Single file, engine time reported by the CLI | 16 to 30 ms | n/a | |
| `inwards --version` (process start only) | about 10 ms | n/a | |
| Module index + importers of one module, cold, one core (2,100 files, fresh process) | 0.1 s index + 0.65 to 0.74 s for the importers (684 files mention `m0`: the synthetic names are the worst case for the text filter) | < 1 s | :white_check_mark: |
| Prescan refusals on the CPython 3.14 stdlib | 8.3 % of 1,921 files | lower is faster | :white_check_mark: |
| Prescan missed imports on the same corpus | 0 | 0 | :white_check_mark: |
| Prescan missed imports on the real-repo corpus (6,543 files, five services) | 0 | 0 | :white_check_mark: |
| Peak memory, full synthetic run | about 120 MB RSS | n/a | |
| Binary size, Linux x64 | 82 MB | n/a | :material-alert: large |

<figure markdown="span">
  ![cold run on the synthetic 2,100-file repo](assets/screens/benchmark.svg){ loading=lazy }
  <figcaption>One cold run on the synthetic repo, single core. Run-to-run spread is in the table above.</figcaption>
</figure>

!!! note "Spot check on 0.1.0 (2026-09-26)"
    Same laptop (Intel Core Ultra 7 155H, 22 threads), a fresh `inwards-linux-x64` build, load average about 1, measured twice independently with the same result. Single-file check on the example app, 30 runs: p50 37 ms, p95 40 ms wall time, 14 ms engine time. `inwards --version`: about 19 ms, up from about 10 ms. Cold full run on the synthetic repo, 5 runs: 0.40 to 0.44 s. Peak RSS about 207 MB, up from about 120 MB. Binary size is unchanged at 82 MB (79 MiB). The bytecode spike below halved start-up after this check, and the start-up breakdown was redone with it. The CI benchmark ([#29](https://github.com/SirCypkowskyy/inwards/issues/29)) now fails any PR that makes the hook or the full check more than 20% slower; it doesn't track memory, start-up or binary size.

### Spike: bytecode and minification

[#39](https://github.com/SirCypkowskyy/inwards/issues/39) asked whether `bun build --compile` flags cut start-up or binary size. Since then `scripts/build-binaries.ts` builds with `--bytecode --format=esm` on top of `--minify --sourcemap=linked`.

**Method.** Six variants of `inwards-linux-x64` from one commit, Bun 1.4.2, the same laptop as above. Start-up: 200 rounds of `inwards --version`, every variant once per round in rotating order. Hook and full check: `bench/compare.ts` with the current build as base, 100 hook runs and 20 full checks per side, change as the median of per-pair ratios. Peak RSS: `/usr/bin/time -f %M`, median of 5 runs. MB means 10^6 bytes throughout. Other agents' builds shared the machine (load average 2 to 6 during the runs), so trust the ratios more than the absolute milliseconds; a base-against-base run moved 0.2% (hook) and 0.6% (full).

| Variant | Size (Linux x64) | `inwards --version` p50 / p95 | Hook, one file | Full check | Peak RSS, full / hook |
|---|---|---|---|---|---|
| Before: `--minify --sourcemap=linked` | 82.4 MB (37.1 MB gzipped) | 22.3 / 30.9 ms | base | base | 202 / 54 MB |
| Without `--minify` | 82.6 MB | +3.0% | +3.7% | +1.5% | 203 MB full |
| Without the sourcemap | 82.2 MB | -0.7% | not run | not run | |
| No `.env` or `bunfig.toml` autoload | 82.4 MB | -0.8% | -3.0% | +0.6% | 205 MB full |
| `--bytecode` (CJS, Bun's default with it) | 85.0 MB | 10.0 / 14.6 ms (-56%) | -45.6% | -5.6% | 205 / 55 MB |
| **`--bytecode --format=esm` (adopted)** | 84.9 MB (38.4 MB gzipped) | 10.5 / 14.3 ms (-53%) | -45.4% | -7.0% | 205 / 56 MB |

A repeat with the committed build and `bench/compare.ts` defaults (40 hook runs, 12 full checks) gave hook p50 / p95 64.4 / 73.6 ms before and 32.6 / 37.4 ms after (-48.0%), and full check -9.9%. A second start-up run gave 25.0 ms before and 10.8 ms after. On the example app, 60 alternating single-file checks: p50 58.7 → 30.3 ms and p95 77.7 → 39.5 ms wall time, and the engine's own time fell from 21.7 to 14.5 ms, because the engine and web-tree-sitter's JS glue no longer get parsed on first call either.

- **Bytecode is the win.** It moves JS parsing from every start to build time. It costs 2.5 MB per binary (1.3 MB gzipped) and 1 to 3 MB of RSS.
- **Size can't be fixed with flags.** Everything Inwards adds is under 1 MB (176 KB of minified JS, 0.67 MB of WASM); the rest is the Bun runtime. Minification was already on and saves 0.1 MB; the sourcemap costs 0.26 MB and keeps stack traces pointing at the TypeScript source, so it stays.
- **ESM, not CJS.** Head to head the two bytecode builds differ by +2.9% (hook) and +2.2% (full), within noise. ESM keeps the module semantics the binary had before.
- **Checked.** The 350 tests pass against the compiled binary (`INWARDS_BIN=dist/inwards-linux-x64 bun test`), so do `--version` and both embedded `.wasm` files (every check parses). A test program built the same way still reports the TypeScript line of a thrown error through the linked sourcemap. All six targets cross-compile, and the musl build checks the synthetic repo inside Alpine. CI's test matrix builds and tests the macOS and Windows binaries natively.
- **Not tried.** Bun's current docs list `--compile-jit-policy` and `--bytecode-order` (profile-guided bytecode layout); Bun 1.4.2's `bun build` has neither. `--bytecode-depth`, which 1.4.2 has, wasn't measured. Worth a look after a Bun upgrade.

### Where a single-file check spends its time

Redone in the bytecode spike, with the bytecode build. Process start is `inwards --version`. The grammar and parse figures come from a script compiled the same way that times reading the embedded `.wasm` files, `Parser.init`, `Language.load` and one parse of `shop/domain/order.py` from the example app, median of 30 runs. "Config + I/O + rules" is the engine time the CLI reports (14.5 ms) minus those, not a measurement.

```mermaid
---
config:
  theme: base
  themeVariables:
    pieSectionTextColor: "#ffffff"
    pieLegendTextColor: "#607d8b"
    pieStrokeColor: "#ffffff"
    pieOpacity: "1"
    pie1: "#4527a0"
    pie2: "#673ab7"
    pie3: "#7e57c2"
    pie4: "#37474f"
    pie5: "#455a64"
    pie6: "#546e7a"
---
pie showData
    title One-file check, about 25 ms of work (engine + start-up)
    "Process start (Bun runtime)" : 10.5
    "WASM runtime init" : 7.8
    "Python grammar load (447 KB)" : 2.7
    "Parsing the file (first parse)" : 2
    "Config + file I/O + rules (remainder)" : 1.5
    "Reading the embedded .wasm files" : 0.5
```

In M0 the same check was about 30 ms of work: 10 ms process start, 12 ms WASM init, 3.5 ms grammar load, 1 ms parse and 3.5 ms remainder, all without bytecode. Parsing the file is still a small slice. About 85% of the cost is paying the same start-up price on every hook call. The wall-time p50 of 30 ms sits above this 25 ms of work because the harness spawns the process, and an agent's hook runner pays that too.

This changes the performance roadmap. For the agent loop, parse speed doesn't matter much. Start-up does.

### Performance roadmap

| Step | Expected effect | Targets |
|---|---|---|
| Resident process reused by hooks through a local socket, with fallback to a one-shot run (process model and command name to be settled in an ADR, since the LSP server may share it; [#59](https://github.com/SirCypkowskyy/inwards/issues/59), [#60](https://github.com/SirCypkowskyy/inwards/issues/60)) | Removes ~20 ms of WASM and runtime start-up from every hook call | Single-file p95 |
| :white_check_mark: `bun build --bytecode` ([#39](https://github.com/SirCypkowskyy/inwards/issues/39)), done | Measured: start-up 22 → 10 ms, hook call about 45% faster, 2.5 MB more per binary (see the spike above) | Single-file p95 |
| Worker pool, one parser per core ([#61](https://github.com/SirCypkowskyy/inwards/issues/61)) | Near-linear speed-up on the cold full run; this laptop has 22 logical CPUs | Cold full run |
| Content-hash cache of import lists (`.inwards/cache`, [#56](https://github.com/SirCypkowskyy/inwards/issues/56)) | Unchanged files skip parsing entirely | Warm full run, stop hook |
| Replace `descendantsOfType` with a tree cursor walk on the full-parse path ([#62](https://github.com/SirCypkowskyy/inwards/issues/62)) | Profiling showed 1.2 s spent there on the naive design | Refused files and confirmations |

### Reproduce

```sh
bun install
bun test                                                    # 478 tests: unit, CLI, hook, Stop gate, baseline, stats, E2E snapshots, doc snippets, bench
bun run scripts/build-binaries.ts bun-linux-x64
python3 bench/generate.py /tmp/inwards-bench
(cd /tmp/inwards-bench && "$OLDPWD/dist/inwards-linux-x64" check)  # 2100 files, 0 violations, ms
bun run src/core/scripts/prescan-diff.ts "$(python3 -c 'import sysconfig; print(sysconfig.get_paths()["stdlib"])')"
bun run bench/corpus.ts --bin dist/inwards-linux-x64 --dir ~/.cache/inwards-corpus  # real-repo corpus, about 90 s
```

`bench/corpus.ts` reuses a checkout that is already at its pinned commit, so later runs download nothing. To add a repo, append it to `bench/corpus.json` with a full commit SHA, its `.py` count and a layering; the PR runs the corpus workflow.

<figure markdown="span">
  ![bun test output](assets/screens/bun-test.svg){ loading=lazy }
  <figcaption>The engine's unit tests, including the prescan and colour-output cases.</figcaption>
</figure>

Two checks keep the agent-facing tests honest. A code fence in `docs/chapters/guides` that follows a `<!-- e2e -->` line and one blank line (without it, the comment breaks a list item) runs as an E2E case in a fresh project, against the compiled binary in CI (`src/cli/test/docs.test.ts`); untagged fences are never run. Every night, `.github/workflows/nightly-e2e.yml` records the Claude Code hook payloads again with a headless `claude -p` session and opens an issue when a field is added, removed or changes type against the recorded fixtures.

The screenshots in these docs come from `scripts/screenshots.py`, which runs each command for real and renders the terminal output with Rich.

## CI runners

Every Linux job in CI (lint and typecheck, the Linux tests, the docs build, the benchmark, the SARIF dogfood, the PR title check, the docs deploy and release-please) runs on self-hosted runners, so pull requests cost no GitHub Actions minutes. They run on `irysek`, the owner's Fedora server (Intel Core i5-4570, 4 cores, 7.5 GB RAM), as three Docker containers built from the official runner on Ubuntu 26.04. Each job gets a fresh container that is deleted when the job ends: the host asks the GitHub API for a just-in-time runner, good for one job, and starts the container with it. Each container is capped at 2 GB of RAM and 2 CPUs, runs unprivileged and has no Docker socket. `ops/runner/` holds the Dockerfile, the host script, the systemd units and a README that rebuilds the setup from scratch.

Still on GitHub-hosted runners: `cd.yml`, so release binaries are built on a clean, documented image rather than on a shared home machine (the musl check also needs Docker, and the verify matrix needs arm64, macOS and Windows), and the macOS, Windows and ubuntu-24.04 rows of the test matrix, which run only when started by hand.

The benchmark gate compares the base branch and the PR in the same job, so it still measures relative change on the slower CPU. Other jobs on the same host add noise to both sides alike.

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|:-:|:-:|---|
| Astral ships layer contracts in ty or Ruff | Medium | High | Compete on agent integration and fix quality, which aren't Astral's focus. Keep the rules format simple enough to export |
| import-linter adds JSON output and agent hooks | Medium | Medium | Stay ahead on latency, a standalone binary and per-violation fixes. Offer an import from `.importlinter` contracts |
| Real repos break the 100 ms p95 | Happened: a 4,482-line polar file with violations took 125 to 280 ms before bytecode compilation, 90 ms p95 locally after ([#122](https://github.com/SirCypkowskyy/inwards/issues/122)) | High | Resident process first, then a Rust/Zig WASM prescan (the fallback in ADR-001) |
| The prescan misses an import on some unusual file | Low | High | Differential test in CI on the stdlib, nightly on five real services; grow that corpus with repos from design partners |
| Agents edit `[tool.inwards]` to pass | High without a guard | High | PreToolUse config guard, the Stop gate's config comparison, `permissions.deny` rules from `init`, CODEOWNERS ([chapter 4](04-AI-Integration.md#stopping-the-agent-from-gaming-the-check)). Bash can still get past the guard and the session record ([#88](https://github.com/SirCypkowskyy/inwards/issues/88)) |
| Bun `--compile` regressions or breaking changes | Low | Medium | Pinned via `.bun-version`; the CD verify matrix runs every binary |
| A binary silently ignores its bytecode (Bun falls back to parsing the source) and start-up doubles | Low | Low | Tests still pass in that case; the PR benchmark catches it on Linux only. Bytecode is tied to the Bun version that built it, and every binary embeds that same version |
| The self-hosted runners go down (host offline, token expired) and PR jobs queue forever | Medium | Medium | Runners restart with the host (systemd) and the image rebuilds weekly; point `runs-on` back at `ubuntu-26.04` to fall back to GitHub-hosted runners |
| Zensical (0.0.x) changes its config format | Medium | Low | Docs build runs in CI on every PR; the config is small |
| Fix steps are wrong for unusual layouts (no obvious place for a port) | Medium | Medium | Measure fix-within-one-retry per rule; let the config name the ports module |
