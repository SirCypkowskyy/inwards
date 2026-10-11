---
source: docs/chapters/rules/integrity/index.md
source_hash: 050cf93c9072aeaafd98e17b9fedd2132fc245b755875484a9319f911419f117
---

# Integralność { #integrity }

Reguły, które pilnują uczciwości samego sprawdzenia: plik, którego zadeklarowane kodowanie może ukryć import, i wyciszenie w linii, które niczego nie ukrywa. Domyślnie włączone; INW000 nie da się wyłączyć.

<div class="inw-rule-category" markdown>

| Kod | Nazwa | Co zgłasza | Włączona |
|---|---|---|---|
| [INW000](../INW000.md) | `unsupported-encoding` | Zadeklarowane kodowanie źródła, w którym komentarz może być prawdziwym importem | domyślnie |
| [INW009](../INW009.md) | `suppression-comment` | Wyciszenie w linii, które niczego nie ukrywa albo nie pasuje do żadnej diagnostyki | domyślnie |

</div>

[Lista reguł](../index.md) zbiera reguły wszystkich kategorii w jednym miejscu; można ją przeszukiwać, filtrować i sortować.
