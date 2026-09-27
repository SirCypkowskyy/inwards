---
source: docs/chapters/rules/index.md
source_hash: a3cd4b80fb7feb313be49bf6e8245f8ec0ade2ef42187c310ce5fd205247350e
---

# :material-format-list-checks: Reguły { #rules }

Każda diagnostyka Inwards linkuje do strony swojej reguły w tej sekcji: linia `docs:` w wyjściu tekstowym, pole `docs` w wyjściu JSON, `helpUri` w SARIF i link przy kodzie w edytorze. Każda strona mówi, co reguła zgłasza, dlaczego ma to znaczenie, gdy kod pisze agent AI, pokazuje przykład zgłoszony i poprawiony, opisuje, jak naprawić diagnostykę i jak skonfigurować regułę, oraz czego reguła jeszcze nie wyłapuje.

| Kod | Nazwa | Co zgłasza | Domyślnie | Wyciszenie w linii |
|---|---|---|---|---|
| [INW000](INW000.md) | `unsupported-encoding` | Zadeklarowane kodowanie źródła, w którym komentarz może być prawdziwym importem | błąd | nie |
| [INW001](INW001.md) | `layer-dependency` | Import z warstwy wewnętrznej do zewnętrznej | błąd | tak |
| [INW005](INW005.md) | `pure-domain` | Import biblioteki, na który konfiguracja warstwy nie pozwala, np. SQLAlchemy w domenie | błąd | tak |
| [INW006](INW006.md) | `unassigned-module` | Własny kod poza wszystkimi warstwami i prefiksy warstw, do których nie pasuje żaden moduł | błąd, część diagnostyk to ostrzeżenia | tak |
| [INW007](INW007.md) | `package-shape` | Element pakietu, na który jego kształt nie pozwala, albo nazwa poza pakietami, do których należy | błąd, część diagnostyk to ostrzeżenia | nie |
| [INW008](INW008.md) | `missing-member` | Brakuje elementu, którego wymaga kształt pakietu | błąd | nie |
| [INW009](INW009.md) | `suppression-comment` | Wyciszenie w linii, które niczego nie ukrywa albo nie pasuje do żadnej diagnostyki | błąd, nieużywane to ostrzeżenia | nie |
| [INW010](INW010.md) | `unknown-first-party` | Import własnego modułu, który nie istnieje | błąd | tak |
| [INW011](INW011.md) | `dynamic-import` | Import dynamiczny, który sięga do warstwy zewnętrznej albo którego celu Inwards nie umie odczytać | błąd | tak |

Kody od INW002 do INW004 są zarezerwowane dla reguł zaplanowanych, ale jeszcze niezbudowanych: niezależności kontekstów ([#52](https://github.com/SirCypkowskyy/inwards/issues/52)), wyłącznie publicznego API ([#53](https://github.com/SirCypkowskyy/inwards/issues/53)) i cykli importów ([#54](https://github.com/SirCypkowskyy/inwards/issues/54)). [Katalog reguł](../03-Architecture-C4.md#rule-catalogue) w rozdziale 3 wymienia je razem z resztą.

## Konfiguracja reguł { #configure-rules }

Tabela `[tool.inwards.rules]` w `pyproject.toml` określa, które reguły zgłaszają i jak głośno ([ADR-027](../05-ADR.md#adr-027-per-rule-select-ignore-and-severity-in-a-toolinwardsrules-table)):

```toml title="pyproject.toml"
[tool.inwards.rules]
ignore = ["INW007", "INW008"]      # these rules never report
severity = { INW005 = "warning" }  # reported, but doesn't fail a check or block the agent
# select = ["INW001", "INW011"]    # or: only these rules report (default: every rule)
```

Kody są dokładne, nie są prefiksami, a nieznany kod to błąd konfiguracji (kod wyjścia 2). `ignore` wygrywa z `select`. Reguła ustawiona na `"warning"` pojawia się w każdym formacie, ale nie zmienia kodu wyjścia, nie blokuje hooków i nie trafia do baseline'u. INW000 nie da się wyłączyć ani obniżyć. Tabela jest częścią `[tool.inwards]`, więc config guard nie pozwala agentowi jej edytować.

Żeby na stałe zaakceptować jedną diagnostykę, dodaj wyciszenie w linii, na którą wskazuje, z kodem reguły i powodem ([ADR-028](../05-ADR.md#adr-028-inline-suppressions-need-a-reason-and-an-agent-cant-add-one-by-default)):

```python title="shop/domain/order.py"
from shop.infrastructure.legacy import LegacyClient  # inwards: ignore[INW001] reason="old billing adapter, removed in #210"
```

W ten sposób można wyciszać reguły, które wskazują na linię kodu Pythona: INW001, INW005, INW006, INW010 i INW011. Wyciszenie bez powodu, z nieznanym kodem albo z kodem, którego nie da się wyciszyć, niczego nie ukrywa i jest zgłaszane jako [INW009](INW009.md). Hooki Claude Code pomijają wyciszenie, które agent dodał w trakcie sesji, chyba że ustawiono `agent-suppressions = "allow"`.

## Format strony { #page-format }

Każda strona reguły zaczyna się od front matter w formacie [OKF](https://okf.md/spec/): `type: rule`, `title`, `description`, `resource` (plik źródłowy reguły), `tags` (kategoria, najpierw nadrzędna), `timestamp` (kiedy reguła trafiła do kodu), `status` oraz pola Inwards `code`, `name`, `severity`, `suppressible`, `autofix` i `related_issues`. Test sprawdza, że każda zarejestrowana reguła ma stronę, a każda strona wskazuje zarejestrowaną regułę. Przykłady zgłoszone i poprawione też działają jako testy, sprawdzane względem wyjścia pokazanego na stronie.
