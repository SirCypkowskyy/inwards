# Inwards

Architecture linter for Python. You declare your layers (DDD, Clean Architecture,
Ports & Adapters, Vertical Slices) in `pyproject.toml`, and `inwards check` fails
whenever an import breaks them. It prints a fix recipe written for the AI agent
that probably wrote the import.

```console
$ inwards check --format json
```

Status: pre-alpha (0.0.1). INW001 (layer dependency direction) and INW000 (source encodings that
could hide imports) work end to end, including the Claude Code hook (`inwards hook claude-code`).

## Layout

| Path | What lives there |
|---|---|
| `src/core/` | The engine. TypeScript + web-tree-sitter (WASM). No I/O. |
| `src/cli/` | `inwards` command, compiled to one binary with `bun build --compile`. |
| `src/vscode-extension/` | LSP server + client. Uses the same engine as the CLI. |
| `docs/` | Architecture docs (C4, ADRs), built with Zensical, published to GitHub Pages. |
| `examples/clean-app/` | Tiny layered app the CLI checks in CI. |
| `scripts/` | Release tooling. |

## Develop

```sh
bun install
bun test
bun run check:self                              # lint the example app
bun run scripts/build-binaries.ts bun-linux-x64 # dist/inwards-linux-x64
uv run zensical serve -f docs/zensical.toml     # docs preview
```

Releases: push a `v*` tag (`v0.0.1`, or `v0.0.1-rc.1` for a pre-release). `cd.yml`
cross-compiles binaries for Linux (glibc and musl), macOS and Windows, runs each one on its
native runner, and drafts a GitHub Release with the binaries, the `.vsix` and `SHA256SUMS`.
Publish the draft by hand. Build provenance attestations switch on once the repo is public.
