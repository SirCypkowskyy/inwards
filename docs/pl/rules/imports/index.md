---
source: docs/chapters/rules/imports/index.md
source_hash: 4b8a7497868bd280e35c290b334ef76305ef59e16e96b174c60a3e80c1da1d7e
---

# Importy { #imports }

Co moduł może importować: warstwy wskazują do środka, konteksty importują się nawzajem tylko tak, jak to zadeklarowano, i tylko przez swoje moduły publiczne, bez cykli, bez biblioteki, której zabrania konfiguracja warstwy, bez własnego modułu, który nie istnieje, bez importu dynamicznego, który ukrywa któreś z tych naruszeń, i bez sięgania do modułu prywatnego spoza jego pakietu. Każda reguła z tej kategorii jest domyślnie włączona poza INW021, która jest opt-in.

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
| [INW021](../INW021.md) | `private-module` | Import modułu, którego nazwa zaczyna się od `_`, spoza pakietu, który go zawiera | opt-in |

</div>

[Lista reguł](../index.md) zbiera reguły wszystkich kategorii w jednym miejscu; można ją przeszukiwać, filtrować i sortować.
