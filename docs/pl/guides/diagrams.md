---
source: docs/chapters/guides/diagrams.md
source_hash: 59ad460d9c3a836343dce561def8eb01f21e948dde049f96e06626e9c4b9f888
---

# Diagramy architektury { #architecture-diagrams }

Inwards trzyma rysunek architektury w Mermaid albo PlantUML w zgodzie z `[tool.inwards]`, w obie strony ([ADR-045](../05-ADR.md#adr-045-architecture-diagrams-are-checked-against-toolinwards-never-read-as-config)):

- **Dokumentacja idzie za kodem.** [INW017](../rules/INW017.md) zgłasza nazwę w diagramie, której nie zna konfiguracja albo kod, a [INW018](../rules/INW018.md) strzałkę, która rysuje import zabroniony przez konfigurację.
- **Dokumentacja steruje kodem.** `inwards import-diagram` zamienia diagram w pierwszą `[tool.inwards]`, jeden raz. Od tej chwili obie reguły trzymają je w zgodzie.
- **Konfiguracja rysuje dokumentację.** `inwards diagram` wypisuje `[tool.inwards]` jako oznaczony diagram, który obie reguły akceptują, a `import-diagram` odczytuje z powrotem ([Narysuj konfigurację](#diagram)).

`[tool.inwards]` pozostaje jedynym źródłem prawdy: diagram nigdy nie jest czytany jako konfiguracja w czasie sprawdzania.

## Oznacz diagram { #mark-a-diagram }

Liczy się tylko `flowchart` albo `graph` w Mermaid, który zaczyna się od komentarza-znacznika, w pliku wymienionym w kluczu [`diagrams`](configuration.md#diagrams): blok kodu `mermaid` w Markdownie albo cały plik `.mmd`. Pozostałe bloki Mermaid to zwykła dokumentacja.

| W diagramie | `%% inwards: layers` | `%% inwards: contexts` |
|---|---|---|
| Identyfikator węzła | nazwa warstwy | poza subgraphem: nazwa kontekstu |
| Subgraph | (grupa, bez znaczenia) | kontekst; jego identyfikator to nazwa kontekstu |
| `id["pkg.module"]`, etykieta w cudzysłowie | prefiks modułu albo selektor warstwy | moduł kontekstu albo moduł wewnątrz niego |
| Ciągła strzałka `a --> b` | `a` może importować `b`, więc `b` jest wewnętrzna | kontekst `a` zależy od kontekstu `b` |
| `:::public` | | wpis `public` kontekstu; na samym kontekście cały kontekst |
| `:::external` | pomijany | pomijany |
| Przerywana `-.->`, bez grotu `---`, dwukierunkowa `<-->` | bez znaczenia | bez znaczenia |

Miejsce warstwy to najdłuższa ścieżka ciągłych strzałek od niej do warstwy, która na nic nie wskazuje; warstwy na tym samym miejscu są sąsiednie i nie mogą importować siebie nawzajem. Cykl ciągłych strzałek nie ma kolejności i jest odrzucany.

Warstwę albo kontekst, którego nazwa nie może być identyfikatorem Mermaid (`slices.domain` z szablonu), nazywa węzeł, którego etykieta w cudzysłowie jest jednym z jej wpisów `modules`.

### PlantUML { #plantuml }

Diagram komponentów PlantUML liczy się tak samo, a znacznikiem jest komentarz `'`: `' inwards: layers` albo `' inwards: contexts`, wśród linii komentarzy tuż po `@startuml`. Inwards czyta każde `@startuml` ... `@enduml` w pliku `.puml`, `.plantuml`, `.pu` albo `.iuml` oraz każdy blok kodu `plantuml` albo `puml` w Markdownie, w którym `@startuml` można pominąć.

```text title="docs/layers.puml"
@startuml
' inwards: layers
component [shop.api] as api
component [shop.orders] as orders
component [shop.domain] as domain
database Postgres as db <<external>>
[api] --> [orders]
[orders] --> [domain]
[api] --> [db]
@enduml
```

| W diagramie | `' inwards: layers` | `' inwards: contexts` |
|---|---|---|
| `[name]`, `component name` | nazwa warstwy | poza pakietem: nazwa kontekstu |
| `package name { }` oraz grupy `node`, `folder`, `frame`, `cloud`, `rectangle` | (grupa, bez znaczenia) | kontekst; jego nazwa to nazwa kontekstu |
| `[pkg.module] as name`, `"pkg.module" as name` | prefiks modułu albo selektor warstwy | moduł kontekstu albo moduł wewnątrz niego |
| Ciągła strzałka `a --> b`, `a -> b`, `b <-- a`, `a -up-> b`, `a -[#red]-> b` | `a` może importować `b` | kontekst `a` zależy od kontekstu `b` |
| `<<public>>` | | wpis `public` kontekstu; na samym kontekście cały kontekst |
| `<<external>>` | pomijany | pomijany |
| Przerywana `..>`, bez grotu `--`, dwukierunkowa `<-->`, `-[dashed]->`, `--\|>` | bez znaczenia | bez znaczenia |

Przy aliasie `as` nazwą jest alias, a tekst w nawiasach albo w cudzysłowie to moduł, tak jak etykieta w cudzysłowie w Mermaid; bez aliasu nazwą jest tekst w nawiasach i nie ma modułu. Nazwa ze spacjami (`[Order handling] as orders`) to podpis. Kolory, `skinparam`, `<style>`, notatki, tytuły, `left to right direction`, interfejsy i linie `!include` są pomijane, tak samo jak linia, której czytnik nie umie śledzić.

## Sprawdzaj diagram { #check }

Wymień pliki i włącz reguły:

<!-- config: fragment -->

```toml title="pyproject.toml"
[tool.inwards]
diagrams = ["README.md", "docs/**/*.md", "docs/**/*.mmd", "docs/**/*.puml"]

[tool.inwards.rules]
extend-select = ["INW017", "INW018"]
```

Obie reguły dają ostrzeżenia, więc rysunek, który się rozjechał, nie blokuje Stop gate agenta; `severity = { INW017 = "error", INW018 = "error" }` sprawia, że blokują. Działają przy sprawdzaniu całego projektu: `inwards check` bez ścieżek albo Stop gate z `stop-gate = "project"`.

## Zacznij od diagramu { #import-diagram }

Najpierw narysuj architekturę, a potem niech `import-diagram` zapisze konfigurację:

```sh
inwards import-diagram docs/architecture.md            # print the table on stdout, notes on stderr
inwards import-diagram docs/architecture.md --write    # append it to pyproject.toml
```

- **Wejście.** Jeden plik Markdown (każdy oznaczony blok `mermaid` i `plantuml` w nim), jeden plik `.mmd` albo jeden plik `.puml`, z najwyżej jednym diagramem warstw i jednym diagramem kontekstów.
- **Wyjście.** Tabela wymienia plik w `diagrams` i włącza INW017 oraz INW018, więc diagram dalej jest sprawdzany. Plik spoza katalogu roboczego nie trafia do listy, bo wpisy `diagrams` nie mogą wychodzić wyżej przez `..`.
- **`--write`** dopisuje tabelę do `pyproject.toml` w katalogu roboczym. Odmawia, z kodem wyjścia 2 i bez zapisu, gdy nie ma `pyproject.toml` albo ma on już `[tool.inwards]`: nigdy niczego nie nadpisuje ani nie scala. Wtedy wypisz tabelę i scal ją ręcznie.
- **`root`.** Gdy pakiety leżą w `src/`, tabela dostaje `root = "src"`, tak jak wybrałoby `inwards init`.
- **Najpierw sprawdzenie.** Tabela musi się dać przeczytać jako konfiguracja Inwards, inaczej polecenie kończy się kodem wyjścia 2 i mówi dlaczego: dwie warstwy z tą samą etykietą w cudzysłowie, węzeł `public` poza modułem swojego kontekstu.

Co jest odrzucane, z numerem linii: cykl między warstwami; kontekst albo węzeł `:::public` bez etykiety w cudzysłowie, bo kontekst wymaga modułów; drugi diagram tego samego rodzaju w pliku. Warstwa bez etykiety w cudzysłowie dostaje `modules = []` i uwagę na stderr: uzupełnij ją przed sprawdzeniem. Plik tylko z diagramem kontekstów dostaje jedną warstwę, `app`, która obejmuje każdy kontekst.

## Narysuj konfigurację { #diagram }

`inwards diagram` działa w drugą stronę: wypisuje `[tool.inwards]` jako oznaczony diagram, gotowy do pliku `.mmd` albo `.puml` lub do bloku kodu w dokumentacji.

```sh
inwards diagram                                  # the layers, as Mermaid
inwards diagram --contexts                       # the contexts
inwards diagram --format plantuml                # PlantUML, for either diagram
inwards diagram --config services/pyproject.toml
```

- **Warstwy.** Jeden węzeł na warstwę, od najbardziej zewnętrznej, z jej modułem jako etykietą w cudzysłowie, i ciągła strzałka z każdej warstwy do każdej warstwy o jedno miejsce głębiej. Warstwa może importować każdą warstwę wewnątrz niej, więc te strzałki wystarczą, a najdłuższa ścieżka oddaje każdej warstwie jej miejsce: warstwy sąsiednie zostają sąsiednie.
- **Konteksty.** Kontekst bez modułów `public` jest węzłem. Kontekst z nimi jest subgraphem (w PlantUML `package`), w którym każdy wpis to węzeł `:::public` (`<<public>>`), także wpis dokładny `=pkg.module`. Każde `depends-on` to strzałka z jednego kontekstu do drugiego.
- **Nazwy.** Nazwa, która może być id węzła, jest tym id. Każda inna, na przykład `slices.domain` z szablonu, dostaje id zrobione z niej (`slices_domain`) i jest wskazywana przez swój pierwszy moduł, który INW017 i INW018 rozpoznają ([Oznacz diagram](#mark-a-diagram)). W PlantUML nazwa z łącznikiem albo taka, którą czytnik wziąłby za słowo kluczowe (`interface`, `package`), trafia w nawiasy: `[interface] as "shop.api"`.
- **W obie strony.** Względem tej samej konfiguracji INW017 i INW018 nie znajdują w wyniku niczego, o ile istnieje każdy moduł, który konfiguracja wymienia (inaczej INW017 powtarza na diagramie zgłoszenie INW006), a `inwards import-diagram` odczytuje go z powrotem do tych samych warstw, miejsc i kontekstów. Testy sprawdzają jedno i drugie dla przykładowego pakietu każdego presetu i obu przykładowych aplikacji, w obu notacjach.
- **To, czego diagram nie pokaże**, trafia na stderr, po linii na sprawę; kod wyjścia zostaje 0:
    - Warstwa albo kontekst z dwoma lub więcej modułami. W Mermaid każdy moduł dostaje własną linię węzła i `import-diagram` czyta je wszystkie, ale Mermaid rysuje węzeł z ostatnią etykietą. Alias PlantUML nazywa jeden komponent, więc diagram zostawia pierwszy moduł. Tak samo kontekst narysowany jako subgraph albo pakiet.
    - Warstwa albo kontekst nazwany jak słowo kluczowe Mermaid (`class`, `style`, `end`) nie może być węzłem Mermaid. `--format plantuml` go narysuje.
    - Listy bibliotek, kształty, opcje reguł i `ignore`, tak jak przy `import-diagram`, oraz szablony, rysowane jako warstwy, na które się rozwijają.
- **Kod wyjścia 2** dla `--layers` razem z `--contexts`, `--format` innego niż `mermaid` albo `plantuml` oraz `--contexts`, gdy konfiguracja nie deklaruje kontekstów.

Żeby rysunek był sprawdzany, umieść go w pliku wymienionym w kluczu `diagrams`. Plik `.mmd` albo `.puml` mieści jeden diagram; dla obu umieść każdy w osobnym bloku kodu jednego pliku Markdown, który `import-diagram` też czyta jako całość.

`inwards context` nie wypisuje diagramu: opis architektury już wymienia każdą warstwę z tym, co może importować, więc diagram by to powtarzał, a opis presetu fastapi jest już blisko swojego limitu 550 tokenów ([opis architektury](agents-md.md#the-architecture-brief-opt-in)).

## Przykład { #an-example }

Projekt z czterema pakietami i jeszcze bez konfiguracji:

<!-- e2e -->

```toml title="pyproject.toml"
[project]
name = "shop"
version = "0.1.0"
```

<!-- e2e -->

```python title="shop/domain/order.py"
class Order:
    pass
```

<!-- e2e -->

```python title="shop/orders/place.py"
from shop.domain.order import Order
```

<!-- e2e -->

```python title="shop/billing/invoice.py"
from shop.domain.order import Order
```

<!-- e2e -->

```python title="shop/api/routes.py"
from shop.orders.place import Order
```

Warstwy tak, jak rysuje je zespół, z zamówieniami i rozliczeniami obok siebie:

<!-- e2e -->

```text title="docs/layers.mmd"
%% inwards: layers
flowchart TD
  api["shop.api"] --> orders["shop.orders"] & billing["shop.billing"]
  orders --> domain["shop.domain"]
  billing --> domain
  api --> db[("Postgres")]:::external
```

<!-- e2e -->

```sh
inwards import-diagram docs/layers.mmd
```

<!-- e2e -->

```text
# Converted from docs/layers.mmd by inwards import-diagram.
[tool.inwards]
diagrams = ["docs/layers.mmd"]
layers = [
  { name = "domain", modules = ["shop.domain"] },
  [
    { name = "orders", modules = ["shop.orders"] },
    { name = "billing", modules = ["shop.billing"] },
  ],
  { name = "api", modules = ["shop.api"] },
]

[tool.inwards.rules]
extend-select = ["INW017", "INW018"]
inwards import-diagram: read 4 layers and 0 contexts from docs/layers.mmd.
```

`domain` na nic nie wskazuje, więc jest najbardziej wewnętrzna; `orders` i `billing` wskazują tylko na nią, więc dzielą następne miejsce i są sąsiednie; `api` jest najbardziej zewnętrzna. Baza danych jest `:::external` i nie zostaje warstwą. Zapisz i sprawdź:

<!-- e2e -->

```sh
inwards import-diagram docs/layers.mmd --write
inwards check
```

Projekt przechodzi, razem z diagramem. Gdyby później ktoś narysował strzałkę z `orders` do `billing`, byłoby to INW018, a import w kodzie między nimi INW001.

`inwards diagram` rysuje konfigurację z powrotem. Każda warstwa wskazuje warstwy o jedno miejsce głębiej, więc `api` wskazuje obie warstwy sąsiednie, a one wskazują `domain`:

<!-- e2e -->

```sh
inwards diagram
```

<!-- e2e -->

```text
%% inwards: layers
flowchart TB
  api["shop.api"]
  orders["shop.orders"]
  billing["shop.billing"]
  domain["shop.domain"]
  api --> orders & billing
  orders & billing --> domain
```

Diagram kontekstów działa tak samo. Ten

```text title="docs/contexts.mmd"
%% inwards: contexts
flowchart LR
  subgraph sales["shop.sales"]
    checkout["shop.sales.checkout"]
  end
  subgraph catalog["shop.catalog"]
    api["shop.catalog.api"]:::public
  end
  checkout --> api
```

zamienia się w:

<!-- config: fragment -->

```toml
[[tool.inwards.contexts]]
name = "sales"
modules = ["shop.sales"]
public = []
depends-on = ["catalog"]

[[tool.inwards.contexts]]
name = "catalog"
modules = ["shop.catalog"]
public = ["shop.catalog.api"]
depends-on = []
```

## Przejście z ArchUnitPython { #archunitpython }

[ArchUnitPython](https://github.com/LukasNiessen/ArchUnitPython) sprawdza kod względem diagramu komponentów PlantUML w teście pytest (`project_slices(...).should().adhere_to_diagram_in_file(...)`). Inwards czyta te same diagramy: `component [x]`, `[a] --> [b]` i `[a] -> [b]`, czyli wszystko, co czyta jego parser, a do tego wszystko z [tabeli PlantUML](#plantuml). Diagramy z testów i README ArchUnitPython należą do testów czytnika.

Żeby przenieść diagram, oznacz go, daj każdemu komponentowi jego moduł i zaimportuj go raz:

1. Dodaj `' inwards: contexts` po `@startuml`. Strzałki ArchUnitPython pozwalają na zależności bezpośrednie, nie przechodnie, i tak samo działa `depends-on` kontekstu ([INW002](../rules/INW002.md)).
2. Zamień każde `component [x]` na `component [package.x] as x <<public>>`. ArchUnitPython znajduje kod komponentu przez wzorzec wycinka w teście (`defined_by("src/(**)/**")`); Inwards potrzebuje modułu w diagramie. `<<public>>` zachowuje znaczenie z ArchUnitPython, w którym komponent może importować dowolny moduł komponentu, na który wskazuje; bez tego [INW003](../rules/INW003.md) pozwala tylko na moduły oznaczone jako publiczne.
3. Uruchom `inwards import-diagram`, potem `inwards check`.

Projekt ułożony jak przykładowy projekt ArchUnitPython, z trzema wycinkami jednego pakietu:

<!-- e2e -->

```toml title="archunit/pyproject.toml"
[project]
name = "sample"
version = "0.1.0"
```

<!-- e2e -->

```python title="archunit/sample/controllers/users.py"
from sample.services.users import find_user
```

<!-- e2e -->

```python title="archunit/sample/services/users.py"
from sample.models.user import User


def find_user() -> User:
    return User()
```

<!-- e2e -->

```python title="archunit/sample/models/user.py"
class User:
    pass
```

Diagram z ArchUnitPython, oznaczony i z modułami:

<!-- e2e -->

```text title="archunit/architecture.puml"
@startuml
' inwards: contexts
  component [sample.controllers] as controllers <<public>>
  component [sample.services] as services <<public>>
  component [sample.models] as models <<public>>
  [controllers] --> [services]
  [services] --> [models]
@enduml
```

<!-- e2e -->

```sh
cd archunit
inwards import-diagram architecture.puml --write
inwards check
```

<!-- e2e -->

```text
inwards import-diagram: read 1 layer and 3 contexts from architecture.puml.
```

Każdy komponent staje się kontekstem ze strzałkami jako `depends-on`, jedna warstwa, `app`, obejmuje je wszystkie, a `inwards check` przechodzi, razem z diagramem. Później import z `sample.models` do `sample.controllers` to INW002 w kodzie, a strzałka `[models] --> [controllers]` narysowana w diagramie to INW018.

Czym Inwards się różni:

- **Diagram nie jest sprawdzeniem.** ArchUnitPython ocenia kod względem diagramu przy każdym uruchomieniu testów. Inwards sprawdza kod względem `[tool.inwards]` i diagram względem `[tool.inwards]`, więc oba nie rozjadą się bez zgłoszenia, a hook, edytor i opis architektury dla agenta czytają jedną konfigurację.
- **Kod poza każdym komponentem.** ArchUnitPython zgłasza zależność wycinka, którego diagram nie nazywa, chyba że test wywoła `ignoring_orphan_slices()`. Inwards pomija importy, których jeden koniec leży poza każdym kontekstem, tak jak `ignoring_orphan_slices()`; INW006 ostrzega o module poza każdą warstwą.
- **Pakiety i inne strzałki.** ArchUnitPython pomija `package`, `..>` i strzałki ze stylem, takie jak `-[#red]->`. W Inwards pakiet to kontekst w diagramie kontekstów, `..>` nie znaczy importu, a ciągła strzałka ze stylem jest strzałką.
- **Także warstwy.** Oznaczony `' inwards: layers` ten sam diagram układa komponenty w warstwy, a warstwa może importować każdą warstwę wewnątrz niej, nie tylko tę, na którą wskazuje jej strzałka.
- **Bez `should_not()`.** Diagram kontekstów już zabrania każdej strzałki, której nie rysuje, więc zabroniona zależność nie potrzebuje osobnego diagramu.

## Ograniczenia { #limits }

- **Tylko flowcharty Mermaid i diagramy komponentów PlantUML.** Diagramy C4, `architecture-beta` i inne rodzaje diagramów PlantUML nie są czytane.
- **PlantUML jest czytany linia po linii.** Instrukcja rozbita na kilka linii (opis komponentu, który przechodzi do następnej linii) nie jest śledzona, a połączenie z komponentem przez jego wyświetlaną nazwę zamiast aliasu nazywa inny węzeł.
- **To, czego diagram nie wyrazi, zostaje poza tabelą.** Listy bibliotek, kształty, selektory inne niż etykieta węzła, opcje reguł i `ignore` dopisuje się ręcznie po imporcie.
- **Importy, których diagram nie rysuje**, nie są jeszcze zgłaszane; to będzie INW019 ([#332](https://github.com/SirCypkowskyy/inwards/issues/332)).
- **Tylko uruchomienia dla całego projektu.** Hook po edycji i edytor nie pokazują zgłoszeń z diagramów.
