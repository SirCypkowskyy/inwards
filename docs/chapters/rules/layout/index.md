# Layout

Where code lives: every first-party module in a layer, and every package in the shape the config gives it. On by default.

<div class="inw-rule-category" markdown>

| Code | Name | What it flags | On |
|---|---|---|---|
| [INW006](../INW006.md) | `unassigned-module` | First-party code outside every layer, and layer prefixes that match nothing | by default |
| [INW007](../INW007.md) | `package-shape` | A package member its shape doesn't allow, or a name outside the packages it belongs in | by default |
| [INW008](../INW008.md) | `missing-member` | A member a package's shape requires is missing | by default |

</div>

The [rules index](../index.md) has the rules of every category in one list you can search, filter and sort.
