# Roles

What the code inside a role's modules does: endpoints that hand their work on, no blocking calls in `async def`, abstract ports, a single composition root, and ORM names. These rules judge code against choices a team makes, so they are opt-in; a [template](../../guides/configuration.md#template-rules) can turn one on for a role, and so do some presets.

<div class="inw-rule-category" markdown>

| Code | Name | What it flags | On |
|---|---|---|---|
| [INW012](../INW012.md) | `thin-endpoint` | An HTTP endpoint that does the work itself: too many statements, branches or loops, database or HTTP calls of its own, or no call into the layer `delegate-to` names | opt-in |
| [INW013](../INW013.md) | `async-blocking` | A synchronous database, cache or cloud call inside `async def`: a sync SQLAlchemy `Session`, `redis.Redis`, boto3 or a blocking driver | opt-in |
| [INW014](../INW014.md) | `ports-abstract` | A class in a port module that isn't an ABC or a Protocol, or a port method whose body does work | opt-in |
| [INW015](../INW015.md) | `construct-only-in` | A module outside the composition root that imports an outbound adapter, or another guarded role, at runtime, or builds one of its classes | opt-in |
| [INW016](../INW016.md) | `orm-naming` | A table name that isn't lower_case_snake and singular, or a datetime or date column without `_at` or `_date`; a whole-project run also wants a `MetaData` naming convention | opt-in |

</div>

The [rules index](../index.md) has the rules of every category in one list you can search, filter and sort.
