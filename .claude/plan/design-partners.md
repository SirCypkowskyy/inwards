# Design partners (issue #8)

Goal: at least 5 teams agree to try v0.1 on a real repo, with consent to run
the hook and share the opt-in run log. Recruiting is manual; this file is the
tracking sheet.

## Shortlist

Found on 2026-09-25 with `gh search code` (filename `tach.toml`, or
`[tool.importlinter]` in `pyproject.toml`), then filtered to organisation-owned
repos pushed since 2026-06-01 that commit agent instructions (CLAUDE.md,
AGENTS.md, .claude/, .cursor/). They already pay for architecture checks and
already steer agents with files, which is the exact overlap Inwards targets.
Tach users come first: Tach is in maintenance mode (chapter 2).

| # | Repo | Checker today | Stack | Agent files | Why | Status |
|---|---|---|---|---|---|---|
| 1 | PostHog/posthog | Tach + import-linter | Django | CLAUDE.md, AGENTS.md, .claude, .cursor | Large Django monolith with both tools and every agent file | not contacted |
| 2 | docling-project/docling | Tach | FastAPI | CLAUDE.md, AGENTS.md, .claude | Tach user, heavy agent setup | not contacted |
| 3 | dbt-labs/dbt-charts | Tach | FastAPI, Django | CLAUDE.md, AGENTS.md | Young repo, company-backed | not contacted |
| 4 | mindroom-ai/mindroom | Tach | FastAPI | CLAUDE.md, AGENTS.md, .claude | Small team, agent-first product | not contacted |
| 5 | confessio-labs/confessio | Tach | Django | CLAUDE.md, .claude | Small Django team, likely to answer | not contacted |
| 6 | smorinlabs/py-launch-blueprint | Tach | FastAPI | CLAUDE.md, AGENTS.md, .claude | Template: a partner here reaches its users | not contacted |
| 7 | PennyLaneAI/pennylane | Tach | library | CLAUDE.md, AGENTS.md | Tach at scale, active agent use | not contacted |
| 8 | GridTools/gt4py | Tach | library | CLAUDE.md, AGENTS.md, .claude | Tach user, research team | not contacted |
| 9 | Chia-Network/chia-blockchain | Tach | asyncio services | AGENTS.md, .cursor | Big Tach config | not contacted |
| 10 | EverMind-AI/EverOS | import-linter | FastAPI | CLAUDE.md, .claude | Agent product, layered FastAPI | not contacted |
| 11 | crestalnetwork/intentkit | import-linter | FastAPI | CLAUDE.md, AGENTS.md, GEMINI.md | Uses three agents at once | not contacted |
| 12 | wandb/weave | import-linter | FastAPI, Flask | CLAUDE.md, AGENTS.md, .claude, .cursor | Company-backed, heavy agent setup | not contacted |
| 13 | ag2ai/faststream | import-linter | FastAPI ecosystem | .claude | Framework authors, influence on users | not contacted |
| 14 | zenml-io/kitaru | import-linter | FastAPI, Flask | CLAUDE.md, AGENTS.md, .claude | Company-backed, young repo | not contacted |
| 15 | mlrun/mlrun | import-linter | services | CLAUDE.md, AGENTS.md, .claude | Large platform codebase | not contacted |
| 16 | vllm-project/guidellm | import-linter | library | CLAUDE.md, AGENTS.md, .claude | Active, agent files committed | not contacted |
| 17 | NVIDIA-NeMo/Automodel | import-linter | FastAPI | CLAUDE.md, AGENTS.md, .claude | Large org, lower reply odds | not contacted |

Small teams (4, 5, 6, 8) are more likely to answer than the large orgs; the
large ones are worth one message each because a yes there carries weight.

## Ask

Try `inwards hook claude-code` on one repo for two weeks, with the config
translated from the checker they already run. In return: we translate the
config, fix what breaks, and share the eval report. Consent needed, in writing:
hook runs on their machines, and sharing the opt-in run log (codes, files,
retries; no source code).

## Log

| Date | Repo | Contact | What happened | Next step |
|---|---|---|---|---|
