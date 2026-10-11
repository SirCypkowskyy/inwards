# AGENTS.md (Codex, Cursor, and others)

!!! info "Verified 2026-09-25"
    Linux by hand: `init`, the section it writes, and `inwards check --format json`. No agent was run. On macOS (arm64) and Windows, CI runs `init` with the compiled binary before each release; a by-hand check there is still open.

Many coding agents read [`AGENTS.md`](https://agents.md) at the root of the repository for project instructions, including OpenAI Codex, Cursor, and Jules. Inwards adds a short section there that tells the agent to run the check before finishing, and how to read the result.

## Set it up

1. [Install Inwards](install.md) so that `inwards` is on `PATH` for everyone who runs the agent, and add `[tool.inwards]` to `pyproject.toml`.
2. In the project, run:

    <!-- e2e -->

    ```sh
    inwards init --agent agents-md
    ```

    It pins `required-version` and a default `ignore` list in `[tool.inwards]`, adds `.inwards/` to `.gitignore`, and adds this section to `AGENTS.md` (creating the file if needed):

    ```markdown
    <!-- inwards:begin -->
    ## Architecture check (Inwards)

    The layers in `[tool.inwards]` (pyproject.toml) are enforced. Before you finish a task, run:

        inwards check --format json

    Exit code 1 means an import breaks a layer: follow the numbered `fix.steps` in the output.
    Don't edit `[tool.inwards]` to make the check pass; ask the user instead.
    <!-- inwards:end -->
    ```

    If the project runs Inwards through uv (a dev dependency, no activated virtualenv), add `--launcher "uv run"`, and the section says `uv run inwards check --format json`:

    ```sh
    uv run inwards init --agent agents-md --launcher "uv run"
    ```

    The section names one command for the project. Run at a uv workspace root, it checks every member that has its own `[tool.inwards]` ([Monorepos and uv workspaces](configuration.md#monorepos)). With several tables in another layout, add a line per config by hand outside the markers, with `--config <package>/pyproject.toml`.

3. Commit `AGENTS.md`. Running `init` again replaces only the text between the markers.

## The architecture brief (opt-in)

The section above tells the agent to check its work after the fact. The brief tells it the architecture before it writes the first import: fixing a violation costs a retry, avoiding one costs nothing. It is off by default, so a team can compare runs with and without it; the run log's violation rate would otherwise mix the two.

`inwards context` prints the brief for the nearest `[tool.inwards]`:

<!-- e2e -->

```sh
inwards context
```

It lists the layers innermost first with what each may import, where ports live, and, when configured, the library rules (INW005), the contexts with their public modules and dependencies (INW002, INW003), and the opt-in rules the config turns on. Rules turned off in `[tool.inwards.rules]` are left out. A layer with more than three layers inside it names them by their numbers in the list (`may import layers 1-9`); a brief that does so names the sibling groups once in its first sentence (`sibling groups: 2-4; 5-6`) instead of on every line. A context's public modules inside its one module share that prefix (`` `app.posts.{router,service}` ``), and so do the modules of a `deny` entry with one parent (`` `app.*.{models,service}` ``). With INW002 off, the contexts leave out their dependencies. For the repository's example config (`examples/clean-app`) it is 678 characters, about 170 tokens; a test keeps the example and every preset under 300 tokens (at four characters per token), except the fastapi preset, with eleven layers, a `deny` entry and eleven opt-in rules, under 550 (about 540). With the markers `--write` adds, it reads:

```markdown
<!-- inwards-brief:begin -->
## Architecture brief (Inwards)

`[tool.inwards]` in pyproject.toml enforces these layers, innermost first. Imports point inwards: never import a layer listed after your own.

1. domain (`shop.domain`): imports no other layer
2. application (`shop.application`): may import domain
3. infrastructure (`shop.infrastructure`): may import domain, application
4. interface (`shop.api`, `shop.cli`): may import every other layer

Ports: when an inner layer needs something from an outer one, declare a `typing.Protocol` in `shop.domain.ports` and implement it in the outer layer.

Libraries (INW005):
- domain: no web frameworks, database or network clients, `subprocess` or `socket`
<!-- inwards-brief:end -->
```

Ports are the `ports` package or module directly inside a layer's module on disk (`shop/domain/ports.py` here). For a config `inwards init --style` wrote, the brief also names the preset and its ports module (`app.application.ports` for clean and hexagonal) before `--scaffold` creates it; it finds the preset by the comment init put in the table, so deleting that comment drops the name.

Each opt-in rule the config turns on (INW012 to INW016 and the FAPI rules, through `extend-select`, `select` or a [template role](configuration.md#template-rules)) adds one line under "Opt-in rules:". The line says what to do while writing code, with the rule's key setting: INW012's `delegate-to`, INW014's port modules (its `modules`, or else every `ports` module), INW015's `role` and `allowed-in`, INW016's naming scheme, FAPI001's required metadata, FAPI002's `codes` and FAPI003's `entrypoints`. A rule scoped by `modules` names them (`INW013 in app.*.router`). INW015 checks nothing without a `role`, so it gets no line then. Under `inwards init --style fastapi` they read:

```markdown
Opt-in rules:
- INW012: endpoints stay thin: call into `domain.service`; no queries or outgoing calls
- INW013: no blocking calls in `async def`: use async clients or a plain `def`
- INW016 in `app.*.models`: singular snake_case tables; datetime/date columns end in `_at`/`_date`
- FAPI001: path operations need a summary or docstring, a response model, `status_code` on POST/DELETE and `description` per `responses` entry
- FAPI002: declare every 4xx a path operation raises in `responses`
- FAPI003: include every `APIRouter` in an app; no include cycles
- FAPI005: declare `/items/me` before `/items/{id}`, so no route is shadowed
- FAPI006: startup and shutdown go in a lifespan, not `on_event`
- FAPI007: a dependency with `yield` re-raises what it catches
- FAPI008: each `operation_id` is unique within its app
- FAPI009: pass `Depends(get_db)`, not `Depends(get_db())`
```

To keep it in `AGENTS.md`, between its own markers next to the check section:

- `inwards context --write` adds the section, or replaces the text between `<!-- inwards-brief:begin -->` and `<!-- inwards-brief:end -->` in place. Run it again after changing `[tool.inwards]`; it says "up to date" when nothing changed.
- `inwards init --agent agents-md --brief` writes both sections in one run. `--brief` works with every `--agent`, with `--style`, and alone (`inwards init --brief`).

The brief always goes to `AGENTS.md`, never `CLAUDE.md`: one file serves every agent, and a repository that keeps `CLAUDE.md` as the single line `@AGENTS.md` (as this one does) gives Claude Code the same text. If your `CLAUDE.md` has no such line, add it, or Claude Code won't see the brief.

## Check it works

- Run `inwards check --format json` yourself. A `violations` count of 0 in the summary means the project is clean.
- Ask the agent to make a change in the domain layer. At the end it should run `inwards check --format json` and report the result.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| The agent never runs the check | This is an instruction, not a hook, so the agent may skip it. Use an agent with hooks (such as [Claude Code](claude-code.md)) or run `inwards check` in CI. |
| `init` stops with "unmatched markers" | `AGENTS.md` doesn't have exactly one `inwards:begin` and one `inwards:end` marker (or, for the brief, one `inwards-brief:begin` and one `inwards-brief:end`). Fix or remove them by hand, then run `init` again. |
| `inwards: command not found` in the agent's shell | The agent's environment doesn't see the binary. Put it on `PATH` there, or, when Inwards is a uv dev dependency, run `init` again with `--launcher "uv run"`. (Editing the command inside the markers works until the next `init`, which puts the section back.) |

For a hard stop, run `inwards check` in CI: exit code 1 fails the job. The [GitHub Actions guide](ci.md) has a workflow that also annotates the pull request and uploads SARIF to code scanning.
