---
source: docs/chapters/rules/index.md
source_hash: 9212997c66449c13b9e88bb5bb04142f0daf68af9d5571cf443c892308af749b
---

# :material-format-list-checks: Reguły { #rules }

Każda diagnostyka Inwards linkuje do strony swojej reguły w tej sekcji: linia `docs:` w wyjściu tekstowym, pole `docs` w wyjściu JSON, `helpUri` w SARIF i link przy kodzie w edytorze. Każda strona mówi, co reguła zgłasza, dlaczego ma to znaczenie, gdy kod pisze agent AI, pokazuje przykład zgłoszony i poprawiony, opisuje, jak naprawić diagnostykę i jak skonfigurować regułę, oraz czego reguła jeszcze nie wyłapuje.

`inwards rule INW001` wypisuje stronę reguły w terminalu, bez sieci, z pliku binarnego, którego używasz, a `inwards rules` pokazuje, które reguły włącza twoja konfiguracja, z jakim poziomem i dlaczego ([konfiguracja](../guides/configuration.md#rules)).

Przeszukaj reguły, przefiltruj je według kategorii, statusu albo poprawki automatycznej, posortuj według kodu, nazwy, kategorii albo statusu i przeglądaj je stronami. Pasek adresu zapamiętuje widok, więc link otwiera tę samą listę. Kategoria obejmuje swoje podkategorie: `imports` pokazuje też reguły z `imports › layers`.

Reguły dzielą się na sześć kategorii, opisanych niżej w tej kolejności: [importy](#imports), [układ](#layout), [role](#roles), [integralność](#integrity), [diagramy](#diagrams) i [FastAPI](#fastapi). Każda kategoria ma też własną stronę, a nawigacja pokazuje pod nią jej reguły: [importy](imports/index.md), [układ](layout/index.md), [role](roles/index.md), [integralność](integrity/index.md), [diagramy](diagrams/index.md) i [FastAPI](fastapi/index.md). Reguła jest albo domyślnie włączona, albo [opt-in](#opt-in-rules). Presety [`inwards init --style`](../guides/install.md#a-new-project-start-from-a-preset) zostawiają każdą domyślnie włączoną regułę, tylko django i fastapi wyłączają INW002, i włączają niektóre reguły opt-in jako ostrzeżenia: INW014 i INW015 w clean i hexagonal, INW012, INW013, INW016 i reguły FAPI w fastapi.

<div class="inw-rules" data-inwards-rules="rules.json"></div>

## Importy { #imports }

Co moduł może importować: warstwy wskazują do środka, konteksty importują się nawzajem tylko tak, jak to zadeklarowano, i tylko przez swoje moduły publiczne, bez cykli, bez biblioteki, której zabrania konfiguracja warstwy, bez własnego modułu, który nie istnieje, i bez importu dynamicznego, który ukrywa któreś z tych naruszeń. Każda reguła z tej kategorii jest domyślnie włączona.

<div class="inw-rules-fallback" markdown>

| Kod | Nazwa | Co zgłasza | Włączona | Poziom | Włącza ją preset | Wyciszenie w linii |
|---|---|---|---|---|---|---|
| [INW001](INW001.md) | `layer-dependency` | Import z warstwy wewnętrznej do zewnętrznej | domyślnie | błąd | wszystkie | tak |
| [INW002](INW002.md) | `context-independence` | Import z jednego kontekstu ograniczonego do innego, którego nie deklaruje jego `depends-on` | domyślnie | błąd | wszystkie oprócz django, fastapi | tak |
| [INW003](INW003.md) | `public-api-only` | Import niepublicznego modułu kontekstu spoza tego kontekstu | domyślnie | błąd | wszystkie | tak |
| [INW004](INW004.md) | `import-cycles` | Moduły albo konteksty ograniczone, które importują się nawzajem w cyklu (przy sprawdzaniu całego projektu) | domyślnie | błąd | wszystkie | nie |
| [INW005](INW005.md) | `pure-domain` | Import biblioteki, na który konfiguracja warstwy nie pozwala, np. SQLAlchemy w domenie | domyślnie | błąd | wszystkie | tak |
| [INW010](INW010.md) | `unknown-first-party` | Import własnego modułu, który nie istnieje | domyślnie | błąd | wszystkie | tak |
| [INW011](INW011.md) | `dynamic-import` | Import dynamiczny, który sięga do warstwy zewnętrznej albo którego celu Inwards nie umie odczytać | domyślnie | błąd | wszystkie | tak |

</div>

## Układ { #layout }

Gdzie leży kod: każdy własny moduł w jakiejś warstwie i każdy pakiet w kształcie, który nadaje mu konfiguracja. Domyślnie włączone.

<div class="inw-rules-fallback" markdown>

| Kod | Nazwa | Co zgłasza | Włączona | Poziom | Włącza ją preset | Wyciszenie w linii |
|---|---|---|---|---|---|---|
| [INW006](INW006.md) | `unassigned-module` | Własny kod poza wszystkimi warstwami i prefiksy warstw, do których nie pasuje żaden moduł | domyślnie | błąd, część diagnostyk to ostrzeżenia | wszystkie | tak |
| [INW007](INW007.md) | `package-shape` | Element pakietu, na który jego kształt nie pozwala, albo nazwa poza pakietami, do których należy | domyślnie | błąd, część diagnostyk to ostrzeżenia | wszystkie | nie |
| [INW008](INW008.md) | `missing-member` | Brakuje elementu, którego wymaga kształt pakietu | domyślnie | błąd | wszystkie | nie |

</div>

## Role { #roles }

Co robi kod w modułach danej roli: endpointy przekazują pracę dalej, w `async def` nie ma blokujących wywołań, porty są abstrakcyjne, jest jeden korzeń kompozycji, nazwy ORM trzymają konwencję. Te reguły oceniają kod według wyborów zespołu, więc są opt-in; [szablon](../guides/configuration.md#template-rules) może włączyć regułę dla roli, a niektóre presety też je włączają.

<div class="inw-rules-fallback" markdown>

| Kod | Nazwa | Co zgłasza | Włączona | Poziom | Włącza ją preset | Wyciszenie w linii |
|---|---|---|---|---|---|---|
| [INW012](INW012.md) | `thin-endpoint` | Endpoint HTTP, który sam wykonuje pracę: za dużo instrukcji, gałęzi albo pętli, własne wywołania bazy danych albo HTTP, albo brak wywołania warstwy, którą wskazuje `delegate-to` | opt-in | ostrzeżenie | fastapi | tak |
| [INW013](INW013.md) | `async-blocking` | Synchroniczne wywołanie bazy danych, cache'u albo chmury wewnątrz `async def`: synchroniczny `Session` SQLAlchemy, `redis.Redis`, boto3 albo blokujący sterownik | opt-in | błąd | fastapi | tak |
| [INW014](INW014.md) | `ports-abstract` | Klasa w module portu, która nie jest ABC ani Protocol, albo metoda portu, której ciało wykonuje pracę | opt-in | błąd | clean, hexagonal | tak |
| [INW015](INW015.md) | `construct-only-in` | Moduł spoza korzenia kompozycji, który w czasie działania importuje adapter wyjściowy albo inną chronioną rolę lub buduje jedną z jej klas | opt-in | błąd | clean, hexagonal | tak |
| [INW016](INW016.md) | `orm-naming` | Nazwa tabeli, która nie jest w lower_case_snake i w liczbie pojedynczej, albo kolumna daty i czasu bez `_at` lub `_date`; uruchomienie dla całego projektu wymaga też konwencji nazw w `MetaData` | opt-in | błąd | fastapi | tak |

</div>

## Integralność { #integrity }

Reguły, które pilnują uczciwości samego sprawdzenia: plik, którego zadeklarowane kodowanie może ukryć import, i wyciszenie w linii, które niczego nie ukrywa. Domyślnie włączone; INW000 nie da się wyłączyć.

<div class="inw-rules-fallback" markdown>

| Kod | Nazwa | Co zgłasza | Włączona | Poziom | Włącza ją preset | Wyciszenie w linii |
|---|---|---|---|---|---|---|
| [INW000](INW000.md) | `unsupported-encoding` | Zadeklarowane kodowanie źródła, w którym komentarz może być prawdziwym importem | domyślnie | błąd | wszystkie | nie |
| [INW009](INW009.md) | `suppression-comment` | Wyciszenie w linii, które niczego nie ukrywa albo nie pasuje do żadnej diagnostyki | domyślnie | błąd, nieużywane to ostrzeżenia | wszystkie | nie |

</div>

## Diagramy { #diagrams }

Diagramy architektury w dokumentacji, sprawdzane względem `[tool.inwards]` ([ADR-045](../05-ADR.md#adr-045-architecture-diagrams-are-checked-against-toolinwards-never-read-as-config)). Opt-in i jako ostrzeżenia, żeby rozjazd dokumentacji nie blokował agenta.

<div class="inw-rules-fallback" markdown>

| Kod | Nazwa | Co zgłasza | Włączona | Poziom | Włącza ją preset | Wyciszenie w linii |
|---|---|---|---|---|---|---|
| [INW017](INW017.md) | `diagram-unknown-name` | Węzeł w oznaczonym diagramie architektury w Mermaid albo PlantUML, który nie nazywa żadnej zadeklarowanej warstwy ani kontekstu, albo którego etykieta w cudzysłowie (moduł aliasu w PlantUML) nie pasuje do żadnego modułu (sprawdzenie całego projektu) | opt-in | ostrzeżenie | żaden | nie |
| [INW018](INW018.md) | `diagram-forbidden-edge` | Ciągła strzałka w oznaczonym diagramie architektury w Mermaid albo PlantUML, która rysuje import zabroniony przez konfigurację: na zewnątrz albo między warstwami sąsiednimi, między kontekstami bez `depends-on` albo do modułu, który nie jest `public` (sprawdzenie całego projektu) | opt-in | ostrzeżenie | żaden | nie |
| [INW019](INW019.md) | `diagram-missing-dependency` | Import w kodzie między dwiema warstwami albo kontekstami, które rysuje oznaczony diagram architektury w Mermaid albo PlantUML, bez strzałki (dla warstw: bez ścieżki strzałek), która by go rysowała (sprawdzenie całego projektu) | opt-in | ostrzeżenie | żaden | nie |

</div>

## Reguły FastAPI { #fastapi }

Rodzina `FAPI` sprawdza aplikacje FastAPI między plikami: który router aplikacja dołącza, jakie kody błędów deklaruje schemat OpenAPI ([ADR-037](../05-ADR.md#adr-037-framework-rule-families-opt-in-with-their-own-prefix)). Każda reguła FAPI jest opt-in i żadna nie zgłasza tego, co już zgłaszają reguły `FAST` Ruffa. W nowym projekcie [`inwards init --style fastapi`](../guides/install.md#a-new-project-start-from-a-preset) włącza je wszystkie jako ostrzeżenia.

<div class="inw-rules-fallback" markdown>

| Kod | Nazwa | Co zgłasza | Włączona | Poziom | Włącza ją preset | Wyciszenie w linii |
|---|---|---|---|---|---|---|
| [FAPI001](FAPI001.md) | `endpoint-metadata` | Operacja ścieżki bez metadanych OpenAPI, których wymaga projekt (podsumowanie, model odpowiedzi, kod statusu) | opt-in | błąd | fastapi | tak |
| [FAPI002](FAPI002.md) | `undocumented-error-response` | Operacja ścieżki, która może zwrócić kod błędu (rzucony bezpośrednio, w funkcji pomocniczej albo zależności, albo przez handler wyjątków aplikacji) niezadeklarowany w `responses=` | opt-in | błąd | fastapi | tak |
| [FAPI003](FAPI003.md) | `router-wiring` | `APIRouter` z trasami, którego nie dołącza żadna aplikacja, routery dołączające się nawzajem w cyklu albo `include_router` nad trasami dołączanego routera | opt-in | błąd | fastapi | tak |
| [FAPI005](FAPI005.md) | `route-shadowing` | Operacja ścieżki, na którą wcześniejsza z tą samą metodą już odpowiada: `/users/{id}` nad `/users/me` albo ta sama metoda i ścieżka dwa razy | opt-in | błąd | fastapi | tak |
| [FAPI006](FAPI006.md) | `lifespan-events` | Przestarzały handler `on_event` albo `on_startup=` (ostrzeżenie) oraz taki obok `lifespan=`, przez który FastAPI go pomija (błąd) | opt-in | błąd | fastapi | tak |
| [FAPI007](FAPI007.md) | `yield-dependency-swallows` | Zależność z `yield`, której klauzula `except` wokół niego nie rzuca wyjątku ponownie, więc błąd endpointu jest ukryty | opt-in | błąd | fastapi | tak |
| [FAPI008](FAPI008.md) | `duplicate-operation-id` | Dwie operacje ścieżki jednej aplikacji z tym samym literalnym `operation_id` | opt-in | błąd | fastapi | tak |
| [FAPI009](FAPI009.md) | `depends-called` | `Depends(get_db())`: zależność jest wywoływana przy imporcie zamiast zostać przekazana | opt-in | błąd | fastapi | tak |

</div>

Jeden kod jest zarezerwowany i niezarejestrowany (nieznany kod nadal jest błędem konfiguracji):

| Kod | Nazwa | Zgłoszenie | Status |
|---|---|---|---|
| FAPI004 | `unhandled-exception` | [#185](https://github.com/SirCypkowskyy/inwards/issues/185) | nieużywany: przebieg na korpusie w spike'u wypadł na nie (precyzja 3% dla zadeklarowanych klas wyjątków, 4 prawdziwe trafienia w 25 aplikacjach dla zgłaszanych) |

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

Reguła, która w kolumnie Włączona ma „opt-in”, nie zgłasza niczego, dopóki jej nie włączysz: wpisz jej kod do `extend-select`, co zostawia pozostałe reguły bez zmian, albo do `select`. Reguły INW są domyślnie włączone, poza [INW012](INW012.md), [INW013](INW013.md), [INW014](INW014.md), [INW015](INW015.md), [INW016](INW016.md), [INW017](INW017.md), [INW018](INW018.md) i [INW019](INW019.md); opt-in są reguły, które oceniają kod według progów wybranych przez zespół, takie jak INW012, reguły, które oceniają zawartość modułów danej roli, takie jak INW013, INW015 i INW016, reguły, które sprawdzają dokumentację względem konfiguracji i kodu, INW017, INW018 i INW019, oraz rodziny reguł dla frameworków, takie jak [FastAPI](#fastapi). SARIF wymienia regułę opt-in z `defaultConfiguration.enabled` ustawionym na `false`.

Opcje reguły trafiają do tabeli nazwanej jak reguła, `[tool.inwards.rules.<rule-name>]`. Niektóre reguły mają też własne opcje, opisane na ich stronach ([INW012](INW012.md#configuration), [INW013](INW013.md#configuration), [INW014](INW014.md#configuration), [INW015](INW015.md#configuration), [INW016](INW016.md#configuration), [FAPI001](FAPI001.md#configuration), [FAPI002](FAPI002.md#configuration)). Każda reguła przyjmuje `modules`, listę prefiksów modułów albo selektorów zapisanych jak w [`modules` warstwy](../guides/configuration.md#layers) (`shop.domain` obejmuje ten pakiet i wszystko pod nim, `shop.*.api` używa symboli wieloznacznych): reguła zgłasza wtedy tylko w modułach, które pasują. Nieznany klucz albo zły typ to błąd konfiguracji, który podaje nazwę klucza.

<!-- config: fragment -->

```toml title="pyproject.toml"
[tool.inwards.rules.pure-domain]
modules = ["shop.domain"]  # INW005 reports only in shop.domain and below
```

[Szablon](../guides/configuration.md#template-rules) może włączyć regułę opt-in dla jednej ze swoich ról, na przykład `router = { async-blocking = true }`; rozwija się to do `extend-select` i tabeli opcji reguły, z modułami roli w `modules`.

Tabela opcji nie włącza reguły. Tabela dla reguły wyłączonej (opt-in i niewybranej albo wymienionej w `ignore`) nic nie robi, więc `inwards check` zgłasza ostrzeżenie przy tej tabeli w `pyproject.toml`, z kodem reguły. Dzięki temu zespół może przygotować opcje reguły, zanim ją włączy.

Żeby na stałe zaakceptować jedną diagnostykę, dodaj wyciszenie w linii, na którą wskazuje, z kodem reguły i powodem ([ADR-028](../05-ADR.md#adr-028-inline-suppressions-need-a-reason-and-an-agent-cant-add-one-by-default)):

```python title="shop/domain/order.py"
from shop.infrastructure.legacy import LegacyClient  # inwards: ignore[INW001] reason="old billing adapter, removed in #210"
```

W ten sposób można wyciszać reguły, które wskazują na linię kodu Pythona: INW001, INW002, INW003, INW005, INW006, INW010, INW011, INW012, INW013, INW014, INW015, INW016 oraz reguły FAPI. Wyciszenie bez powodu, z nieznanym kodem albo z kodem, którego nie da się wyciszyć, niczego nie ukrywa i jest zgłaszane jako [INW009](INW009.md). Hooki Claude Code pomijają wyciszenie, które agent dodał w trakcie sesji, chyba że ustawiono `agent-suppressions = "allow"`.

## Format strony { #page-format }

Każda strona reguły zaczyna się od front matter w formacie [OKF](https://okf.md/spec/): `type: rule`, `title`, `description`, `resource` (plik źródłowy reguły), `tags` (kategoria, najpierw nadrzędna), `timestamp` (kiedy reguła trafiła do kodu), `status` oraz pola Inwards `code`, `name`, `severity`, `suppressible`, `autofix` i `related_issues`. Każda strona ma też sekcje Co robi, Dlaczego to źle, Przykład (zgłoszony i poprawiony blok kodu) i Bezpieczeństwo poprawki oraz wiersz w tabeli na tej stronie i na stronie swojej kategorii (`rules/<category>/`), a także wpis w grupie swojej kategorii w nawigacji, w `docs/zensical.toml` i `docs/zensical.pl.toml`. `uv run scripts/check-rule-pages.py` sprawdza to wszystko w obu językach, także w CI, i zapisuje plik `rules.json`, z którego czyta lista powyżej; po zmianie strony reguły albo wiersza tutaj uruchom go z `--write`. Test sprawdza, że każda zarejestrowana reguła ma stronę, a każda strona wskazuje zarejestrowaną regułę. Przykłady zgłoszone i poprawione też działają jako testy, sprawdzane względem wyjścia pokazanego na stronie.
