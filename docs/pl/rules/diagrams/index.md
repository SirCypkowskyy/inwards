---
source: docs/chapters/rules/diagrams/index.md
source_hash: 0d3ee9ba3921b34dc3e62eda5b848bc485d753ad7700a646476ccf71d8866179
---

# Diagramy { #diagrams }

Diagramy architektury w dokumentacji, sprawdzane względem `[tool.inwards]` ([ADR-045](../../05-ADR.md#adr-045-architecture-diagrams-are-checked-against-toolinwards-never-read-as-config)). Opt-in i jako ostrzeżenia, żeby rozjazd dokumentacji nie blokował agenta.

<div class="inw-rule-category" markdown>

| Kod | Nazwa | Co zgłasza | Włączona |
|---|---|---|---|
| [INW017](../INW017.md) | `diagram-unknown-name` | Węzeł w oznaczonym diagramie architektury w Mermaid albo PlantUML, który nie nazywa żadnej zadeklarowanej warstwy ani kontekstu, albo którego etykieta w cudzysłowie (moduł aliasu w PlantUML) nie pasuje do żadnego modułu | opt-in |
| [INW018](../INW018.md) | `diagram-forbidden-edge` | Ciągła strzałka w oznaczonym diagramie architektury w Mermaid albo PlantUML, która rysuje import zabroniony przez konfigurację: na zewnątrz albo między warstwami sąsiednimi, między kontekstami bez `depends-on` albo do modułu, który nie jest `public` | opt-in |
| [INW019](../INW019.md) | `diagram-missing-dependency` | Import w kodzie między dwiema warstwami albo kontekstami, które rysuje oznaczony diagram architektury w Mermaid albo PlantUML, bez strzałki (dla warstw: bez ścieżki strzałek), która by go rysowała (sprawdzenie całego projektu) | opt-in |

</div>

[Lista reguł](../index.md) zbiera reguły wszystkich kategorii w jednym miejscu; można ją przeszukiwać, filtrować i sortować.
