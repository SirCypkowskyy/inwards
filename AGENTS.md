# Inwards: working rules

Edit this file (`AGENTS.md`). `CLAUDE.md` holds only `@AGENTS.md`, which
Claude Code expands on load; Codex, Cursor and other agents read this file
directly. Never add content to `CLAUDE.md`.

Architecture linter for Python, written in TypeScript on Bun. Engine in
`src/core`, CLI in `src/cli`, VS Code extension in `src/vscode-extension`,
docs in `docs/` (Zensical). The plan lives in GitHub issues on
`SirCypkowskyy/inwards`: epics #1 to #7 are milestones M0 to M6, and every
other issue is a sub-issue of one of them.

Bun lives in `~/.bun/bin`; prefix `PATH` in non-interactive shells.

## Source of truth: issues, then the board

1. **GitHub issues** hold scope, acceptance criteria and decisions. Code
   comments, local files and chat are not a source of truth: if it matters,
   it goes on the issue.
2. **The "Inwards" Project board**
   ([user project 3](https://github.com/users/SirCypkowskyy/projects/3))
   holds who is doing what right now. Status is one of Todo, In progress,
   Blocked, In review, Done. If the board and an issue disagree, the issue
   wins; fix the board.

`.claude/plan/backlog.yaml` and `scripts/sync-backlog.py` are retired seeds;
don't edit or run them. The issue table in an epic's body is a seed-time
snapshot; its sub-issue list is what counts.

Check the board before picking up work, and set Status at every transition:

- **Starting an issue.** Take only an item in Todo with no assignee. Assign
  yourself, set In progress, and comment the branch and worktree you work in,
  plus the plan when it isn't obvious from the issue.
- **While working.** Comment on decisions, scope changes and findings someone
  else will need. Tick acceptance checkboxes in the body as they are met.
- **Stuck.** Set Blocked and comment what blocks it and who or what can
  unblock it. If another issue blocks it, add a native dependency, not just a
  mention.
- **Done.** The PR description says `Closes #N`, or `Refs #N` for partial work. Status is
  In review while a PR is open or the branch waits for merge, and Done when
  the issue closes. Every acceptance checkbox is ticked or has a comment
  saying why not.
- **New work found along the way** becomes a new issue with `type:`, `area:`,
  `priority:` and `size:` labels and a milestone, linked as a sub-issue of
  that milestone's epic, and added to the board in Todo. Never a TODO in code.

`gh project` runs on GraphQL, and every agent shares one 5,000-point hourly
limit. Read the board once when you pick up work, not in a loop.

```sh
R=SirCypkowskyy/inwards
gh issue edit N --add-assignee @me
gh issue comment N --body "Claimed. Branch feat/N-slug, worktree ../inwards-N-slug."
gh issue comment N --body "Status: Blocked. Waiting on #M (engine API)."
gh issue view N --json body -q .body > body.md   # tick boxes, then:
gh issue edit N --body-file body.md

# Project board: user project 3
gh project item-list 3 --owner SirCypkowskyy -L 300 --query "status:Todo no:assignee"  # free
gh project item-list 3 --owner SirCypkowskyy -L 300 --query "-status:Todo -status:Done" # taken
gh project item-list 3 --owner SirCypkowskyy --query "assignee:@me -status:Done"       # mine
gh project item-add 3 --owner SirCypkowskyy --url https://github.com/$R/issues/N
gh project item-edit 3 --owner SirCypkowskyy --url https://github.com/$R/issues/N \
  --field Status --value "In progress"   # one field per call
gh project field-list 3 --owner SirCypkowskyy     # field and option IDs, if needed

# New issue, linked to its epic (sub_issue_id and issue_id are REST ids, not numbers)
gh issue create -t "..." -F body.md -m "M1 · Agent loop MVP (v0.1)" \
  -l type:feature,area:cli,priority:P1,size:S
ID=$(gh api repos/$R/issues/N --jq .id)
gh api repos/$R/issues/EPIC/sub_issues -F sub_issue_id=$ID
gh api repos/$R/issues/N/dependencies/blocked_by -F issue_id=$BLOCKER_ID
```

## Parallel agents and worktrees

Several agents may run at once. Every agent uses the same GitHub account, so
the claim comment, not the assignee, says which agent owns an issue.

- **One issue, one branch, one worktree.** Branch `<type>/<N>-<slug>`
  (`feat/42-sarif-output`), worktree `../inwards-<N>-<slug>` next to this
  checkout, created by hand off the base branch the coordinator names:
  `git worktree add ../inwards-42-sarif-output -b feat/42-sarif-output main`,
  then `bun install` inside it.
- **Claim before the first edit.** Assign yourself, set In progress, post the
  claim comment. Never pick up an item that is In progress, Blocked, In
  review or assigned; pick another or ask the coordinator.
- **Stay in your lane.** Never edit files, run git, or install in another
  agent's worktree or on its branch. Never `git stash`, `checkout`, `switch`,
  `reset` or `rebase` in the shared main checkout: others have uncommitted
  work there.
- **No shared mutable state.** Run `bun install` in each worktree (isolated
  linker, nothing shared). Temp files go in your own `mktemp -d`, never a
  fixed path in `/tmp` or the repo. No fixed ports for dev servers.
- **High-conflict files have one owner at a time:** `bun.lock`, `uv.lock`,
  `package.json`, `pyproject.toml`, `AGENTS.md`, `.github/workflows/`,
  `release-please-config.json`, `.release-please-manifest.json`,
  `src/cli/test/__snapshots__/`. The coordinator names the owner in the
  prompt; everyone else leaves them alone and asks. Never merge a lockfile by
  hand: take the base version and rerun `bun install` or `uv lock`.
  Regenerate snapshots after a rebase and review the diff.
- **Commit on your branch only.** Rebase on the base branch and rerun the
  checks below before handing back. Don't merge, and don't push to `main` or
  the base branch; the coordinator merges one branch at a time.
- **Blocked means stop.** Set Blocked, comment the reason on the issue, and
  report it to the coordinator.
- **Clean up.** Once the branch is merged or dropped, whoever created the
  worktree runs `git worktree remove ../inwards-<N>-<slug>` and, once
  `gh pr view --json state` says MERGED, `git branch -D <branch>` (a
  squash-merged branch is not an ancestor of `main`, so `-d` refuses it).

A coordinator claims the item on the board before it spawns a subagent, so
two agents never race for it. Each subagent prompt names the issue, the base
branch, the branch, the worktree path, the files or directories it may touch,
and any high-conflict file it owns.

## Before every commit

```sh
bun x biome ci .        # lint + format, every rule group at error
bun run lint:docs       # oxlint + eslint-plugin-jsdoc: TSDoc on every function
bun run typecheck       # tsgo, strictest flags (tsconfig.base.json)
bun run fallow          # dead code, unused deps, boundaries, duplication
bun test                # unit + CLI + E2E snapshots
uv run scripts/check-docs-nav.py  # every page in docs/chapters is in the nav
```

CI also runs `prescan-diff` (the prescan must never miss an import) and the
tests against the compiled binary on Linux, macOS and Windows.

## Before pushing to a PR

Run the CI jobs locally in Docker with [`act`](https://github.com/nektos/act)
(0.2.89 or newer) before you push, so CI confirms a green run instead of
finding the bug. `.actrc` maps the runner labels to
`catthehacker/ubuntu:act-24.04` (there is no 26.04 image for act yet).

```sh
act pull_request -W .github/workflows/ci.yml -j engine                        # lint, typecheck, fallow, prescan
act pull_request -W .github/workflows/ci.yml -j test --matrix os:ubuntu-26.04  # tests against the compiled Linux binary
act pull_request -W .github/workflows/ci.yml -j docs                          # strict docs build
act workflow_dispatch -W .github/workflows/docs-links.yml                    # external links (weekly on GitHub)
act push -W .github/workflows/cd.yml -n                                       # CD: dry run, validates the workflow only
```

- **Changed a workflow?** Run the jobs you touched with `act` first. For
  jobs that can't run (see below), `act -n` at least validates them.
- **What act can't do:** the macOS and Windows matrix rows, OIDC and
  attestations, releases, and Pages deploys. Those run only on GitHub, so CI
  stays the gate.
- **Parallel agents:** run `act` in your own worktree only. Each run gets
  its own container. The first run pulls a 2.3 GB image.

## Commits, PR titles and releases

PRs are squash-merged ([ADR-017](docs/chapters/05-ADR.md)): the PR title is
the one commit on `main` and its CHANGELOG line, and the PR description is its
body. Commits inside a branch can say anything.

- **Title:** `type(scope): summary`, checked by `pr-title.yml`. Types that
  reach the changelog: `feat`, `fix`, `perf`, `deps`, `revert`, `docs`.
  Hidden: `refactor`, `test`, `build`, `ci`, `chore`. The scope is optional
  (`core`, `cli`, `hook`, `vscode`, `wheels`, `docs`). The summary says in the
  imperative what a user gets, with no trailing period.
- **Breaking change** (a config key removed or renamed, an exit code changed,
  a `diagnostics@1` field removed, a CLI flag removed): `feat!:` in the title
  and a `BREAKING CHANGE: <what to do>` paragraph in the description.
- **Never** edit `CHANGELOG.md`, `VERSION` or any `version` field, and never
  push tags. release-please keeps the release PR (ADR-016); the owner merges
  it and publishes the draft release. `scripts/check-version.sh` fails CI when
  version fields disagree.
- To fix a changelog line after a merge, edit the merged PR's description with
  a `BEGIN_COMMIT_OVERRIDE` … `END_COMMIT_OVERRIDE` block.

## Finishing a piece of work

Before you hand back or merge, update the docs and the issues. Work is not
done until both match the code.

- **Docs** (`docs/chapters/`, `README.md`, `eval/README.md`, `AGENTS.md`):
  describe what the code does now. Drop "planned" from anything that shipped,
  fix numbers that changed (tests, corpus sizes, timings), and write an ADR
  for any decision a later reader would question. Run the strict docs build.
- **Every issue you touched** gets a closing comment in three parts:
  - *Done*: what changed, with commits or the PR;
  - *Verified*: how you know it works (tests, CI run, `act`, a manual check);
  - *Left*: what is still open. Each open item gets its own issue, linked,
    or stays as an unticked acceptance box with a reason.
  Then tick the acceptance boxes that are met and set the board status.
- **The epic** of the milestone: tick exit criteria that are met, and comment
  on the milestone's state when a batch of its issues closes.
- Anything moved to another milestone is moved on GitHub (milestone,
  sub-issue link to the new epic, board), not just mentioned in a comment.

## Code rules

- **Strict typing, no escape hatches** (tsc, Biome). No `any`, no non-null `!`,
  no `as` casts except at a trust boundary right after validation, with a
  `biome-ignore lint/nursery/noUnsafeTypeAssertion: <what was checked>`.
  Prefer `unknown` plus a type guard. Explicit types on every function.
  Rule exceptions live in `biome.jsonc`, each with its reason.
- **Every function is documented** (`lint:docs`) with a TSDoc block,
  including private helpers and arrow functions bound to a name:
  - first line: a title that says what it does;
  - then 1-3 lines of description (what, and why when it isn't obvious);
  - a longer section when the behaviour has edge cases, invariants or a
    non-obvious reason (see `importSkeleton` in `src/core/src/prescan.ts`);
  - `@param` for every parameter and `@returns` for every non-void return.
- **Ports and adapters where it pays.** The engine (`src/core`) is the
  hexagon: pure, no I/O, no `Bun`/`Deno`/`node:fs`. Anything it needs from outside comes through a port, an
  interface the core owns (`GrammarBinaries`, `SourceFile`), and adapters
  (CLI, LSP, tests) implement it. Adapters import `@inwards/core` only, never
  core internals (fallow boundaries in `.fallowrc.jsonc`; Biome bans Node,
  Bun and env access in `src/core/src`). Add a port only when a second
  adapter or a test needs it; one interface with one implementation and no
  test seam is just indirection.
- Machine output (JSON, SARIF, hook stderr) goes through
  `process.stdout/stderr.write`, never `console.*` (Bun colours
  `console.error` under `FORCE_COLOR`). Biome's noConsole enforces it outside
  scripts.
- Anything an agent reads is a contract: `inwards/diagnostics@1` fields are
  only ever added, and E2E snapshots (`bun test`) pin exit codes and output.

## Writing

Docs, commit messages and PR text in English, plain and specific (the
`humanizer` skill's rules): no filler, no em dashes, numbers over adjectives.
