# :material-format-list-checks: Rules

Every diagnostic Inwards prints links to its rule's page here: the `docs:` line of the text output, the `docs` field of the JSON output, `helpUri` in SARIF and the code link in the editor. Each page says what the rule flags, why it matters when an AI agent writes the code, a flagged and a fixed example, how to fix a finding, how to configure the rule, and what it doesn't catch yet.

Search the rules, filter them by category, status or autofix, sort them by code, name or status, and page through them. The address bar keeps the view, so a link opens the same list. A category includes its sub-categories: `imports` also lists the rules filed under `imports › layers`.

<div class="inw-rules" data-inwards-rules="rules.json"></div>

<div class="inw-rules-fallback" markdown>

| Code | Name | What it flags | Default | Inline suppression |
|---|---|---|---|---|
| [INW000](INW000.md) | `unsupported-encoding` | A declared source encoding under which a comment can be a real import | error | no |
| [INW001](INW001.md) | `layer-dependency` | An import from an inner layer into an outer one | error | yes |
| [INW002](INW002.md) | `context-independence` | An import from one bounded context into another its `depends-on` doesn't declare | error | yes |
| [INW003](INW003.md) | `public-api-only` | An import of a context's module that isn't public, from outside the context | error | yes |
| [INW004](INW004.md) | `import-cycles` | Modules, or bounded contexts, that import each other in a cycle (whole-project runs) | error | no |
| [INW005](INW005.md) | `pure-domain` | A library import a layer's config doesn't allow, such as SQLAlchemy in the domain | error | yes |
| [INW006](INW006.md) | `unassigned-module` | First-party code outside every layer, and layer prefixes that match nothing | error, some findings warn | yes |
| [INW007](INW007.md) | `package-shape` | A package member its shape doesn't allow, or a name outside the packages it belongs in | error, some findings warn | no |
| [INW008](INW008.md) | `missing-member` | A member a package's shape requires is missing | error | no |
| [INW009](INW009.md) | `suppression-comment` | An inline suppression that hides nothing, or matches no finding | error, unused ones warn | no |
| [INW010](INW010.md) | `unknown-first-party` | An import of a first-party module that doesn't exist | error | yes |
| [INW011](INW011.md) | `dynamic-import` | A dynamic import that reaches an outer layer, or whose target Inwards can't read | error | yes |
| [INW012](INW012.md) | `thin-endpoint` | An HTTP endpoint that does the work itself: too many statements, branches or loops, database or HTTP calls of its own, or no call into the layer `delegate-to` names | opt-in, warning | yes |
| [INW013](INW013.md) | `async-blocking` | A synchronous database, cache or cloud call inside `async def`: a sync SQLAlchemy `Session`, `redis.Redis`, boto3 or a blocking driver | opt-in, error | yes |
| [INW014](INW014.md) | `ports-abstract` | A class in a port module that isn't an ABC or a Protocol, or a port method whose body does work | opt-in, error | yes |
| [INW015](INW015.md) | `construct-only-in` | A module outside the composition root that imports an outbound adapter, or another guarded role, at runtime, or builds one of its classes | opt-in, error | yes |
| [INW016](INW016.md) | `orm-naming` | A table name that isn't lower_case_snake and singular, or a datetime or date column without `_at` or `_date`; a whole-project run also wants a `MetaData` naming convention | opt-in, error | yes |

</div>

## FastAPI rules { #fastapi }

The `FAPI` family checks FastAPI applications across files: which router the app includes, which error codes the OpenAPI schema declares ([ADR-037](../05-ADR.md#adr-037-framework-rule-families-opt-in-with-their-own-prefix)). Every FAPI rule is opt-in, and none reports what Ruff's `FAST` rules already do. On a new project, [`inwards init --style fastapi`](../guides/install.md#a-new-project-start-from-a-preset) turns them all on as warnings.

<div class="inw-rules-fallback" markdown>

| Code | Name | What it flags | Default | Inline suppression |
|---|---|---|---|---|
| [FAPI001](FAPI001.md) | `endpoint-metadata` | A path operation without the OpenAPI metadata the project requires (summary, response model, status code) | opt-in, error | yes |
| [FAPI002](FAPI002.md) | `undocumented-error-response` | A path operation that can produce an error status code (raised directly, in a helper or dependency, or through an app's exception handler) its `responses=` doesn't declare | opt-in, error | yes |
| [FAPI003](FAPI003.md) | `router-wiring` | An `APIRouter` with routes that no app includes, routers that include each other in a cycle, or an `include_router` above the included router's routes | opt-in, error | yes |
| [FAPI005](FAPI005.md) | `route-shadowing` | A path operation that an earlier one with the same method already answers: `/users/{id}` above `/users/me`, or the same method and path twice | opt-in, error | yes |
| [FAPI006](FAPI006.md) | `lifespan-events` | A deprecated `on_event` handler or `on_startup=` (a warning), and one next to a `lifespan=` that makes FastAPI ignore it (an error) | opt-in, error | yes |
| [FAPI007](FAPI007.md) | `yield-dependency-swallows` | A dependency with `yield` whose `except` clause around it doesn't re-raise, so the endpoint's error is hidden | opt-in, error | yes |
| [FAPI008](FAPI008.md) | `duplicate-operation-id` | Two path operations of one app with the same literal `operation_id` | opt-in, error | yes |
| [FAPI009](FAPI009.md) | `depends-called` | `Depends(get_db())`: the dependency is called at import time instead of being passed | opt-in, error | yes |

</div>

One code is reserved and not registered (an unknown code is still a config error):

| Code | Name | Issue | Status |
|---|---|---|---|
| FAPI004 | `unhandled-exception` | [#185](https://github.com/SirCypkowskyy/inwards/issues/185) | unused: the spike's corpus run said no-go (3% precision for declared exception classes, 4 true findings in 25 apps for raised ones) |

The [rule catalogue](../03-Architecture-C4.md#rule-catalogue) in chapter 3 lists every rule with the rest of the design.

## Configure rules

A `[tool.inwards.rules]` table in `pyproject.toml` says which rules report and how loudly ([ADR-027](../05-ADR.md#adr-027-per-rule-select-ignore-and-severity-in-a-toolinwardsrules-table)):

<!-- config: fragment -->

```toml title="pyproject.toml"
[tool.inwards.rules]
ignore = ["INW007", "INW008"]      # these rules never report
severity = { INW005 = "warning" }  # reported, but doesn't fail a check or block the agent
# extend-select = [...]           # turn opt-in rules on, next to the defaults
# select = ["INW001", "INW011"]    # or: only these rules report (default: every rule that is on by default)
```

Codes are exact, not prefixes, and an unknown code is a config error (exit 2). `ignore` wins over `select` and `extend-select`. A rule set to `"warning"` shows up in every format but doesn't change the exit code, block the hooks or go into the baseline. INW000 can't be ignored or lowered. The table is part of `[tool.inwards]`, so the config guard stops an agent from editing it.

### Opt-in rules and rule options { #opt-in-rules }

A rule whose Default column says "opt-in" doesn't report until you turn it on: list its code in `extend-select`, which keeps every other rule as it is, or in `select`. The INW rules are on by default, apart from [INW012](INW012.md), [INW013](INW013.md), [INW014](INW014.md), [INW015](INW015.md) and [INW016](INW016.md); the opt-in ones are the rules that judge code against thresholds a team picks, such as INW012, the rules that judge the content of a role's modules, such as INW013, INW015 and INW016, and framework families such as [FastAPI](#fastapi). SARIF lists an opt-in rule with `defaultConfiguration.enabled` set to `false`.

A rule's options live in a table named after the rule, `[tool.inwards.rules.<rule-name>]`. Some rules take options of their own, listed on their pages ([INW012](INW012.md#configuration), [INW013](INW013.md#configuration), [INW014](INW014.md#configuration), [INW015](INW015.md#configuration), [INW016](INW016.md#configuration), [FAPI001](FAPI001.md#configuration), [FAPI002](FAPI002.md#configuration)). Every rule takes `modules`, a list of module prefixes or selectors written as in a [layer's `modules`](../guides/configuration.md#layers) (`shop.domain` covers that package and everything below it, `shop.*.api` uses wildcards): the rule then reports only in the modules they match. An unknown key or a wrong type is a config error that names the key.

<!-- config: fragment -->

```toml title="pyproject.toml"
[tool.inwards.rules.pure-domain]
modules = ["shop.domain"]  # INW005 reports only in shop.domain and below
```

A [template](../guides/configuration.md#template-rules) can turn an opt-in rule on for one of its roles, such as `router = { async-blocking = true }`; it expands into `extend-select` and the rule's options table, with the role's modules in `modules`.

An options table doesn't turn a rule on. A table for a rule that is off (opt-in and not selected, or listed in `ignore`) does nothing, so `inwards check` reports a warning at the table in `pyproject.toml`, under the rule's code; that lets a team stage a rule's options before turning it on.

To accept one finding for good, put a suppression on the line it points at, with the rule's code and a reason ([ADR-028](../05-ADR.md#adr-028-inline-suppressions-need-a-reason-and-an-agent-cant-add-one-by-default)):

```python title="shop/domain/order.py"
from shop.infrastructure.legacy import LegacyClient  # inwards: ignore[INW001] reason="old billing adapter, removed in #210"
```

Rules that point at a line of Python can be suppressed this way: INW001, INW002, INW003, INW005, INW006, INW010, INW011, INW012, INW013, INW014, INW015, INW016 and the FAPI rules. A suppression without a reason, with an unknown code or with a code that can't be suppressed hides nothing and is reported as [INW009](INW009.md). The Claude Code hooks ignore a suppression the agent added during the session unless `agent-suppressions = "allow"`.

## Page format

Each rule page starts with front matter in the [OKF](https://okf.md/spec/) format: `type: rule`, `title`, `description`, `resource` (the rule's source file), `tags` (the category, parent first), `timestamp` (when the rule shipped), `status`, and the Inwards fields `code`, `name`, `severity`, `suppressible`, `autofix` and `related_issues`. Every page also has the sections What it does, Why is this bad, Example (a flagged and a fixed code block) and Fix safety, and a row in a table on this page. `uv run scripts/check-rule-pages.py` checks all of that in both languages, in CI too, and writes the `rules.json` the list above reads; after changing a rule page or a row here, run it with `--write`. A test checks that every registered rule has a page and every page names a registered rule. The flagged and fixed examples run as tests too, against the output shown on the page.
