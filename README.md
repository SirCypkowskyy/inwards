# Stratum

Architecture linter for Python. You declare your layers (DDD, Clean Architecture,
Ports & Adapters, Vertical Slices) in `pyproject.toml`, and `stratum check` fails
whenever an import breaks them. It prints a fix recipe written for the AI agent
that probably wrote the import.

```console
$ stratum check --format json
```

Status: pre-alpha scaffold. One rule (STR001, layer dependency direction) works end to end.

## Layout

| Path | What lives there |
|---|---|
| `src/core/` | The engine. TypeScript + web-tree-sitter (WASM). No I/O. |
| `src/cli/` | `stratum` command, compiled to one binary with `bun build --compile`. |
| `src/vscode-extension/` | LSP server + client. Uses the same engine as the CLI. |
| `docs/` | Architecture docs (C4, ADRs), built with Zensical, served from Cloudflare. |
| `examples/clean-app/` | Tiny layered app the CLI checks in CI. |
| `scripts/` | Release tooling. |

## Develop

```sh
bun install
bun test
bun run check:self                              # lint the example app
bun run scripts/build-binaries.ts bun-linux-x64 # dist/stratum-linux-x64
uv run zensical serve -f docs/zensical.toml     # docs preview
```

Releases: push a `v*` tag. `cd.yml` cross-compiles binaries for Linux, macOS and Windows,
runs each one on its native runner, and uploads them as a workflow artifact.
