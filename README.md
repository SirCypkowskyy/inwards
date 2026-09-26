# Inwards

Architecture linter for Python. You declare your layers (DDD, Clean Architecture,
Ports & Adapters, Vertical Slices) in `pyproject.toml`, and `inwards check` fails
whenever an import breaks them. It prints a fix recipe written for the AI agent
that probably wrote the import.

```console
$ inwards check --format json
```

Status: pre-alpha. Eight rules (INW001 layer direction, INW011 dynamic imports,
INW005 libraries per layer, INW006 code outside every layer, INW010 imports of first-party modules that don't exist, INW007/INW008 package shape, INW000 encodings that could hide
imports) work end to end, and
`inwards init --agent claude` wires them into Claude Code with a per-edit check, a Stop gate,
a config guard and escalation to the user (`--agent aider` and `--agent agents-md` cover Aider
and `AGENTS.md`). On a new project, `inwards init --style hexagonal --scaffold` writes the layers
(`layered` and `clean` too) and an example package that passes the check. The only release so far is the pre-release v0.1.0-rc.1, with binaries for six
platforms and platform wheels for `uv add`; see the
[install guide](https://sircypkowskyy.github.io/inwards/guides/install/).

## Layout

| Path | What lives there |
|---|---|
| `src/core/` | The engine. TypeScript + web-tree-sitter (WASM). No I/O. |
| `src/cli/` | `inwards` command, compiled to one binary with `bun build --compile`. |
| `src/vscode-extension/` | LSP server + client. Uses the same engine as the CLI. |
| `docs/` | Architecture docs (C4, ADRs), built with Zensical, published to GitHub Pages. |
| `examples/clean-app/` | Tiny layered app the CLI checks in CI. |
| `examples/broken-app/` | One deliberate INW001 violation; `sarif.yml` expects it and annotates PRs with it. |
| `eval/` | Agent eval harness: does an agent fix what the hook reports? |
| `bench/` | The synthetic benchmark repo generator and the PR regression gate (`compare.ts`). |
| `packaging/` | README for the platform wheels, and the PyPI/npm name placeholders. |
| `scripts/` | Build binaries and wheels, version and docs-nav checks, screenshots. |
| `.github/` | CI, release and docs workflows, Dependabot config, issue forms (bug, feature, rule proposal). |

## Develop

```sh
bun install
bun test
bun run check:self                              # lint the example app
bun run scripts/build-binaries.ts bun-linux-x64 # dist/inwards-linux-x64
uv run zensical serve -f docs/zensical.toml     # docs preview
```

Releases (ADR-016, ADR-017): PRs are squash-merged with Conventional Commit titles, and
release-please keeps a `chore: release X.Y.Z` PR open with the next version and the new
`CHANGELOG.md` section. Merging it tags `vX.Y.Z` and starts `cd.yml`, which cross-compiles
binaries for Linux (glibc and musl), macOS and Windows, wraps each in a platform wheel
(`scripts/build-wheels.py`), runs each binary and installs each wheel with `uvx` on its native
runner, and drafts a GitHub Release with the binaries, the wheels, the `.vsix` and
`SHA256SUMS`. Publish the draft by hand; once the owner switches it on, that starts `pypi.yml`,
which uploads the same wheels to TestPyPI and then PyPI with trusted publishing (ADR-021). A release candidate is a hand-pushed tag with a
suffix (`v0.2.0-rc.1`) on the release PR's branch, which already holds the new version. Build provenance attestations switch on once the repo is public.

Report security issues privately, not in a public issue; see [SECURITY.md](SECURITY.md).
