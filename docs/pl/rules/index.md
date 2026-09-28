---
source: docs/chapters/rules/index.md
source_hash: 525984ee584ea65ef036efbab294e6efb44e83cc07df599b8174dcbb6cf83423
---

# :material-format-list-checks: Reguły { #rules }

Każda diagnostyka Inwards linkuje do strony swojej reguły w tej sekcji: linia `docs:` w wyjściu tekstowym, pole `docs` w wyjściu JSON, `helpUri` w SARIF i link przy kodzie w edytorze. Każda strona mówi, co reguła zgłasza, dlaczego ma to znaczenie, gdy kod pisze agent AI, pokazuje przykład zgłoszony i poprawiony, opisuje, jak naprawić diagnostykę i jak skonfigurować regułę, oraz czego reguła jeszcze nie wyłapuje.

| Kod | Nazwa | Co zgłasza | Domyślnie | Wyciszenie w linii |
|---|---|---|---|---|
| [INW000](INW000.md) | `unsupported-encoding` | Zadeklarowane kodowanie źródła, w którym komentarz może być prawdziwym importem | błąd | nie |
| [INW001](INW001.md) | `layer-dependency` | Import z warstwy wewnętrznej do zewnętrznej | błąd | tak |
| [INW002](INW002.md) | `context-independence` | Import z jednego kontekstu ograniczonego do innego, którego nie deklaruje jego `depends-on` | błąd | tak |
| [INW003](INW003.md) | `public-api-only` | Import niepublicznego modułu kontekstu spoza tego kontekstu | błąd | tak |
| [INW004](INW004.md) | `import-cycles` | Moduły albo konteksty ograniczone, które importują się nawzajem w cyklu (przy sprawdzaniu całego projektu) | błąd | nie |
| [INW005](INW005.md) | `pure-domain` | Import biblioteki, na który konfiguracja warstwy nie pozwala, np. SQLAlchemy w domenie | błąd | tak |
| [INW006](INW006.md) | `unassigned-module` | Własny kod poza wszystkimi warstwami i prefiksy warstw, do których nie pasuje żaden moduł | błąd, część diagnostyk to ostrzeżenia | tak |
| [INW007](INW007.md) | `package-shape` | Element pakietu, na który jego kształt nie pozwala, albo nazwa poza pakietami, do których należy | błąd, część diagnostyk to ostrzeżenia | nie |
| [INW008](INW008.md) | `missing-member` | Brakuje elementu, którego wymaga kształt pakietu | błąd | nie |
| [INW009](INW009.md) | `suppression-comment` | Wyciszenie w linii, które niczego nie ukrywa albo nie pasuje do żadnej diagnostyki | błąd, nieużywane to ostrzeżenia | nie |
| [INW010](INW010.md) | `unknown-first-party` | Import własnego modułu, który nie istnieje | błąd | tak |
| [INW011](INW011.md) | `dynamic-import` | Import dynamiczny, który sięga do warstwy zewnętrznej albo którego celu Inwards nie umie odczytać | błąd | tak |

## Reguły FastAPI { #fastapi }

Rodzina `FAPI` sprawdza aplikacje FastAPI między plikami: który router aplikacja dołącza, jakie kody błędów deklaruje schemat OpenAPI ([ADR-037](../05-ADR.md#adr-037-framework-rule-families-opt-in-with-their-own-prefix)). Każda reguła FAPI jest opt-in i żadna nie zgłasza tego, co już zgłaszają reguły `FAST` Ruffa.

| Kod | Nazwa | Co zgłasza | Domyślnie | Wyciszenie w linii |
|---|---|---|---|---|
| [FAPI001](FAPI001.md) | `endpoint-metadata` | Operacja ścieżki bez metadanych OpenAPI, których wymaga projekt (podsumowanie, model odpowiedzi, kod statusu) | opt-in, błąd | tak |
| [FAPI002](FAPI002.md) | `undocumented-error-response` | Operacja ścieżki, która może zwrócić kod błędu (rzucony bezpośrednio, w funkcji pomocniczej albo zależności, albo przez handler wyjątków aplikacji) niezadeklarowany w `responses=` | opt-in, błąd | tak |
| [FAPI003](FAPI003.md) | `router-wiring` | `APIRouter` z trasami, którego nie dołącza żadna aplikacja, routery dołączające się nawzajem w cyklu albo `include_router` nad trasami dołączanego routera | opt-in, błąd | tak |
| [FAPI005](FAPI005.md) | `route-shadowing` | Operacja ścieżki, która nigdy się nie wykona, bo wcześniejsza trasa z tą samą metodą pasuje do jej ścieżki (`/users/{user_id}` przed `/users/me`) albo ma tę samą ścieżkę, na jednym routerze albo między routerami na pełnej ścieżce | opt-in, błąd | tak |
| [FAPI008](FAPI008.md) | `duplicate-operation-id` | Operacja ścieżki, której jawne `operation_id` ma już inna operacja tej samej aplikacji, między routerami i plikami | opt-in, błąd | tak |

Kody zarezerwowane dla kolejnych reguł FastAPI, jeszcze niezarejestrowane (nieznany kod nadal jest błędem konfiguracji):

| Kod | Nazwa | Zgłoszenie | Status |
|---|---|---|---|
| FAPI004 | `unhandled-exception` | [#185](https://github.com/SirCypkowskyy/inwards/issues/185) | nieużywany: przebieg na korpusie w spike'u wypadł na nie (precyzja 3% dla zadeklarowanych klas wyjątków, 4 prawdziwe trafienia w 25 aplikacjach dla zgłaszanych) |
| FAPI006 | `lifespan-events` | [#225](https://github.com/SirCypkowskyy/inwards/issues/225) | planowana |
| FAPI007 | `yield-dependency-swallows` | [#226](https://github.com/SirCypkowskyy/inwards/issues/226) | planowana |
| FAPI009 | `depends-called` | [#228](https://github.com/SirCypkowskyy/inwards/issues/228) | planowana |

[Katalog reguł](../03-Architecture-C4.md#rule-catalogue) w rozdziale 3 wymienia każdą regułę razem z resztą projektu.

## Konfiguracja reguł { #configure-rules }

Tabela `[tool.inwards.rules]` w `pyproject.toml` określa, które reguły zgłaszają i jak głośno ([ADR-027](../05-ADR.md#adr-027-per-rule-select-ignore-and-severity-in-a-toolinwardsrules-table)):

<!-- config: fragment -->

```toml title="pyproject.toml"
[tool.inwards.rules]
ignore = ["INW007", "INW008"]      # these rules never report
severity = { INW005 = "warning" }  # reported, but doesn't fail a check or block the agent
# extend-select = [...]           # turn opt-in rules on, next to the defaults
# select = ["INW001", "INW011"]    # or: only these rules report (default: every rule that is on by default)
```

Kody są dokładne, nie są prefiksami, a nieznany kod to błąd konfiguracji (kod wyjścia 2). `ignore` wygrywa z `select` i `extend-select`. Reguła ustawiona na `"warning"` pojawia się w każdym formacie, ale nie zmienia kodu wyjścia, nie blokuje hooków i nie trafia do baseline'u. INW000 nie da się wyłączyć ani obniżyć. Tabela jest częścią `[tool.inwards]`, więc config guard nie pozwala agentowi jej edytować.

### Reguły opt-in i opcje reguł { #opt-in-rules }

Reguła, która w kolumnie Default ma „opt-in”, nie zgłasza niczego, dopóki jej nie włączysz: wpisz jej kod do `extend-select`, co zostawia pozostałe reguły bez zmian, albo do `select`. Reguły INW są domyślnie włączone; opt-in są reguły, które oceniają kod według progów wybranych przez zespół, oraz rodziny reguł dla frameworków, takie jak [FastAPI](#fastapi). SARIF wymienia regułę opt-in z `defaultConfiguration.enabled` ustawionym na `false`.

Opcje reguły trafiają do tabeli nazwanej jak reguła, `[tool.inwards.rules.<rule-name>]`. Niektóre reguły mają też własne opcje, opisane na ich stronach ([FAPI001](FAPI001.md#configuration), [FAPI002](FAPI002.md#configuration)). Każda reguła przyjmuje `modules`, listę prefiksów modułów albo selektorów zapisanych jak w [`modules` warstwy](../guides/configuration.md#layers) (`shop.domain` obejmuje ten pakiet i wszystko pod nim, `shop.*.api` używa symboli wieloznacznych): reguła zgłasza wtedy tylko w modułach, które pasują. Nieznany klucz albo zły typ to błąd konfiguracji, który podaje nazwę klucza.

<!-- config: fragment -->

```toml title="pyproject.toml"
[tool.inwards.rules.pure-domain]
modules = ["shop.domain"]  # INW005 reports only in shop.domain and below
```

Tabela opcji nie włącza reguły. Tabela dla reguły wyłączonej (opt-in i niewybranej albo wymienionej w `ignore`) nic nie robi, więc `inwards check` zgłasza ostrzeżenie przy tej tabeli w `pyproject.toml`, z kodem reguły. Dzięki temu zespół może przygotować opcje reguły, zanim ją włączy.

Żeby na stałe zaakceptować jedną diagnostykę, dodaj wyciszenie w linii, na którą wskazuje, z kodem reguły i powodem ([ADR-028](../05-ADR.md#adr-028-inline-suppressions-need-a-reason-and-an-agent-cant-add-one-by-default)):

```python title="shop/domain/order.py"
from shop.infrastructure.legacy import LegacyClient  # inwards: ignore[INW001] reason="old billing adapter, removed in #210"
```

W ten sposób można wyciszać reguły, które wskazują na linię kodu Pythona: INW001, INW002, INW003, INW005, INW006, INW010, INW011 oraz reguły FAPI. Wyciszenie bez powodu, z nieznanym kodem albo z kodem, którego nie da się wyciszyć, niczego nie ukrywa i jest zgłaszane jako [INW009](INW009.md). Hooki Claude Code pomijają wyciszenie, które agent dodał w trakcie sesji, chyba że ustawiono `agent-suppressions = "allow"`.

## Format strony { #page-format }

Każda strona reguły zaczyna się od front matter w formacie [OKF](https://okf.md/spec/): `type: rule`, `title`, `description`, `resource` (plik źródłowy reguły), `tags` (kategoria, najpierw nadrzędna), `timestamp` (kiedy reguła trafiła do kodu), `status` oraz pola Inwards `code`, `name`, `severity`, `suppressible`, `autofix` i `related_issues`. Test sprawdza, że każda zarejestrowana reguła ma stronę, a każda strona wskazuje zarejestrowaną regułę. Przykłady zgłoszone i poprawione też działają jako testy, sprawdzane względem wyjścia pokazanego na stronie.
