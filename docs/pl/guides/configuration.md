---
source: docs/chapters/guides/configuration.md
source_hash: e976c612361fb991e426279cc3be37774ddafec4e11833a3daac73f191f17f38
---

# Dokumentacja konfiguracji { #configuration-reference }

Inwards czyta tabelę `[tool.inwards]` z najbliższego pliku `pyproject.toml`, idąc w górę od katalogu roboczego, albo z pliku wskazanego przez `--config`. Ta strona wymienia każdy klucz: jego typ, wartość domyślną i przykład. Rozdział 1 pokazuje [całą konfigurację](../01-Introduction.md#what-inwards-does); [ADR-005](../05-ADR.md#adr-005-configuration-lives-in-pyprojecttoml) wyjaśnia, dlaczego mieszka ona w `pyproject.toml`.

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

Edytory korzystające z [Taplo](https://taplo.tamasfe.dev/) (Even Better TOML w VS Code i inne) przypisują schematy do całych plików: Taplo pomija `keys` reguły, gdy wybiera schemat, więc sam schemat tabeli byłby sprawdzany względem całego `pyproject.toml`. Zamiast niego użyj zbudowanego z niego schematu całego pliku, <https://sircypkowskyy.github.io/inwards/schema/pyproject.json>, który sprawdza `[tool.inwards]` i zostawia wszystkie inne tabele w spokoju. Plik `.taplo.toml` obok `pyproject.toml`:

```toml title=".taplo.toml"
[[rule]]
include = ["**/pyproject.toml"]

[rule.schema]
path = "https://sircypkowskyy.github.io/inwards/schema/pyproject.json"
```

To zastępuje schemat, który Taplo wziąłby dla tego pliku z SchemaStore, więc inne tabele nie są sprawdzane, dopóki schemat Inwards nie trafi do schematu SchemaStore ([#192](https://github.com/SirCypkowskyy/inwards/issues/192)). Wydania dołączają go jako `inwards-pyproject-schema.json`.

Schemat sprawdza strukturę: klucze, ich typy, dozwolone wartości, kody reguł i kształt nazw oraz wzorców. Inwards sprawdza więcej, gdy wczytuje konfigurację:

- relacje między wpisami: unikalne nazwy warstw i kontekstów, prefiks w dwóch warstwach albo dwóch kontekstach, wpisy `public` należące do kontekstu, istniejące nazwy w `depends-on`;
- dokładne nazwy modułów, tam gdzie schemat dopuszcza nieco luźniejszą postać, oraz zakresy w globach zapisane od końca, takie jak `[z-a]`;
- `required-version` względem uruchomionego programu.

Konfiguracja, którą schemat przyjmuje, może więc nadal być błędna, a komunikat błędu podaje klucz.

## Klucze { #keys }

### `root` { #root }

Typ: tekst. Domyślnie: `"."`.

Katalog, względem `pyproject.toml`, od którego liczone są nazwy modułów. Przy `root = "src"` plik `src/shop/domain/order.py` to moduł `shop.domain.order`.

### `layers` { #layers }

Typ: tablica tabel, co najmniej jedna. Wymagane.

Warstwy, od najbardziej wewnętrznej. Moduł może importować własną warstwę i każdą wymienioną przed nią; import warstwy wymienionej po niej to INW001. Każda warstwa ma:

- `name`: niepusty tekst, unikalny wśród warstw.
- `modules`: prefiksy modułów. `shop.domain` obejmuje `shop.domain` i wszystko pod nim, ale nie `shop.domainx`. Gdy do modułu pasuje kilka prefiksów, wygrywa najdłuższy, więc zagnieżdżony pakiet może należeć do innej warstwy niż jego rodzic. Ten sam prefiks w dwóch warstwach to błąd konfiguracji.
- `allow-libraries`, `deny-libraries`, `extend-deny-libraries`: które biblioteki warstwa może importować (INW005). Szczegóły są w [przewodniku o bibliotekach](libraries.md#configure-it).

### `required-version` { #required-version }

Typ: tekst, `"MAJOR.MINOR.PATCH"`. Domyślnie: brak.

Najstarsza wersja Inwards, która może sprawdzać projekt. Starszy program kończy się błędem konfiguracji, zamiast sprawdzać regułami, których może nie znać. Ustawia go `inwards init`.

### `ignore` { #ignore }

Typ: lista nazw modułów. Domyślnie: brak.

Moduły pominięte w ostrzeżeniu INW006 o kodzie poza wszystkimi warstwami, na przykład `tests` albo `migrations`. Wpis dopasowuje całe segmenty nazwy w dowolnym miejscu nazwy modułu: `migrations` obejmuje `shop.orders.migrations.0001_initial`. Importy z warstwy do tych modułów nadal są sprawdzane.

<!-- config: fragment -->

```toml
[tool.inwards]
ignore = ["tests", "scripts", "migrations", "conftest"]
```

### `generated` { #generated }

Typ: lista wzorców modułów. Domyślnie: `["*_pb2", "*_pb2_grpc", "_version"]`.

Moduły zapisywane przez krok budowania, które INW010 traktuje jako istniejące, gdy nie ma ich na dysku. Segmenty mogą używać `*` i `?`; wzorzec dopasowuje całe segmenty w dowolnym miejscu nazwy modułu. Lista, nawet pusta, zastępuje wartość domyślną. Szczegóły są w [ADR-029](../05-ADR.md#adr-029-generated-modules-pass-inw010-protoc-and-version-modules-by-default).

<!-- config: fragment -->

```toml
[tool.inwards]
generated = ["*_pb2", "*_pb2_grpc", "_version", "shop.api.gen"]
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

- `select`: zgłaszają tylko te reguły. Musi zawierać co najmniej jeden kod.
- `ignore`: te reguły nie zgłaszają. Ma pierwszeństwo przed `select`.
- `severity`: tabela kodu reguły na `"error"` albo `"warning"`.

INW000 nie da się wyłączyć ani zmienić jego poziomu. Szczegóły są w [ADR-027](../05-ADR.md#adr-027-per-rule-select-ignore-and-severity-in-a-toolinwardsrules-table).

<!-- config: fragment -->

```toml
[tool.inwards.rules]
ignore = ["INW007", "INW008"]
severity = { INW005 = "warning" }
```

### `shape` i `names` { #shape }

Typ: tablice tabel. Domyślnie: brak.

Jakie elementy pakiet może, musi i nie może zawierać (INW007, INW008) oraz gdzie może się pojawić nazwa elementu. Obie tabele oraz składnię ich selektorów i wzorców opisuje [przewodnik o kształcie pakietu](package-shape.md).

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
- `public` (domyślnie `[]`): prefiksy własnych modułów kontekstu, które mogą importować konteksty od niego zależne. To pełne nazwy modułów, a nie nazwy względne wobec kontekstu: `api` oznacza moduł najwyższego poziomu `api`. Każdy musi należeć do tego kontekstu; prefiks, który dokładniej posiada inny kontekst, to błąd konfiguracji. Moduł jest publiczny, gdy leży na publicznym prefiksie albo pod nim i należy do tego kontekstu.
- `depends-on` (domyślnie `[]`): konteksty, z których ten może importować. Zależność jest bezpośrednia: nie przechodzi dalej i nie działa w drugą stronę. Nazwa może wskazywać kontekst zadeklarowany niżej. Własna nazwa kontekstu, nieznana nazwa i powtórzona nazwa to błędy konfiguracji.

Konteksty i warstwy się sumują: zadeklarowana zależność ani moduł publiczny nigdy nie pozwalają na import, którego zabrania kolejność warstw, a przynależność do kontekstu nic nie mówi o warstwie ani odwrotnie. Kontekst korzysta tylko ze swoich własnych `depends-on` i `public`, także wtedy, gdy jego prefiksy leżą wewnątrz innego kontekstu. Uzasadnienie jest w [ADR-030](../05-ADR.md#adr-030-bounded-contexts-as-a-contexts-table-of-literal-prefixes).
