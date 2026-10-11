---
source: docs/chapters/rules/imports/index.md
source_hash: 32d96e2a3069320a10e773094405c819c17a14cd446a422d5a078ea330847421
---

# Importy { #imports }

Co moduł może importować: warstwy wskazują do środka, konteksty importują się nawzajem tylko tak, jak to zadeklarowano, i tylko przez swoje moduły publiczne, bez cykli, bez biblioteki, której zabrania konfiguracja warstwy, bez własnego modułu, który nie istnieje, i bez importu dynamicznego, który ukrywa któreś z tych naruszeń. Każda reguła z tej kategorii jest domyślnie włączona.

<div class="inw-rule-category" markdown>

| Kod | Nazwa | Co zgłasza | Włączona |
|---|---|---|---|
| [INW001](../INW001.md) | `layer-dependency` | Import z warstwy wewnętrznej do zewnętrznej | domyślnie |
| [INW002](../INW002.md) | `context-independence` | Import z jednego kontekstu ograniczonego do innego, którego nie deklaruje jego `depends-on` | domyślnie |
| [INW003](../INW003.md) | `public-api-only` | Import niepublicznego modułu kontekstu spoza tego kontekstu | domyślnie |
| [INW004](../INW004.md) | `import-cycles` | Moduły albo konteksty ograniczone, które importują się nawzajem w cyklu (przy sprawdzaniu całego projektu) | domyślnie |
| [INW005](../INW005.md) | `pure-domain` | Import biblioteki, na który konfiguracja warstwy nie pozwala, np. SQLAlchemy w domenie | domyślnie |
| [INW010](../INW010.md) | `unknown-first-party` | Import własnego modułu, który nie istnieje | domyślnie |
| [INW011](../INW011.md) | `dynamic-import` | Import dynamiczny, który sięga do warstwy zewnętrznej albo którego celu Inwards nie umie odczytać | domyślnie |

</div>

[Lista reguł](../index.md) zbiera reguły wszystkich kategorii w jednym miejscu; można ją przeszukiwać, filtrować i sortować.
