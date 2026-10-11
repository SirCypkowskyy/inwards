# Integrity

Rules that keep the check itself honest: a file whose declared encoding could hide an import, and an inline suppression that hides nothing. On by default; INW000 can't be turned off.

<div class="inw-rule-category" markdown>

| Code | Name | What it flags | On |
|---|---|---|---|
| [INW000](../INW000.md) | `unsupported-encoding` | A declared source encoding under which a comment can be a real import | by default |
| [INW009](../INW009.md) | `suppression-comment` | An inline suppression that hides nothing, or matches no finding | by default |

</div>

The [rules index](../index.md) has the rules of every category in one list you can search, filter and sort.
