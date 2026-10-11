# Imports

What a module may import: layers point inward, contexts import each other only as declared and only through their public modules, no cycles, no library a layer's config denies, no first-party module that doesn't exist, no dynamic import that hides one of these, and no private module reached from outside its package. Every imports rule is on by default except INW021, which is opt-in.

<div class="inw-rule-category" markdown>

| Code | Name | What it flags | On |
|---|---|---|---|
| [INW001](../INW001.md) | `layer-dependency` | An import from an inner layer into an outer one | by default |
| [INW002](../INW002.md) | `context-independence` | An import from one bounded context into another its `depends-on` doesn't declare | by default |
| [INW003](../INW003.md) | `public-api-only` | An import of a context's module that isn't public, from outside the context | by default |
| [INW004](../INW004.md) | `import-cycles` | Modules, or bounded contexts, that import each other in a cycle (whole-project runs) | by default |
| [INW005](../INW005.md) | `pure-domain` | A library import a layer's config doesn't allow, such as SQLAlchemy in the domain | by default |
| [INW010](../INW010.md) | `unknown-first-party` | An import of a first-party module that doesn't exist | by default |
| [INW011](../INW011.md) | `dynamic-import` | A dynamic import that reaches an outer layer, or whose target Inwards can't read | by default |
| [INW021](../INW021.md) | `private-module` | An import of a module whose name starts with `_` from outside the package that holds it | opt-in |

</div>

The [rules index](../index.md) has the rules of every category in one list you can search, filter and sort.
