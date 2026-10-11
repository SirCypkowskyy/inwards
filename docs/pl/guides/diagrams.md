---
source: docs/chapters/guides/diagrams.md
source_hash: 91fb40b7226bab02c9c73802364b9b8c4fb01ff3b8bdac7954be033fb67b38af
---

# Diagramy architektury { #architecture-diagrams }

Inwards trzyma rysunek architektury w Mermaid albo PlantUML w zgodzie z `[tool.inwards]`, w obie strony ([ADR-045](../05-ADR.md#adr-045-architecture-diagrams-are-checked-against-toolinwards-never-read-as-config)):

- **Dokumentacja idzie za kodem.** [INW017](../rules/INW017.md) zgłasza nazwę w diagramie, której nie zna konfiguracja albo kod, [INW018](../rules/INW018.md) strzałkę, która rysuje import zabroniony przez konfigurację, a [INW019](../rules/INW019.md) import w kodzie, którego diagram nie rysuje.
- **Dokumentacja steruje kodem.** `inwards import-diagram` zamienia diagram w pierwszą `[tool.inwards]`, jeden raz. Od tej chwili reguły trzymają je w zgodzie.

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
extend-select = ["INW017", "INW018", "INW019"]
```

Wszystkie trzy dają ostrzeżenia, więc rysunek, który się rozjechał, nie blokuje Stop gate agenta; `severity = { INW017 = "error", INW018 = "error" }` sprawia, że blokują. INW019 porównuje diagram z importami, które zbiera uruchomienie: w diagramie warstw import rysuje ścieżka strzałek, w diagramie kontekstów potrzebna jest bezpośrednia strzałka, a import pod `if TYPE_CHECKING:` się liczy. Działają przy sprawdzaniu całego projektu: `inwards check` bez ścieżek albo Stop gate z `stop-gate = "project"`.

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
- **Importy między warstwami i kontekstami, nie modułami.** INW019 nie porównuje strzałki między dwoma węzłami modułów wewnątrz jednego kontekstu z importami między tymi modułami.
- **Tylko uruchomienia dla całego projektu.** Hook po edycji i edytor nie pokazują zgłoszeń z diagramów.
