# :material-format-list-checks: Rules

Every diagnostic Inwards prints links to its rule's page here: the `docs:` line of the text output, the `docs` field of the JSON output, `helpUri` in SARIF and the code link in the editor. Each page says what the rule flags, why it matters when an AI agent writes the code, a flagged and a fixed example, how to fix a finding, how to configure the rule, and what it doesn't catch yet.

| Code | Name | What it flags | Default | Inline suppression |
|---|---|---|---|---|
| [INW000](INW000.md) | `unsupported-encoding` | A declared source encoding under which a comment can be a real import | error | no |
| [INW001](INW001.md) | `layer-dependency` | An import from an inner layer into an outer one | error | yes |
| [INW005](INW005.md) | `pure-domain` | A library import a layer's config doesn't allow, such as SQLAlchemy in the domain | error | yes |
| [INW006](INW006.md) | `unassigned-module` | First-party code outside every layer, and layer prefixes that match nothing | error, some findings warn | yes |
| [INW007](INW007.md) | `package-shape` | A package member its shape doesn't allow, or a name outside the packages it belongs in | error, some findings warn | no |
| [INW008](INW008.md) | `missing-member` | A member a package's shape requires is missing | error | no |
| [INW009](INW009.md) | `suppression-comment` | An inline suppression that hides nothing, or matches no finding | error, unused ones warn | no |
| [INW010](INW010.md) | `unknown-first-party` | An import of a first-party module that doesn't exist | error | yes |
| [INW011](INW011.md) | `dynamic-import` | A dynamic import that reaches an outer layer, or whose target Inwards can't read | error | yes |

The codes INW002 to INW004 are reserved for rules that are planned but not built: context independence ([#52](https://github.com/SirCypkowskyy/inwards/issues/52)), public API only ([#53](https://github.com/SirCypkowskyy/inwards/issues/53)) and import cycles ([#54](https://github.com/SirCypkowskyy/inwards/issues/54)). The [rule catalogue](../03-Architecture-C4.md#rule-catalogue) in chapter 3 lists them with the rest.

## Configure rules

A `[tool.inwards.rules]` table in `pyproject.toml` says which rules report and how loudly ([ADR-027](../05-ADR.md#adr-027-per-rule-select-ignore-and-severity-in-a-toolinwardsrules-table)):

<!-- config: fragment -->

```toml title="pyproject.toml"
[tool.inwards.rules]
ignore = ["INW007", "INW008"]      # these rules never report
severity = { INW005 = "warning" }  # reported, but doesn't fail a check or block the agent
# select = ["INW001", "INW011"]    # or: only these rules report (default: every rule)
```

Codes are exact, not prefixes, and an unknown code is a config error (exit 2). `ignore` wins over `select`. A rule set to `"warning"` shows up in every format but doesn't change the exit code, block the hooks or go into the baseline. INW000 can't be ignored or lowered. The table is part of `[tool.inwards]`, so the config guard stops an agent from editing it.

To accept one finding for good, put a suppression on the line it points at, with the rule's code and a reason ([ADR-028](../05-ADR.md#adr-028-inline-suppressions-need-a-reason-and-an-agent-cant-add-one-by-default)):

```python title="shop/domain/order.py"
from shop.infrastructure.legacy import LegacyClient  # inwards: ignore[INW001] reason="old billing adapter, removed in #210"
```

Rules that point at a line of Python can be suppressed this way: INW001, INW005, INW006, INW010 and INW011. A suppression without a reason, with an unknown code or with a code that can't be suppressed hides nothing and is reported as [INW009](INW009.md). The Claude Code hooks ignore a suppression the agent added during the session unless `agent-suppressions = "allow"`.

## Page format

Each rule page starts with front matter in the [OKF](https://okf.md/spec/) format: `type: rule`, `title`, `description`, `resource` (the rule's source file), `tags` (the category, parent first), `timestamp` (when the rule shipped), `status`, and the Inwards fields `code`, `name`, `severity`, `suppressible`, `autofix` and `related_issues`. A test checks that every registered rule has a page and every page names a registered rule. The flagged and fixed examples run as tests too, against the output shown on the page.
