# Diagrams

Architecture diagrams in the docs, checked against `[tool.inwards]` ([ADR-045](../../05-ADR.md#adr-045-architecture-diagrams-are-checked-against-toolinwards-never-read-as-config)). Opt-in, and warnings, so docs drift doesn't block an agent.

<div class="inw-rule-category" markdown>

| Code | Name | What it flags | On |
|---|---|---|---|
| [INW017](../INW017.md) | `diagram-unknown-name` | A node in a marked Mermaid or PlantUML architecture diagram that names no declared layer or context, or whose quoted label (a PlantUML alias's module) matches no module (whole-project runs) | opt-in |
| [INW018](../INW018.md) | `diagram-forbidden-edge` | A solid arrow in a marked Mermaid or PlantUML architecture diagram that draws an import the config forbids: outward or between sibling layers, between contexts without `depends-on`, or into a module that isn't `public` (whole-project runs) | opt-in |
| [INW019](../INW019.md) | `diagram-missing-dependency` | An import in the code between two layers or contexts a marked Mermaid or PlantUML architecture diagram draws, with no arrow (for layers, no path of arrows) for it (whole-project runs) | opt-in |

</div>

The [rules index](../index.md) has the rules of every category in one list you can search, filter and sort.
