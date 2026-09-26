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

- **Starting an issue: check, then claim.** Every agent uses the owner's
  account, so the assignee says nothing about *which* agent works on an
  issue. Before you start, check all three, and pick another issue if any of
  them says someone has it:
  1. the board status is Todo;
  2. `gh issue develop N --list` shows no linked branch;
  3. the issue's comments have no claim that is still open, i.e. a
     "Claimed by …" comment with no later "Released" or closing report.

  Then claim it in one go:
  - `gh issue develop N --name <type>/N-slug --base develop --checkout --worktree ~/Documents/GitHub/worktrees/inwards/N-slug`
    creates the branch, links it to the issue (the issue's Development panel
    shows it to every other agent), sets `develop` as the PR base and checks
    it out in the worktree;
  - set Status to In progress;
  - post the claim comment: who you are (harness and model, e.g. "Claude
    Code, Opus 5.5" or "Codex"), the branch, the worktree and the plan when
    it isn't obvious from the issue.

  Right after claiming, run `gh issue develop N --list` again: two agents
  can pass the checks at the same moment. If there are two linked branches,
  the later claimant releases.

  If your harness can't reach GitHub or write outside its checkout (Codex's
  default sandbox, for example), ask the coordinator to claim the issue and
  create the worktree for you.

  If you stop without finishing, release the issue so the next agent sees it
  free: push anything worth keeping, then post "Released: <why, what's done,
  and the commit SHA of anything worth keeping>", delete the linked branch
  (`git push origin --delete <branch>`, `git worktree remove <path>`,
  `git branch -D <branch>`), and set the status back to Todo.
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
gh issue develop N --list                         # a linked branch means it's taken
gh issue view N --comments                        # an open "Claimed by" means it's taken
gh issue develop N --name feat/N-slug --base develop --checkout \
  --worktree ~/Documents/GitHub/worktrees/inwards/N-slug
gh issue comment N --body "Claimed by Claude Code (Opus 5.5). Branch feat/N-slug, worktree ~/Documents/GitHub/worktrees/inwards/N-slug. Plan: …"
gh issue comment N --body "Status: Blocked. Waiting on #M (engine API)."
gh issue view N --json body -q .body > body.md   # tick boxes, then:
gh issue edit N --body-file body.md

# Project board: user project 3
gh project item-list 3 --owner SirCypkowskyy -L 300 --query "status:Todo"  # free (then check links and comments)
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

## Branches

`develop` is the default branch and the only target for work
([ADR-019](docs/chapters/05-ADR.md)). Every PR goes to `develop` and is
squash-merged. `main` holds released code and moves only at a release: the
owner opens a promotion PR `develop` → `main` and merges it with a merge
commit, then merges release-please's release PR. The release commit (versions,
CHANGELOG) stays on `main` only, so `develop` keeps `0.1.0` in its version
fields; that is expected, and one more reason never to edit those files.
Rulesets enforce this: no direct pushes, no force pushes, required checks,
squash only into `develop`, merge commits only into `main`.

Agents from other harnesses work the same way as the coordinator's subagents:
claim the issue, use their own worktree, open a PR to `develop`, and leave the
merge to the coordinator or the owner.

## Parallel agents and worktrees

Several agents may run at once. Every agent uses the same GitHub account, so
the claim comment, not the assignee, says which agent owns an issue.

- **One issue, one branch, one worktree.** Branch `<type>/<N>-<slug>`
  (`feat/42-sarif-output`). Worktrees live outside the checkout, in
  `~/Documents/GitHub/worktrees/<repo>/<worktree>`, here
  `~/Documents/GitHub/worktrees/inwards/<N>-<slug>`. Create both with
  `gh issue develop` (see "Starting an issue" above) so the branch is linked
  to the issue, then run `bun install` inside the worktree. Work that has no
  issue uses `git worktree add <path> -b <branch> origin/develop`.
- **Claim before the first edit**, as "Starting an issue" says: board, linked
  branches and comments first, then the linked branch, In progress and the
  claim comment. Never pick up an item that is In progress, Blocked or In
  review, that has a linked branch, or that has an open claim; pick another
  or ask the coordinator.
- **Stay in your lane.** Never edit files, run git, or install in another
  agent's worktree or on its branch. Never `git stash`, `checkout`, `switch`,
  `reset` or `rebase` in the shared primary checkout (`~/Documents/GitHub/inwards`): others have uncommitted
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
- **Commit on your branch only.** Rebase on `origin/develop` and rerun the
  checks below before handing back. Open the PR with `--base develop`. Don't
  merge, and don't push to `develop` or `main`; the coordinator merges one
  branch at a time.
- **Blocked means stop.** Set Blocked, comment the reason on the issue, and
  report it to the coordinator.
- **Clean up.** Once the branch is merged or dropped, whoever created the
  worktree runs `git worktree remove ~/Documents/GitHub/worktrees/inwards/<N>-<slug>`
  and, once `gh pr view --json state` says MERGED, `git branch -D <branch>`
  (a squash-merged branch is not an ancestor of `develop`, so `-d` refuses it).

A coordinator that spawns a subagent does the whole claim itself (the checks,
`gh issue develop`, In progress, and a claim comment naming the subagent)
before the subagent starts, so two agents never race for it; the subagent
skips the claim. Each subagent prompt names the issue, the base branch, the
branch, the worktree path, the files or directories it may touch, and any
high-conflict file it owns. The coordinator removes the worktree after the
merge.

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
tests against the compiled binary: on Linux for every PR; on macOS, Windows
and the older Ubuntu only when started by hand, and in `cd.yml` at a release.

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
- **macOS and Windows never run on PRs or on a schedule** (#126): the
  owner's Actions budget is small, and those runners bill at 10x (macOS)
  and 2x (Windows). A PR only proves Linux. Never start the full matrix
  yourself; the owner (or the coordinator, when asked) runs it once before
  a release with `gh workflow run ci.yml --ref develop`, and `cd.yml`
  verifies each binary on its own OS at the tag.
- **Parallel agents:** run `act` in your own worktree only. Each run gets
  its own container. The first run pulls a 2.3 GB image.
- **`setup-bun` fails with "Unable to locate executable file"**: act's local
  cache server restored a Bun cache saved under another worktree path. Rerun
  with `--no-cache-server`.

## Commits, PR titles and releases

PRs are squash-merged into `develop` ([ADR-017](docs/chapters/05-ADR.md)): the
PR title is the one commit on `develop`, and later its CHANGELOG line, and the
PR description is its body. Commits inside a branch can say anything.

- **Title:** `type(scope): summary`, checked by `pr-title.yml`. Types that
  reach the changelog: `feat`, `fix`, `perf`, `deps`, `revert`, `docs`.
  Hidden: `refactor`, `test`, `build`, `ci`, `chore`. The scope is optional
  and free-form; the usual ones are `core`, `cli`, `hook`, `rules`, `vscode`,
  `wheels`, `bench` and `docs`. The summary says in the
  imperative what a user gets, with no trailing period.
- **Breaking change** (a config key removed or renamed, an exit code changed,
  a `diagnostics@1` field removed, a CLI flag removed): `feat!:` in the title
  and a `BREAKING CHANGE: <what to do>` paragraph in the description.
- **Never** edit `CHANGELOG.md`, `VERSION` or any `version` field, and never
  push tags. release-please keeps the release PR (ADR-016); the owner merges
  it and publishes the draft release. `scripts/check-version.sh` fails CI when
  version fields disagree.
- The PR description is the commit body, and release-please reads it too.
  Don't start a paragraph with `fix:`, `feat:` or another type, because each
  one becomes an extra changelog entry. `Release-As: 0.N.0` only counts in the
  description's **last paragraph**.
- **A release happens in one sitting, with `develop` frozen** (owner, or the
  coordinator when asked). release-please walks `main`'s history by commit
  date and stops at the last release commit, so a PR squash-merged into
  `develop` before a release PR merges, but promoted after it, is silently
  left out of the changelog and the version bump.
  1. Stop merging into `develop`, then run the full test matrix once
     (`gh workflow run ci.yml --ref develop`) and fix any red macOS or
     Windows row first.
  2. Promote: `gh pr create --base main --head develop --title "chore: promote develop to main" --body "Promotes develop for the next release."`,
     then `gh pr merge N --merge`. Never squash it: release-please reads the
     feature commits through the merge. Keep the description free of
     `feat:` or `fix:` paragraphs.
  3. Wait for release-please to update its release PR, check the changelog,
     and merge it (`gh pr merge N --merge --admin`: it gets no CI run).
  4. Publish the draft release, then resume merging into `develop`.

  Don't promote without releasing, and never merge a release PR that isn't
  right after a promotion. Before merging anything into `develop`, check that
  no release is in progress: `gh pr list --base main --label "autorelease: pending"`
  is empty **and** the tip of `main` isn't a promotion
  (`git fetch -q origin main && git log -1 --format=%s origin/main`
  doesn't start with `chore: promote`). The second check covers the seconds
  before release-please opens its PR, or a failed release-please run.
- **Dependabot PRs** (weekly, into `develop`, `.github/dependabot.yml`):
  - The Bun groups come titled `build:`, which keeps toolchain bumps out of
    the changelog. Retitle a `runtime` group PR (tree-sitter, smol-toml, the
    LSP libraries) to `deps:` before merging, since users get those.
  - They touch `bun.lock` or `uv.lock`, so they merge one at a time like any
    lockfile change; everyone else rebases and reruns `bun install` or
    `uv lock` afterwards.
  - Never push to a Dependabot branch. Comment `@dependabot rebase` or
    `@dependabot recreate` instead.
  - A `web-tree-sitter` or `tree-sitter-python` bump changes the parser:
    check the E2E snapshots and the `prescan-diff` job before merging.
  - `@types/vscode` is bumped by hand, together with `engines.vscode`.
- A GitHub "Revert" button titles the PR `Revert "…"`. Rename it
  `revert: …` so the title check passes.
- To fix a changelog line after a merge, edit the merged PR's description with
  a `BEGIN_COMMIT_OVERRIDE` … `END_COMMIT_OVERRIDE` block.

## Finishing a piece of work

Before you hand back or merge, update the docs and the issues. Work is not
done until both match the code.

- **Docs** (`docs/chapters/`, `README.md`, `eval/README.md`, `AGENTS.md`):
  describe what the code does now. Drop "planned" from anything that shipped,
  fix numbers that changed (tests, corpus sizes, timings), and write an ADR
  for any decision a later reader would question. Run the strict docs build.
- **Every issue you touched** gets a closing report as a comment. It is the
  context a later session (yours or another agent's) reads instead of
  re-deriving the work, so write it for someone who wasn't there:
  - *Done*: what changed, with the PR and commit, and where it lives (files,
    modules, config keys, commands);
  - *Verified*: how you know it works (tests, CI run, `act`, a manual check,
    review rounds);
  - *Challenges*: what was harder than expected, dead ends, surprises in the
    code or the tools, and how you got past them;
  - *Weaknesses*: the known limits and trade-offs of the solution, edge
    cases it gets wrong or doesn't cover, and what you would do differently
    with more time;
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
