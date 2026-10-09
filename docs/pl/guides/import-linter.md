---
source: docs/chapters/guides/import-linter.md
source_hash: 66422fb545e0fcf3214f7b62648ed76ff391e6f8175baf8433758edbbea6d4b2
---

# Migracja z import-linter { #migrating-from-import-linter }

Kontrakty [import-linter](https://import-linter.readthedocs.io/) zamienisz na tabelę `[tool.inwards]` jednym poleceniem. `inwards import-config` czyta kontrakty, wypisuje tabelę i dla każdego kontraktu podaje, czy przeniósł się w całości, częściowo czy wcale, i dlaczego.

## Konwersja { #convert }

Uruchom je tam, gdzie uruchamiasz `lint-imports`:

```sh
inwards import-config            # print the table on stdout, the report on stderr
inwards import-config --write    # append the table to pyproject.toml
inwards import-config setup.cfg  # read this file instead of looking for one
```

Bez pliku polecenie szuka tam, gdzie `lint-imports`: w bieżącym katalogu, w tej kolejności: `setup.cfg` (jego sekcje `[importlinter]`), `.importlinter`, a potem `pyproject.toml` (`[tool.importlinter]`). Plik, którego nazwa kończy się na `.toml`, jest czytany jako TOML, każdy inny jako INI.

- **Wyjście.** Tabela trafia na stdout, więc `inwards import-config > inwards.toml` zapisuje sam TOML. Raport trafia na stderr.
- **`--write`** dopisuje tabelę do `pyproject.toml` leżącego obok konfiguracji import-linter. Odmawia, z kodem wyjścia 2 i bez zapisu, gdy obok tego pliku nie ma `pyproject.toml` albo gdy `pyproject.toml` ma już `[tool.inwards]`: nigdy nie nadpisuje istniejącej tabeli ani się z nią nie łączy. Wypisz wtedy tabelę i scal ją ręcznie.
- **`root`.** Gdy pakiet główny leży w `src/` (`src/<pakiet>` albo projekt na `uv_build`), tabela dostaje `root = "src"`, tak jak wybrałby to `inwards init`.
- **Kody wyjścia.** 0, gdy tabela została wypisana albo zapisana, nawet jeśli części kontraktów nie dało się przenieść (raport je wymienia). 2, gdy nie znaleziono konfiguracji import-linter, plik się nie parsuje albo `--write` odmówiło.

Tabela jest sprawdzana przed wypisaniem: musi się parsować jako konfiguracja Inwards, inaczej polecenie kończy się kodem wyjścia 2.

## Przykład { #an-example }

Ten `.importlinter` ma kontrakt warstw z dwoma niezależnymi modułami sąsiednimi, kontrakt zakazu z ignorowanym importem i kontrakt ochrony:

```ini title=".importlinter"
[importlinter]
root_package = shop
include_external_packages = True

[importlinter:contract:layers]
name = Web on top, the domain at the bottom
type = layers
layers =
    shop.web
    shop.orders | shop.billing
    shop.domain

[importlinter:contract:pure-domain]
name = The domain stays pure
type = forbidden
source_modules = shop.domain
forbidden_modules = pydantic
ignore_imports = shop.domain.money -> pydantic

[importlinter:contract:db]
name = Only the repository imports the database
type = protected
protected_modules = shop.db
allowed_importers = shop.repository
```

`inwards import-config` wypisuje:

```toml title="pyproject.toml"
# Converted from .importlinter by inwards import-config.
[tool.inwards]
layers = [
  { name = "domain", modules = ["shop.domain"], extend-deny-libraries = ["pydantic"] },
  [
    { name = "orders", modules = ["shop.orders"] },
    { name = "billing", modules = ["shop.billing"] },
  ],
  { name = "web", modules = ["shop.web"] },
]
```

i raportuje:

```text
inwards import-config: converted 2 of 3 contracts from .importlinter.
  mapped  layers ("Web on top, the domain at the bottom")
  partial pure-domain ("The domain stays pure")
          ignore_imports (shop.domain.money -> pydantic) has no equivalent: add an inline suppression with a reason at each import, or run `inwards baseline` once the config is in place.
  skipped db ("Only the repository imports the database")
          protected contracts have no equivalent: Inwards limits what a context exposes (`public`), not who may import it.
Inwards checks direct imports only: an import chain through a third module, which import-linter follows, isn't reported.
Inwards also runs rules import-linter doesn't have (INW006 for code outside every layer, INW005's default deny list on the innermost layer, INW010, INW011): run `inwards check`, then `inwards baseline` to accept what is there today.
```

## Jak przenoszą się kontrakty { #how-contracts-map }

| import-linter | Inwards | Reguła |
|---|---|---|
| `layers`, od najwyższej do najniższej | `layers`, od najbardziej wewnętrznej: kolejność jest odwrócona | INW001 |
| linia warstwy `a : b` (moduły sąsiednie, które mogą się wzajemnie importować) | jedna warstwa z oboma modułami | INW001 |
| linia warstwy `a | b` (niezależne moduły sąsiednie) | [warstwy sąsiednie](configuration.md#sibling-layers): zagnieżdżona tablica w `layers`, po jednej warstwie na moduł, w miejscu linii | INW001 |
| `containers` | każda warstwa powtórzona pod każdym kontenerem, w tej samej warstwie Inwards | INW001 |
| warstwy `(optional)` | zwykła warstwa; zgłaszana w raporcie, bo prefiks, który nie pasuje do żadnego modułu, dostaje ostrzeżenie INW006 | INW006 |
| `exhaustive = true` | zgłaszane w raporcie: moduł poza wszystkimi warstwami dostaje ostrzeżenie INW006, nie błąd | INW006 |
| `exhaustive_ignores` | `ignore`, po jednym wpisie na kontener | INW006 |
| `independence` | po jednym kontekście na moduł, żaden nie zależy od innego | INW002 |
| `forbidden`, własne moduły w `forbidden_modules` | po jednym kontekście na moduł źródłowy i zakazany; `depends-on` każdego źródła pomija to, czego nie wolno mu importować | INW002 |
| `forbidden`, zewnętrzne moduły w `forbidden_modules` | `extend-deny-libraries` na warstwach, które obejmują dokładnie moduły źródłowe | INW005 |
| `root_package`, `root_packages` | bez kontraktu warstw: jedna warstwa z pakietami głównymi; decydują też, które zakazane moduły są zewnętrzne | |

Zakazana para obejmuje wszystko poniżej obu swoich końców, tak jak pakiety w import-linter: gdy `shop.a` nie może importować `shop.c`, kontekst zadeklarowany wewnątrz `shop.a` też nie może. Każdy wygenerowany kontekst jest w całości publiczny (`public` to jego własny moduł), więc [INW003](../rules/INW003.md) nie zgłasza niczego ponad to, a `cycles = []` sprawia, że [INW004](../rules/INW004.md) nie zgłasza cykli między nowymi kontekstami, których import-linter nie sprawdzał.

Gdy kontraktów warstw jest kilka, pierwszy ustala kolejność warstw. Kolejny dołącza do niej, gdy ma te same warstwy w innych kontenerach albo gdy każdy moduł, który wymienia, jest już warstwą w tej samej kolejności. Wszystko inne trafia do raportu: Inwards ma jedną kolejność warstw na konfigurację.

## Czego nie da się przenieść { #what-doesnt-convert }

Każdy z tych przypadków trafia do raportu razem ze swoim kontraktem i nigdy nie znika po cichu:

- **`ignore_imports`.** Inwards nie ma w konfiguracji wyjątku dla pojedynczego importu. Po zapisaniu tabeli uruchom `inwards check`, a potem albo dodaj przy każdym imporcie wyciszenie inline z powodem (`# inwards: ignore[INW002] reason="..."`, zob. [ADR-028](../05-ADR.md#adr-028-inline-suppressions-need-a-reason-and-an-agent-cant-add-one-by-default)), albo przyjmij dzisiejsze naruszenia przez `inwards baseline` ([istniejący kod](install.md#on-an-existing-codebase)).
- **Wildcardy** (`mypackage.*`, `mypackage.**.models`) na dowolnej liście modułów. Inwards przyjmuje dosłowne nazwy modułów; kontrakt jest pomijany, a moduły, do których pasuje wildcard, wypisujesz ręcznie.
- **`as_packages = false`.** Nazwa modułu w Inwards zawsze obejmuje wszystko poniżej niej.
- **Kontrakty `protected`.** Inwards ogranicza to, co kontekst udostępnia innym (`public`, [INW003](../rules/INW003.md)), a nie to, które moduły mogą go importować.
- **Kontrakty `acyclic_siblings`.** [INW004](../rules/INW004.md) zgłasza cykle między modułami albo między kontekstami, nie między sąsiednimi pakietami; jeśli to wystarczy, ustaw ręcznie `cycles = ["modules", "contexts"]`.
- **Zakazany moduł zewnętrzny, gdy moduły źródłowe nie są całymi warstwami.** INW005 przypina listy bibliotek do warstw. Gdy `source_modules` to nie dokładnie moduły jednej lub kilku warstw, część dotycząca bibliotek trafia do raportu, a część z własnymi modułami i tak się przenosi.
- **Własne typy kontraktów** oraz linia warstwy, która miesza `|` i `:` (import-linter też ją odrzuca).
- **`broken_contract_guidance`.** Inwards pisze własne kroki naprawy dla każdego naruszenia.

## Co się zmienia po przejściu { #what-changes-after-the-switch }

- **Tylko bezpośrednie importy.** import-linter śledzi łańcuchy importów: w kontrakcie warstw `low` nie może importować `utils`, gdy `utils` importuje `high`. Inwards sprawdza każdy import osobno, więc taki łańcuch przechodzi, chyba że `utils` należy do warstwy.
- **Kontenery są sprawdzane względem siebie.** import-linter pozwala `foo.low` importować `bar.high`, gdy `foo` i `bar` to różne kontenery. Inwards ma jedną kolejność warstw dla projektu, więc zgłasza taki import.
- **Działają też własne reguły Inwards.** [INW006](../rules/INW006.md) zgłasza warstwę, która importuje własny kod nienależący do żadnej warstwy (błąd), oraz pakiet poza wszystkimi warstwami (ostrzeżenie). Najbardziej wewnętrzna z dwóch lub więcej warstw dostaje [domyślną listę zakazów](libraries.md#the-default-deny-list) INW005 z frameworkami i bibliotekami wejścia-wyjścia. [INW010](../rules/INW010.md) zgłasza importy własnych modułów, które nie istnieją, a [INW011](../rules/INW011.md) importy dynamiczne. Uruchom raz `inwards check` i zdecyduj: popraw, dodaj brakujące pakiety do warstwy albo do `ignore`, albo przyjmij stan obecny przez `inwards baseline`.

Migracja wygląda więc tak: uruchom `inwards import-config --write`, przeczytaj raport, uruchom `inwards check`, zajmij się tym, co znajdzie, i usuń krok `lint-imports` z CI, gdy `inwards check` przechodzi tam bez błędów ([GitHub Actions](ci.md)).
