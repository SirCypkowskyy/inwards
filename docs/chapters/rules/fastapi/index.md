# FastAPI

The `FAPI` family checks FastAPI applications across files: which router the app includes, which error codes the OpenAPI schema declares ([ADR-037](../../05-ADR.md#adr-037-framework-rule-families-opt-in-with-their-own-prefix)). Every FAPI rule is opt-in, and none reports what Ruff's `FAST` rules already do. On a new project, [`inwards init --style fastapi`](../../guides/install.md#a-new-project-start-from-a-preset) turns them all on as warnings.

<div class="inw-rule-category" markdown>

| Code | Name | What it flags | On |
|---|---|---|---|
| [FAPI001](../FAPI001.md) | `endpoint-metadata` | A path operation without the OpenAPI metadata the project requires (summary, response model, status code) | opt-in |
| [FAPI002](../FAPI002.md) | `undocumented-error-response` | A path operation that can produce an error status code (raised directly, in a helper or dependency, or through an app's exception handler) its `responses=` doesn't declare | opt-in |
| [FAPI003](../FAPI003.md) | `router-wiring` | An `APIRouter` with routes that no app includes, routers that include each other in a cycle, or an `include_router` above the included router's routes | opt-in |
| [FAPI005](../FAPI005.md) | `route-shadowing` | A path operation that an earlier one with the same method already answers: `/users/{id}` above `/users/me`, or the same method and path twice | opt-in |
| [FAPI006](../FAPI006.md) | `lifespan-events` | A deprecated `on_event` handler or `on_startup=` (a warning), and one next to a `lifespan=` that makes FastAPI ignore it (an error) | opt-in |
| [FAPI007](../FAPI007.md) | `yield-dependency-swallows` | A dependency with `yield` whose `except` clause around it doesn't re-raise, so the endpoint's error is hidden | opt-in |
| [FAPI008](../FAPI008.md) | `duplicate-operation-id` | Two path operations of one app with the same literal `operation_id` | opt-in |
| [FAPI009](../FAPI009.md) | `depends-called` | `Depends(get_db())`: the dependency is called at import time instead of being passed | opt-in |

</div>

The [rules index](../index.md) has the rules of every category in one list you can search, filter and sort.
