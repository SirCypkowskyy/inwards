---
source: docs/chapters/rules/layout/index.md
source_hash: 942b3a3fbe39187d3e533b728331d3ed3f449c31ab38aedba3e93573967f62b6
---

# Układ { #layout }

Gdzie leży kod: każdy własny moduł w jakiejś warstwie i każdy pakiet w kształcie, który nadaje mu konfiguracja. Domyślnie włączone.

<div class="inw-rule-category" markdown>

| Kod | Nazwa | Co zgłasza | Włączona |
|---|---|---|---|
| [INW006](../INW006.md) | `unassigned-module` | Własny kod poza wszystkimi warstwami i prefiksy warstw, do których nie pasuje żaden moduł | domyślnie |
| [INW007](../INW007.md) | `package-shape` | Element pakietu, na który jego kształt nie pozwala, albo nazwa poza pakietami, do których należy | domyślnie |
| [INW008](../INW008.md) | `missing-member` | Brakuje elementu, którego wymaga kształt pakietu | domyślnie |

</div>

[Lista reguł](../index.md) zbiera reguły wszystkich kategorii w jednym miejscu; można ją przeszukiwać, filtrować i sortować.
