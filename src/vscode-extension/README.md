# Stratum for VS Code

Shows Stratum architecture violations as you type. It runs the same engine as `stratum check`
(`@stratum-lint/core`) inside a small language server, so the editor and CI never disagree.

Status: scaffold. `bun run build` produces `dist/`; `bun run package` produces a `.vsix`.
