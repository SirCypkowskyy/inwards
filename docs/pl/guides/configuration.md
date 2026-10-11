---
source: docs/chapters/guides/configuration.md
source_hash: 02fa21afbb10be937b7079b3eb7edea7ba6af7a6a32d7c25a3c3afda3977a099
---

# Dokumentacja konfiguracji { #configuration-reference }

Inwards czyta tabelę `[tool.inwards]` z najbliższego pliku `pyproject.toml`, idąc w górę od katalogu roboczego, albo z pliku wskazanego przez `--config`. W katalogu głównym workspace'u uv czyta zamiast tego własną tabelę każdego członka ([Monorepo i workspace'y uv](#monorepos)). Ta strona wymienia każdy klucz: jego typ, wartość domyślną i przykład. Rozdział 1 pokazuje [całą konfigurację](../01-Introduction.md#what-inwards-does); [ADR-005](../05-ADR.md#adr-005-configuration-lives-in-pyprojecttoml) wyjaśnia, dlaczego mieszka ona w `pyproject.toml`.

Pełna konfiguracja potrzebuje tylko `layers`:

```toml title="pyproject.toml"
[tool.inwards]
root = "src"
layers = [
  { name = "domain", modules = ["shop.domain"] },
  { name = "application", modules = ["shop.application"] },
  { name = "infrastructure", modules = ["shop.infrastructure"] },
]
```

Nieznany klucz, zły typ albo zła wartość to błąd konfiguracji: `inwards check` kończy się kodem 2 i podaje klucz, na przykład `tool.inwards.contexts[0].depends-on[1]`. Tabela jest chroniona jak kod: strażnik konfiguracji w Claude Code odrzuca edycję agenta w każdym jej kluczu ([rozdział 4](../04-AI-Integration.md#stopping-the-agent-from-gaming-the-check)).

## Podpowiedzi i sprawdzanie w edytorze { #editor-completion }

JSON Schema dla `[tool.inwards]` jest opublikowany pod adresem <https://sircypkowskyy.github.io/inwards/schema/tool-inwards.json>. Ten adres śledzi gałąź `develop`, tak jak ta dokumentacja. Żeby przypiąć schemat do wydania, którego używasz, weź plik `inwards-tool-schema.json` dołączony do każdego [wydania na GitHubie](https://github.com/SirCypkowskyy/inwards/releases).

Edytory, które biorą schemat `pyproject.toml` z [SchemaStore](https://www.schemastore.org/), będą podpowiadać i sprawdzać `[tool.inwards]` bez żadnej konfiguracji, gdy SchemaStore przyjmie schemat Inwards ([SchemaStore#6427](https://github.com/SchemaStore/schemastore/pull/6427), [#192](https://github.com/SirCypkowskyy/inwards/issues/192)). Do tego czasu ustaw go ręcznie.

Edytory korzystające z [Taplo](https://taplo.tamasfe.dev/) (Even Better TOML w VS Code i inne) przypisują schematy do całych plików: Taplo pomija `keys` reguły, gdy wybiera schemat, więc sam schemat tabeli byłby sprawdzany względem całego `pyproject.toml`. Zamiast niego użyj zbudowanego z niego schematu całego pliku, <https://sircypkowskyy.github.io/inwards/schema/pyproject.json>, który sprawdza `[tool.inwards]` i zostawia wszystkie inne tabele w spokoju. Plik `.taplo.toml` obok `pyproject.toml`:

```toml title=".taplo.toml"
[[rule]]
include = ["**/pyproject.toml"]

[rule.schema]
path = "https://sircypkowskyy.github.io/inwards/schema/pyproject.json"
```

To zastępuje schemat, który Taplo wziąłby dla tego pliku z SchemaStore, więc inne tabele nie są sprawdzane. Gdy SchemaStore będzie miał schemat Inwards, usuń tę regułę i zostaw cały plik schematowi SchemaStore. Wydania dołączają go jako `inwards-pyproject-schema.json`.

Schemat sprawdza strukturę: klucze, ich typy, dozwolone wartości, kody reguł i kształt nazw oraz wzorców. Inwards sprawdza więcej, gdy wczytuje konfigurację:

- relacje między wpisami: unikalne nazwy warstw i kontekstów, prefiks w dwóch warstwach albo dwóch kontekstach, wpisy `public` należące do kontekstu, istniejące nazwy w `depends-on`, istniejące nazwy w `template`, rola wymieniona dwa razy;
- dokładne nazwy modułów i segmenty selektorów, tam gdzie schemat dopuszcza nieco luźniejszą postać, oraz zakresy w globach zapisane od końca, takie jak `[z-a]`;
- `required-version` względem uruchomionego programu.

Konfiguracja, którą schemat przyjmuje, może więc nadal być błędna, a komunikat błędu podaje klucz.

## Klucze { #keys }

### `root` { #root }

Typ: tekst. Domyślnie: `"."`.

Katalog, względem `pyproject.toml`, od którego liczone są nazwy modułów. Przy `root = "src"` plik `src/shop/domain/order.py` to moduł `shop.domain.order`.

Jedna konfiguracja ma jeden root. W workspace'ie uv, którego członkowie mają własne `src/` (`src/packages/core/src/core`), daj każdemu członkowi własne `[tool.inwards]`: `inwards check` w katalogu głównym workspace'u sprawdzi wtedy każdego członka jego własną konfiguracją ([Monorepo i workspace'y uv](#monorepos)). Pojedyncza konfiguracja w katalogu głównym workspace'u nazwałaby ten pakiet `packages.core.src.core`, a `import core` w innych członkach przeszedłby jako import biblioteki zewnętrznej, więc `inwards check` ostrzega o każdym członku zindeksowanym w ten sposób ([INW006](../rules/INW006.md)).

### `layers` { #layers }

Typ: tablica tabel, co najmniej jedna. Wymagane.

Warstwy, od najbardziej wewnętrznej. Moduł może importować własną warstwę i każdą wymienioną przed nią; import warstwy wymienionej po niej to INW001. Wpis może też być zagnieżdżoną tablicą [warstw sąsiednich](#sibling-layers). Każda warstwa ma:

- `name`: niepusty tekst, unikalny wśród warstw.
- `modules`: prefiksy modułów i [selektory](#selectors). Prefiks `shop.domain` obejmuje `shop.domain` i wszystko pod nim, ale nie `shop.domainx`. Gdy do modułu pasuje kilka prefiksów, wygrywa najdłuższy, więc zagnieżdżony pakiet może należeć do innej warstwy niż jego rodzic. Ten sam wpis w dwóch warstwach to błąd konfiguracji. Pusta lista jest dozwolona.
- `allow-libraries`, `deny-libraries`, `extend-deny-libraries`: które biblioteki warstwa może importować (INW005). Szczegóły są w [przewodniku o bibliotekach](libraries.md#configure-it).
- `template`: nazwa [szablonu](#templates), którego role stają się warstwami wewnątrz modułów tego wpisu. Sam wpis nie jest wtedy warstwą.

#### Selektory { #selectors }

Wpis z `*` to selektor. Pionowe wycinki powtarzają te same warstwy w każdym wycinku; `shop.*.domain` mówi raz to, czego `shop.orders.domain`, `shop.billing.domain` i każdy kolejny wycinek potrzebowałyby jako osobne prefiksy:

```toml title="pyproject.toml"
[tool.inwards]
layers = [
  { name = "domain", modules = ["shop.*.domain"] },
  { name = "application", modules = ["shop.*.application"] },
  { name = "infrastructure", modules = ["shop.*.infra", "shop.api"] },
]
```

- **Gramatyka.** `*` pasuje do dokładnie jednego segmentu, a `**` do jednego lub więcej, jak w [selektorach kształtu](package-shape.md). Każdy inny segment to nazwa pakietu. Selektor obejmuje każdy moduł równy jednemu z jego dopasowań i wszystko pod nim: `shop.*.domain` obejmuje `shop.orders.domain` i `shop.orders.domain.order`, ale nie `shop.orders` ani `shop.a.b.domain`.
- **Zaczyna się od nazwy pakietu**: `shop.*.domain`, nie `*.domain`. Ten pakiet najwyższego poziomu `inwards check`, Stop gate i serwer języka przechodzą w całości, pomijając tylko ukryte wpisy, więc katalog `node_modules` albo środowiska wirtualnego w jego wnętrzu nie ukryje kodu warstwy. Projekt z kilkoma pakietami najwyższego poziomu wymienia jeden selektor na pakiet.
- **Błędy konfiguracji**: selektor bez nazwy pakietu (`*`, `**`, `*.domain`), częściowa gwiazdka (`shop.dom*`), `?`, nawiasy kwadratowe, puste segmenty i separatory ścieżek. Wpis bez `*` to dosłowny prefiks, sprawdzany tak łagodnie jak dotąd.

Gdy do modułu pasuje kilka wpisów, wygrywa najbardziej szczegółowy, w tej kolejności:

1. najgłębszy ostatni dosłowny segment dopasowania, więc `shop.orders.domain` wygrywa z `shop.**`, który pasuje głębiej, ale jego ostatni dosłowny segment to `shop`;
2. potem głębsze dopasowanie;
3. potem więcej dosłownych segmentów;
4. potem warstwa wymieniona wcześniej.

Dla samych dosłownych prefiksów to po prostu najdłuższy prefiks, jak zawsze. Tabela prawdy, z warstwami `a` i `b` w tej kolejności:

| `a` | `b` | Moduł | Właściciel | Dopasowany prefiks |
|---|---|---|---|---|
| `shop.domain` | | `shop.domainx` | brak | |
| `shop.*.domain` | | `shop.orders.domain.order` | `a` | `shop.orders.domain` |
| `shop.*.domain` | | `shop.a.b.domain` | brak: `*` to jeden segment | |
| `shop.*.domain` | | `shop.orders` | brak: dopasowanie częściowe | |
| `shop.*` | | `shop` | brak: `*` wymaga segmentu | |
| `shop.**` | | `shop.orders.infra.db` | `a` | `shop.orders.infra.db` |
| `shop.**.domain` | | `shop.a.b.domain.order` | `a` | `shop.a.b.domain` |
| `shop.**.domain` | | `shop.domain` | brak: `**` to co najmniej jeden | |
| `shop.orders.domain` | `shop.**` | `shop.orders.domain.order` | `a`: głębszy ostatni dosłowny segment | `shop.orders.domain` |
| `shop.orders.domain` | `shop.**` | `shop.orders.api` | `b` | `shop.orders.api` |
| `shop.orders.*` | `shop.*.domain` | `shop.orders.domain.order` | `b`: głębszy ostatni dosłowny segment | `shop.orders.domain` |
| `shop.orders.*` | `shop.orders.*.*` | `shop.orders.x.y` | `b`: głębsze dopasowanie | `shop.orders.x.y` |
| `shop.*.domain` | `shop.orders.domain` | `shop.orders.domain.order` | `b`: więcej dosłownych segmentów | `shop.orders.domain` |
| `shop.**.domain` | `shop.*.domain` | `shop.orders.domain` | `a`: wymieniona wcześniej | `shop.orders.domain` |
| `shop` | `shop.domain` | `shop.domain.order` | `b`: najdłuższy prefiks | `shop.domain` |

Co zmieniają selektory:

- **Kroki naprawy nazywają wycinek.** INW001, INW005 i INW011 każą agentowi zadeklarować port w dopasowanym prefiksie importującego modułu, `shop.billing.domain` dla pliku z billing, i podpowiadają `shop.billing.domain.ports` tylko wtedy, gdy ten prefiks jest pakietem. Warstwa z kilkoma dosłownymi prefiksami jest traktowana tak samo, więc jej naprawa nazywa teraz prefiks, w którym leży plik, a nie pierwszy prefiks warstwy.
- **INW006 potrzebuje dowodu.** Pakiet zawiera warstwę selektora tylko wtedy, gdy projekt ma pod nim moduł, do którego selektor pasuje: `shop.*.domain` nie włącza `shop/util.py` do warstwy, a `shop.**.domain` nie obejmuje `shop.orders.core.order`. Selektor, do którego nie pasuje żaden moduł, jest martwy niezależnie od pierwszeństwa.
- **Sesje sprawdzają każdy wycinek.** Wycinek to prefiks dopasowanego modułu aż do ostatniego dosłownego segmentu selektora: `shop.orders.domain` dla `shop.*.domain`, `shop` dla `shop.**`. Wycinek, który na starcie sesji miał moduły, a teraz nie ma żadnego, zatrzymuje Stop gate, tak jak dosłowny prefiks. Dlatego zmiana nazwy albo usunięcie wycinka wymaga użytkownika: `git mv shop/orders shop/sales`, przeniesienie wycinka głębiej pod `shop.**.domain` albo usunięcie wycinka, którego jedynym modułem jest `__init__.py`. Usuwanie albo zmiana nazwy modułów wewnątrz wycinka, który zachowuje inne, nie wymaga.

[ADR-034](../05-ADR.md#adr-034-layer-selectors-anchored-in-a-top-level-package-with-slice-aware-session-checks) opisuje projekt.

#### Warstwy sąsiednie { #sibling-layers }

Zagnieżdżona tablica dwóch lub więcej warstw zawiera niezależne warstwy sąsiednie, odpowiednik `a | b` z import-linter. Zajmują jedno miejsce w kolejności: każda może importować warstwy sprzed grupy, warstwy po grupie mogą importować każdą z nich, a żadna nie może importować drugiej. Import z jednej warstwy sąsiedniej do drugiej to INW001, a komunikat mówi wtedy `from sibling layer`:

```toml title="pyproject.toml"
[tool.inwards]
layers = [
  { name = "constants", modules = ["app.constants"] },
  [
    { name = "models", modules = ["app.models"] },
    { name = "schemas", modules = ["app.schemas"] },
  ],
  { name = "service", modules = ["app.service"] },
]
```

Tutaj `app.schemas` może importować `app.constants`, ale nie `app.models`, a `app.service` może importować oba. Dozwolony kierunek w komunikatach brzmi `constants <- models | schemas <- service`. Gdy najbardziej wewnętrzne miejsce zajmują warstwy sąsiednie, każda z nich dostaje domyślną listę zakazów INW005. Warstwa sąsiednia nie może wskazywać szablonu, a grupa z jedną warstwą to błąd konfiguracji. `inwards init --style hexagonal` zapisuje swoje adaptery inbound i outbound jako jedną grupę warstw sąsiednich ([Instalacja](install.md#a-new-project-start-from-a-preset)).

### `required-version` { #required-version }

Typ: tekst, `"MAJOR.MINOR.PATCH"`. Domyślnie: brak.

Najstarsza wersja Inwards, która może sprawdzać projekt. Starszy program kończy się błędem konfiguracji, zamiast sprawdzać regułami, których może nie znać. Ustawia go `inwards init`.

### `ignore` { #ignore }

Typ: lista nazw modułów. Domyślnie: brak.

Moduły pominięte w ostrzeżeniu INW006 o kodzie poza wszystkimi warstwami, na przykład `tests` albo `migrations`. Wpis dopasowuje całe segmenty nazwy w dowolnym miejscu nazwy modułu: `migrations` obejmuje `shop.orders.migrations.0001_initial`, a `tests` obejmuje `shop.tests` tak samo jak `tests` najwyższego poziomu. Wpis zaczynający się od `/` pasuje tylko na początku nazwy: `/tests` obejmuje `tests.test_order`, ale nie `shop.tests.test_order`, które nadal dostaje ostrzeżenie. `inwards init` zapisuje domyślne wpisy bez `/`. Importy z warstwy do pominiętych modułów nadal są sprawdzane.

<!-- config: fragment -->

```toml
[tool.inwards]
ignore = ["/tests", "scripts", "migrations", "conftest"]
```

### `generated` { #generated }

Typ: lista wzorców modułów. Domyślnie: `["*_pb2", "*_pb2_grpc", "_version"]`.

Moduły zapisywane przez krok budowania, które INW010 traktuje jako istniejące, gdy nie ma ich na dysku. Segmenty mogą używać `*` i `?`; wzorzec dopasowuje całe segmenty w dowolnym miejscu nazwy modułu. Lista, nawet pusta, zastępuje wartość domyślną. Szczegóły są w [ADR-029](../05-ADR.md#adr-029-generated-modules-pass-inw010-protoc-and-version-modules-by-default).

<!-- config: fragment -->

```toml
[tool.inwards]
generated = ["*_pb2", "*_pb2_grpc", "_version", "shop.api.gen"]
```

### `namespace-packages` { #namespace-packages }

Typ: lista nazw pakietów. Domyślnie: brak.

Niejawne pakiety przestrzeni nazw (bez `__init__.py`), do których dokładają moduły zainstalowane dystrybucje. Przy `namespace-packages = ["acme.platform"]` [INW010](../rules/INW010.md) nie zgłasza `import acme.platform.auth.tokens`, gdy projekt ma tylko `acme/platform/billing/`: nazwa leżąca bezpośrednio w `acme.platform`, której nie ma w projekcie, pochodzi z dystrybucji. Zmyślony `acme.platform.billing.pricing` jest nadal zgłaszany, bo `billing` jest w projekcie. Takie moduły Inwards sam znajduje w `.venv` projektu; klucz jest dla uruchomień bez niego, na przykład w CI przed `uv sync` ([Pakiety przestrzeni nazw współdzielone z zainstalowanymi dystrybucjami](../rules/INW010.md#installed-namespace-packages)).

<!-- config: fragment -->

```toml
[tool.inwards]
namespace-packages = ["acme.platform"]
```

### `escalate-after` { #escalate-after }

Typ: liczba całkowita, co najmniej 1. Domyślnie: `3`.

Ile prób naprawienia tego samego naruszenia, zanim hooki przestaną blokować i każą agentowi zapytać użytkownika.

### `run-log` { #run-log }

Typ: prawda albo fałsz. Domyślnie: `false`.

Zapisuj opcjonalny dziennik uruchomień `.inwards/runs.jsonl`, opisany w [rozdziale 8](../08-Run-Log.md).

### `stop-gate` { #stop-gate }

Typ: `"changed"` albo `"project"`. Domyślnie: `"changed"`.

Co sprawdza bramka Stop w Claude Code: pliki zmienione w sesji albo cały projekt względem jego baseline'u, tak że naruszenie w pliku, którego sesja nie dotknęła, też blokuje.

### `agent-suppressions` { #agent-suppressions }

Typ: `"deny"` albo `"allow"`. Domyślnie: `"deny"`.

Czy hooki Claude Code uwzględniają komentarz wyciszający, który agent dodał w trakcie sesji. `inwards check` i serwer języka zawsze uwzględniają wyciszenia. Szczegóły są w [ADR-028](../05-ADR.md#adr-028-inline-suppressions-need-a-reason-and-an-agent-cant-add-one-by-default).

### `rules` { #rules }

Typ: tabela. Domyślnie: każda reguła zgłasza z własnym poziomem.

Które reguły zgłaszają i jak głośno:

- `select`: zgłaszają tylko te reguły, także reguły opt-in. Musi zawierać co najmniej jeden kod.
- `extend-select`: te reguły też zgłaszają, obok `select` albo reguł domyślnie włączonych. Włącza [reguły opt-in](../rules/index.md#opt-in-rules).
- `ignore`: te reguły nie zgłaszają. Ma pierwszeństwo przed `select` i `extend-select`.
- `severity`: tabela kodu reguły na `"error"` albo `"warning"`. Wszystkie cztery klucze przyjmują kody reguł, takie jak `"INW001"`. Nazwa reguły w ich miejscu, na przykład `"layer-dependency"`, to błąd konfiguracji, który podaje kod do wpisania.
- `<rule-name>`: tabela opcji tej reguły, na przykład `[tool.inwards.rules.pure-domain]`. Każda reguła przyjmuje `modules`, listę prefiksów modułów albo selektorów zapisanych jak w `modules` warstwy, która ogranicza regułę do pasujących modułów. Niektóre reguły mają też własne opcje, opisane na stronie reguły: [`thin-endpoint`](../rules/INW012.md#configuration), [`async-blocking`](../rules/INW013.md#configuration), [`ports-abstract`](../rules/INW014.md#configuration), [`construct-only-in`](../rules/INW015.md#configuration), [`orm-naming`](../rules/INW016.md#configuration), [`endpoint-metadata`](../rules/FAPI001.md#configuration), [`undocumented-error-response`](../rules/FAPI002.md#configuration) i [`router-wiring`](../rules/FAPI003.md#configuration). Nieznany klucz albo klucz innej reguły to błąd konfiguracji, który go podaje. Tabela nie włącza reguły, a tabela dla reguły wyłączonej dostaje ostrzeżenie. [Szablon](#template-rules) może też włączyć reguły opt-in dla jednej ze swoich ról, co dodaje się do tych tabel.
- `[tool.inwards.rules.pure-domain]` przyjmuje też `deny`, listę tabel z `modules` (prefiksy albo selektory, jak wyżej) i `libraries` (nazwy importu, jak w `deny-libraries` warstwy). Moduły, do których pasuje wpis, nie mogą importować jego bibliotek, niezależnie od tego, czy należą do warstwy, a `allow-libraries` warstwy tego nie znosi ([INW005](../rules/INW005.md), [przewodnik po bibliotekach](libraries.md#prefix-deny)). Służy do pakietu, który nie jest całą warstwą, na przykład do kontraktu import-lintera „`mypackage.one` nie może importować `django`”.

INW000 nie da się wyłączyć, zmienić jego poziomu ani nadać mu opcji. Szczegóły są w [ADR-027](../05-ADR.md#adr-027-per-rule-select-ignore-and-severity-in-a-toolinwardsrules-table).

`inwards rules` pokazuje, co z tej tabeli wynika: każdą regułę z kodem, nazwą, informacją, czy jest włączona, poziomem i kluczem, który o każdym z nich zdecydował, zapisanym jako klucz pod `[tool.inwards]` (`rules.extend-select`, `rules.severity`, `templates.domain.rules.router`), albo `default`. Reguła ograniczona przez `modules` mówi gdzie (`only in src.*.router`). Czyta najbliższą konfigurację albo `--config FILE`, a bez konfiguracji wypisuje ustawienia domyślne. `--json` wypisuje to samo jako `inwards/rules@1`: każda reguła ma `source` i `severitySource`, każde z polem `kind` (`fixed`, `default`, `opt-in`, `select`, `extend-select`, `template`, `ignore`, `not-selected` albo `severity`) i swoimi `keys`. Tak jak `inwards/diagnostics@1` jest to kontrakt: pola są tylko dodawane, a zmiana nazwy albo usunięcie pola wymaga nowej wersji schematu ([ADR-007](../05-ADR.md#adr-007-a-versioned-output-contract-with-fix-steps-as-data)). `inwards rule INW013` wypisuje stronę jednej reguły ([poradnik MCP](mcp.md#explain_rule)).

<!-- config: fragment -->

```toml
[tool.inwards.rules]
ignore = ["INW007", "INW008"]
severity = { INW005 = "warning" }

[tool.inwards.rules.pure-domain]
modules = ["shop"]
deny = [{ modules = ["shop.billing"], libraries = ["django"] }]
```

### `shape` i `names` { #shape }

Typ: tablice tabel. Domyślnie: brak.

Jakie elementy pakiet może, musi i nie może zawierać (INW007, INW008) oraz gdzie może się pojawić nazwa elementu. Obie tabele oraz składnię ich selektorów i wzorców opisuje [przewodnik o kształcie pakietu](package-shape.md). Wpis kształtu może też ustawić `hints`, zdania dodawane do kroków naprawy jego diagnostyk INW007, oraz `template`, [szablon](#templates), który dostarcza `allow`, `require`, `forbid`, `extra` i `hints`; klucz ustawiony przez sam wpis wygrywa.

### `contexts` { #contexts }

Typ: tablica tabel. Domyślnie: brak.

Konteksty ograniczone albo wycinki: co każdy z nich posiada, które z jego modułów mogą importować inne konteksty i od których kontekstów może zależeć. [INW002](../rules/INW002.md) ogranicza każdy kontekst do kontekstów wymienionych w jego `depends-on`; [INW003](../rules/INW003.md) pilnuje, żeby kod spoza kontekstu korzystał tylko z jego modułów `public`.

<!-- config: fragment -->

```toml
[[tool.inwards.contexts]]
name = "orders"
modules = ["shop.orders"]
public = ["shop.orders.api"]
depends-on = ["billing"]

[[tool.inwards.contexts]]
name = "billing"
modules = ["shop.billing"]
public = ["shop.billing.api"]
```

Każdy kontekst ma:

- `name`: niepusty tekst, z rozróżnianiem wielkości liter, unikalny wśród kontekstów.
- `modules`: prefiksy modułów, które kontekst posiada, razem ze wszystkim pod nimi. To dosłowne nazwy z kropkami; gwiazdki są błędem konfiguracji. Gdy do modułu pasują prefiksy kilku kontekstów, wygrywa najdłuższy, więc kolejność tabel nigdy nie ma znaczenia. Ten sam prefiks w dwóch kontekstach to błąd konfiguracji.
- `public` (domyślnie `[]`): prefiksy własnych modułów kontekstu, które mogą importować konteksty od niego zależne. To pełne nazwy modułów, a nie nazwy względne wobec kontekstu: `api` oznacza moduł najwyższego poziomu `api`. Każdy musi należeć do tego kontekstu; prefiks, który dokładniej posiada inny kontekst, to błąd konfiguracji. Moduł jest publiczny, gdy leży na publicznym prefiksie albo pod nim i należy do tego kontekstu. Wpis z wiodącym `=` jest dokładny: `public = ["=shop.billing", "shop.billing.models"]` otwiera fasadę pakietu `shop.billing` (jego `__init__`) oraz `shop.billing.models` ze wszystkim pod nim, ale nie `shop.billing._invoices` ani żadnego innego podmodułu. Moduł po `=` to zwykła nazwa z kropkami i obowiązuje go ta sama zasada przynależności.
- `depends-on` (domyślnie `[]`): konteksty, z których ten może importować. Zależność jest bezpośrednia: nie przechodzi dalej i nie działa w drugą stronę. Nazwa może wskazywać kontekst zadeklarowany niżej. Własna nazwa kontekstu, nieznana nazwa i powtórzona nazwa to błędy konfiguracji.
- `template`: [szablon](#templates), którego nazwy `public`, pod każdym z `modules` kontekstu, dołączają do jego listy `public`.

Konteksty i warstwy się sumują: zadeklarowana zależność ani moduł publiczny nigdy nie pozwalają na import, którego zabrania kolejność warstw, a przynależność do kontekstu nic nie mówi o warstwie ani odwrotnie. Kontekst korzysta tylko ze swoich własnych `depends-on` i `public`, także wtedy, gdy jego prefiksy leżą wewnątrz innego kontekstu. Uzasadnienie jest w [ADR-030](../05-ADR.md#adr-030-bounded-contexts-as-a-contexts-table-of-literal-prefixes).

### `templates` { #templates }

Typ: tabela tabel, `[tool.inwards.templates.<nazwa>]`. Domyślnie: brak.

Szablon raz opisuje, jak wygląda pewien rodzaj pakietu, gdy dzieli go wiele pakietów: każda domena aplikacji FastAPI, każdy wycinek modularnego monolitu. Wpisy warstw, kształtów i kontekstów korzystają z niego przez `template = "<nazwa>"`. Układ [fastapi-best-practices](https://github.com/zhanymkanov/fastapi-best-practices) z domenami `src/orders/` i `src/users/` jako jeden szablon:

```toml title="pyproject.toml"
[tool.inwards]
layers = [
  { name = "core", modules = ["src.config", "src.database", "src.exceptions", "src.models"], deny-libraries = ["fastapi"] },
  { name = "domain", modules = ["src.*"], template = "fastapi-domain" },
  { name = "app", modules = ["src.main"] },
]

# One template says what every domain package looks like, how its modules
# import each other (innermost first; "a | b" are siblings that may not import
# each other), and which modules other domains may import.
[tool.inwards.templates.fastapi-domain]
roles = [
  "constants | config",
  "exceptions | utils",
  "models | schemas",
  "service",
  "dependencies",
  "router",
]
public = ["router", "service", "dependencies", "schemas", "constants", "exceptions"]
allow = []
require = ["__init__", "router", "service"]
hints = ["Other domains may import this one's router, service, dependencies, schemas, constants and exceptions, never its models, config or utils."]

[[tool.inwards.shape]]
packages = ["src.*"]
template = "fastapi-domain"

[[tool.inwards.contexts]]
name = "orders"
modules = ["src.orders"]
depends-on = ["users"]
template = "fastapi-domain"

[[tool.inwards.contexts]]
name = "users"
modules = ["src.users"]
template = "fastapi-domain"
```

Szablon ma te klucze, wszystkie opcjonalne:

- `roles`: nazwy modułów względne wobec modułów wpisu warstwy, od najbardziej wewnętrznej. `"models | schemas"` umieszcza niezależne [warstwy sąsiednie](#sibling-layers) w jednym miejscu. Każda rola występuje raz.
- `public`: nazwy modułów względne wobec modułów kontekstu, które mogą importować inne konteksty ([INW003](../rules/INW003.md)).
- `allow`, `require`, `forbid`, `extra`: jak we [wpisie kształtu](package-shape.md#configure-it). Gdy `allow` jest ustawione, dochodzi do niego pierwszy segment każdej roli, więc `allow = []` oznacza tylko role, `require` i `__init__`.
- `hints`: zdania dodawane do kroków naprawy diagnostyk [INW007](../rules/INW007.md) w pakietach, którym szablon nadaje kształt, na przykład gdzie trafia wspólny kod.
- `rules`: reguły opt-in, które każda rola włącza w swoich modułach, na przykład `router = { async-blocking = true }` ([Reguły dla roli](#template-rules)).

Tam, gdzie ustawiono `template = "<nazwa>"`, oznacza to:

| Gdzie | Rozwija się w |
|---|---|
| wpis `layers` | jedną warstwę na rolę, o nazwie `<wpis>.<rola>`, obejmującą `<moduł>.<rola>` dla każdego z modułów wpisu, z listami bibliotek wpisu; warstwy sąsiednie stają się zagnieżdżoną tablicą. Sam wpis nie jest warstwą. |
| wpis `shape` | `allow`, `require`, `forbid`, `extra` i `hints` szablonu; klucz ustawiony przez wpis wygrywa |
| wpis `contexts` | `<moduł>.<nazwa>` dla każdego z modułów kontekstu i każdej nazwy z `public`, dodane do własnego `public` kontekstu |

W przykładzie wpis `domain` staje się dziewięcioma warstwami, od `domain.constants` do `domain.router`, więc import `src.orders.router` w `src.orders.service` to INW001, tak samo jak import `src.orders.models`, warstwy sąsiedniej, w `src.orders.schemas`. `src.*` obejmuje każdą domenę, także następną. `src.orders.router` może importować `src.users.service`: orders zależy od users, a `service` jest publiczny. Każdy import `src.users.models` z orders to INW003. Routery są publiczne, bo montuje je `src.main`, który nie należy do żadnego kontekstu.

Szablony są rozwijane przy wczytywaniu konfiguracji, zanim cokolwiek innego zostanie sprawdzone, więc reguły, baseline, opis architektury i edytor widzą tylko wynik, który konfiguracja mogłaby też wypisać ręcznie. [Fixture testowy](https://github.com/SirCypkowskyy/inwards/tree/develop/src/cli/test/support/fixtures/templates/fastapi) zawiera tę konfigurację i jej ręczny odpowiednik, a testy sprawdzają, że dają tę samą konfigurację i te same diagnostyki. W praktyce:

- **Komunikaty nazywają warstwy ról**, na przykład `Layer "domain.service" imports "src.orders.router" from outer layer "domain.router"`.
- **Rola, której nie ma żaden pakiet, to pusta warstwa.** Warstwa roli, do której nie pasuje żaden moduł, dostaje błąd INW006 o pustej warstwie jak każda inna warstwa, więc wymieniaj tylko role, które może mieć każdy pakiet danego rodzaju; opcjonalne mogą trafić do `allow`. Błąd wskazuje wpis, który niesie szablon, i nazywa rolę.
- **W modułach wpisu z szablonem używaj `*`, nie `**`.** `src.*` daje `src.*.models`, które pasuje tylko do `models` samej domeny, więc `src/orders/service/models.py` zostaje w roli `service`. Przy `src.**` wzorzec `src.**.models` pasuje też do tego pliku, który przechodzi wtedy do roli `models`, bo wygrywa najgłębszy ostatni dosłowny segment ([Selektory](#selectors)).
- **Błędy konfiguracji nazywają wpis albo klucz szablonu**: `tool.inwards.layers[1].template` dla nieznanego szablonu albo takiego bez ról, `tool.inwards.templates.fastapi-domain.roles[2]` dla błędnej roli. Problem, który widać dopiero po rozwinięciu, na przykład zajęta już nazwa warstwy roli, nazywa rozwiniętą warstwę.

#### Reguły dla roli { #template-rules }

Tabela `rules` szablonu włącza [reguły opt-in](../rules/index.md#opt-in-rules) w modułach jednej roli, więc „każdy router dostaje INW013” mówi się raz, obok ról:

```toml title="pyproject.toml"
[tool.inwards]
layers = [
  { name = "core", modules = ["src.database"] },
  { name = "domain", modules = ["src.*"], template = "domain" },
]

[tool.inwards.templates.domain]
roles = ["models", "service", "router"]

[tool.inwards.templates.domain.rules]
router = { async-blocking = true, thin-endpoint = { max-statements = 8 } }
models = { orm-naming = "warning" }
```

Każdy klucz to rola wymieniona w szablonie (rolę z kropką trzeba wziąć w cudzysłów: `"api.v1"`), a każda wartość wskazuje reguły po ich nazwach w kebab-case. Wartość reguły to `true`, poziom (`"error"` albo `"warning"`) albo tabela opcji reguły bez `modules`. Szablon rozwija się do `[tool.inwards.rules]`, a wynik to to, co napisałbyś ręcznie:

<!-- config: fragment -->

```toml
[tool.inwards.rules]
extend-select = ["INW012", "INW013", "INW016"]
severity = { INW016 = "warning" }

[tool.inwards.rules.async-blocking]
modules = ["src.*.router"]

[tool.inwards.rules.thin-endpoint]
modules = ["src.*.router"]
max-statements = 8

[tool.inwards.rules.orm-naming]
modules = ["src.*.models"]
```

- **Moduły roli** to moduły jej warstwy: `<moduł>.<rola>` dla każdego modułu każdego wpisu `layers`, który korzysta z szablonu. Dołączają do `modules` reguły, więc reguła zgłasza tylko tam. Wyjątkiem jest [INW015](../rules/INW015.md): u niej dołączają do `role`, czyli chronionych modułów, a jej `modules` zostaje takie, jak ustawia tabela najwyższego poziomu.
- **Reguła zostaje włączona**: jej kod dołącza do `extend-select`, za kodami, które już tam są. `ignore` nadal wygrywa.
- **Tabela najwyższego poziomu dodaje się do tego.** Wpisy `modules` z `[tool.inwards.rules.<reguła>]` (albo `role` przy INW015) idą najpierw, potem wpisy ról. Każda inna opcja ustawiona tam oraz poziom w `[tool.inwards.rules] severity` wygrywają z wartością szablonu, tak jak własny klucz wpisu kształtu wygrywa z kluczem jego szablonu. Gdy szablon wskaże regułę, tabela najwyższego poziomu bez `modules` nie oznacza już całego projektu: zakresem reguły są role szablonu i `modules` z tabeli najwyższego poziomu.
- **Jedna wartość na opcję.** Dwie role albo dwa szablony, które dają tej samej regule różne wartości jednej opcji albo różne poziomy, to błąd konfiguracji podający oba miejsca; ustaw wtedy wartość raz w tabeli najwyższego poziomu.
- **Błędy konfiguracji podają klucz**, na przykład `tool.inwards.templates.domain.rules.router.async-blocking.modules`: rola, której szablon nie wymienia, szablon bez `roles`, nieznana reguła albo kod reguły zamiast nazwy, reguła domyślnie włączona (i tak zgłasza wszędzie, więc żeby ją zawęzić, ustaw jej `modules` w tabeli najwyższego poziomu), wartość inna niż `true`, poziom albo tabela, `modules` (albo `role` przy INW015) w tabeli szablonu oraz opcja, której reguła nie przyjmuje. Błędem jest też szablon z `rules`, z którego nie korzysta żaden wpis `layers`, bo do jego ról nie pasuje żaden moduł.

Szablon, z którego nikt nie korzysta, jest dozwolony. Cztery presety zapisują szablon i konteksty za ciebie: `inwards init --style vertical-slices`, `bounded-contexts`, `django` i `fastapi`, ten ostatni jako szablon fastapi-best-practices z przykładu powyżej ([Instalacja](install.md#a-new-project-start-from-a-preset)). [ADR-036](../05-ADR.md#adr-036-package-templates-expand-into-config-a-user-could-write-by-hand) opisuje projekt.

### `cycles` { #cycles }

Typ: lista wartości `"modules"` i `"contexts"`. Domyślnie: `["contexts"]`.

Które cykle importów zgłasza [INW004](../rules/INW004.md) przy sprawdzaniu całego projektu: między kontekstami, między modułami, jedne i drugie albo żadne (`[]`). Wartość domyślna ma znaczenie dopiero wtedy, gdy zadeklarowano `contexts`, więc aktualizacja nie psuje projektu, który żyje z cyklami modułów; dodaj `"modules"`, żeby wyłapywać także je.

<!-- config: fragment -->

```toml
[tool.inwards]
cycles = ["modules", "contexts"]
```

## Monorepo i workspace'y uv { #monorepos }

Inwards idzie za [workspace'ami uv](https://docs.astral.sh/uv/concepts/projects/workspaces/): lista członków mieszka w `[tool.uv.workspace]` w katalogu głównym workspace'u, a każdy członek ma własne `[tool.inwards]` we własnym `pyproject.toml`. Inwards nie ma do tego własnego klucza ([ADR-035](../05-ADR.md#adr-035-inwards-check-follows-uv-workspace-members-each-with-its-own-config)).

```toml
# pyproject.toml w katalogu głównym workspace'u
[tool.uv.workspace]
members = ["packages/*"]
```

```toml
# packages/core/pyproject.toml
[project]
name = "acme-core"

[tool.inwards]
root = "src"
layers = [
  { name = "domain", modules = ["acme.core.domain"] },
  { name = "services", modules = ["acme.core.services"] },
]
```

Bez `--config` `inwards check` wybiera konfiguracje tak:

- **W katalogu głównym workspace'u** (albo w dowolnym katalogu, który zawiera członków) sprawdza każdego członka poniżej, który ma `[tool.inwards]`, jego własną konfiguracją i jego własnym baseline'em. Konfiguracja w samym katalogu głównym workspace'u sprawdza resztę drzewa z pominięciem katalogów tych członków, a członek zagnieżdżony w innym członku zostaje swojej własnej konfiguracji, więc żaden plik nie jest sprawdzany dwa razy. Członek bez `[tool.inwards]` trafia na listę niesprawdzonych, chyba że sprawdza go konfiguracja katalogu głównego. Konfiguracja powyżej katalogu głównego workspace'u należy do innego projektu i nie jest używana.
- **Wewnątrz członka** używa najbliższej konfiguracji, tak jak poza workspace'em.
- **Ze ścieżkami** każda ścieżka trafia do najbliższej konfiguracji nad nią, a katalog zawierający członków z konfiguracją trafia też do każdej z ich konfiguracji. `inwards check packages/api/src packages/core/src/acme/core/domain/order.py` sprawdza pierwszą ścieżkę konfiguracją `packages/api`, a drugą konfiguracją `packages/core`. Workspace jest szukany od każdej ścieżki, więc wynik nie zależy od tego, gdzie uruchomisz polecenie, a członkowie pod wskazanym katalogiem, których nie sprawdza żadna konfiguracja, trafiają na listę niesprawdzonych. Ścieżka bez konfiguracji nad nią jest zgłaszana jako niesprawdzona.
- **`--config`** sprawdza każdą ścieżkę tą jedną konfiguracją, jak dotąd.

Członkowie to `members` minus `exclude`, a `*` pasuje wewnątrz jednego segmentu ścieżki (`packages/*`, `libs/acme_*`); `**`, `?` i klasy znaków nie pasują do niczego.

Wynikiem jest jeden raport: JSON i SARIF to jeden dokument, a ścieżki są względne wobec katalogu roboczego. Wyjście text i concise kończy się wierszem na każdą konfigurację. Kod wyjścia to najgorszy z kodów konfiguracji: 1, gdy którykolwiek członek ma błąd, 2, gdy konfiguracja członka jest niepoprawna (pozostali członkowie są nadal sprawdzani i raportowani), i 2, gdy żadna wskazana ścieżka nie dała pliku do sprawdzenia. Z `--log` każda konfiguracja dostaje własny wiersz we własnym logu uruchomień. [Fixture używany w testach](https://github.com/SirCypkowskyy/inwards/tree/develop/src/cli/test/support/fixtures/workspace), sprawdzony z katalogu głównego:

```text
warning: packages/tools has no [tool.inwards] table, so it was not checked.
All clear: 6 files, 0 violations (114.8 ms).
packages/api/pyproject.toml: 2 files, 0 violations, 0 warnings
packages/core/pyproject.toml: 4 files, 0 violations, 0 warnings
```

Członkowie często współdzielą niejawny pakiet przestrzeni nazw: `packages/core/src/acme/core` i `packages/api/src/acme/api`, bez `acme/__init__.py`. Python scala `acme` z obu członków, a Inwards nazywa moduły tak samo, więc import względny taki jak `from ..core import model` oznacza `acme.core.model` w każdym z nich. Gdy modułu pod takim pakietem brakuje w sprawdzanym członku, [INW010](../rules/INW010.md) szuka go u pozostałych członków (w ich `src/`, a bez niego w katalogu członka) i w `.venv` workspace'u, zanim go zgłosi.

Hooki Claude Code nie potrzebują niczego więcej: każdy edytowany plik jest sprawdzany najbliższą konfiguracją zapisaną na starcie sesji, Stop gate sprawdza każdy zmieniony plik konfiguracją jego członka, a strażnik konfiguracji chroni `[tool.inwards]` i baseline każdego członka. `inwards baseline` nadal bierze jedną konfigurację na uruchomienie: `inwards baseline --config packages/core/pyproject.toml`.
