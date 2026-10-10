---
source: docs/chapters/01-Introduction.md
source_hash: ebe75570bc5cc548020ed63f6dbfafaf34a3ecdf287854f85b8119d02b1041e7
---

# :material-layers-triple: Wprowadzenie { #introduction }

Inwards to linter architektury dla Pythona. Zapisujesz, jak podzielony jest na warstwy twój kod, a `inwards check` zgłasza błąd w chwili, gdy import przekracza granicę, której nie powinien. Powstał z myślą o pętli edycji agentów kodujących AI, takich jak Claude Code, Aider i Copilot, bo agent potrafi w jedno popołudnie napisać tyle importów, ile zwykle powstaje przez tydzień, a nikt nie czyta ich wszystkich.

Ten rozdział opisuje problem, to, co Inwards z nim robi, i to, jak zorganizowana jest reszta dokumentacji.

## Problem: agenci piszą kod szybciej, niż ktokolwiek zdąży przejrzeć jego kształt { #the-problem-agents-write-code-faster-than-anyone-can-review-its-shape }

Poproś agenta, żeby „dodał rabat do zamówień”, a zrobi to. Może przy okazji sięgnąć po sesję SQLAlchemy z wnętrza twojego modelu domeny, bo sesja jest pod ręką, a testy przechodzą. Zwykły zestaw narzędzi nie protestuje:

- Ruff sprawdza styl i wzorce błędów wewnątrz pliku. Jego ustawienie `banned-api` może zabronić modułu wszędzie, ale nie zna pojęcia „dozwolone stąd, zabronione stamtąd”.
- ty i mypy sprawdzają typy. Encja domeny, która importuje tabelę ORM, przechodzi sprawdzanie typów bez zarzutu.
- Testy sprawdzają zachowanie. Zachowanie jest poprawne.
- Przegląd kodu przez człowieka by to wyłapał, ale agent wyprodukował 40 plików w dziesięć minut, a recenzent tylko je przegląda po łebkach.

Efekt to kod, którego diagramy mówią „architektura heksagonalna”, a importy mówią „wielka kula błota”, skrót po skrócie.

Agenci dokładają dwa własne rodzaje błędów. Zmyślają: `from shop.domain.pricing import DiscountPolicy` wygląda wiarygodnie, nawet gdy `pricing` nie istnieje. A gdy sprawdzenie zgłasza problem, obchodzą je, przenosząc import do ciała funkcji albo pod `if TYPE_CHECKING:`. Zabezpieczenie dla agentów musi wyłapać jedno i drugie.

!!! abstract "Zakład, na którym stoi Inwards"
    Agenci spełniają ograniczenia, które widzą i mogą uruchomić, a ignorują te, które żyją tylko na stronie w wiki. Reguły architektury zwykle żyją w wiki. Rozdział 2 zamienia to w hipotezę, którą da się przetestować.

Python ma już narzędzia do sprawdzania architektury, przede wszystkim import-linter i pytest-archon. [Rozdział 2](02-Business-Context.md#other-tools-in-this-space) porównuje je szczegółowo. W skrócie: żadne z nich nie zostało zaprojektowane tak, by uruchamiać się po każdej edycji agenta i mówić mu, jak naprawić szkody.

## Co robi Inwards { #what-inwards-does }

Inwards zamienia reguły z wiki w sprawdzenie, które trwa milisekundy i odpowiada w formacie, na podstawie którego agent może działać.

```toml title="pyproject.toml"
[tool.inwards]
root = "src"
required-version = "0.1.0"  # oldest Inwards allowed; `inwards init` sets it
ignore = ["tests", "scripts", "migrations", "conftest"]  # tooling outside the layers; `inwards init` sets it
generated = ["*_pb2", "*_pb2_grpc", "_version"]  # modules a build step writes; this list is the default (optional)
escalate-after = 3  # attempts at one violation before the agent is told to ask you (optional)
run-log = false  # local log of hook runs, see the Run log chapter (optional)
stop-gate = "changed"  # "project" makes the Claude Code Stop gate check the whole project (optional)
layers = [
  { name = "domain",         modules = ["shop.domain"] },
  { name = "application",    modules = ["shop.application"] },
  { name = "infrastructure", modules = ["shop.infrastructure"] },
  { name = "interface",      modules = ["shop.api"] },
]
```

Każdy klucz opisuje [dokumentacja konfiguracji](guides/configuration.md), która podaje też JSON Schema do podpowiedzi i sprawdzania w edytorze.

<figure markdown="span">
  ![inwards check na czystym kodzie](../assets/screens/check-clean.svg){ loading=lazy }
  <figcaption>Przykładowa aplikacja w wersji z repozytorium: każdy import wskazuje do środka.</figcaption>
</figure>

Warstwy wymienia się od najbardziej wewnętrznej. Moduł może importować własną warstwę i wszystko, co jest na liście przed nią. `required-version` sprawia, że starszy plik binarny (albo nakładka, która nie jest Inwards) kończy się kodem wyjścia 2, zamiast sprawdzać projekt regułami, których może nie znać. Kod poza wszystkimi warstwami nie jest sprawdzany, więc INW006 uwidacznia tę lukę: import własnego kodu, który nie należy do żadnej warstwy, z wnętrza warstwy jest błędem (podobnie jak import z pakietu nad warstwami, którego `__init__.py` nie należy do żadnej warstwy), pakiet poza wszystkimi warstwami (chyba że wymienia go `ignore`) dostaje ostrzeżenie, a prefiks, który nie pasuje do żadnego modułu, jest zgłaszany w `pyproject.toml`. Wpisy `ignore` dopasowują całe segmenty nazwy w dowolnym miejscu, więc `migrations` obejmuje `shop.orders.migrations`. Nieznane klucze i prefiks wymieniony w dwóch warstwach to błędy konfiguracji (kod wyjścia 2). Ostrzeżenia nie zmieniają kodu wyjścia. Gdy domena importuje infrastrukturę, dostajesz to (w skrócie, jedna diagnostyka z tablicy `diagnostics`):

```json
{
  "code": "INW001",
  "file": "clean-app/shop/domain/order.py",
  "line": 14,
  "message": "Layer \"domain\" imports \"shop.infrastructure.sql_orders.SqlOrderRepository\" from outer layer \"infrastructure\".",
  "fix": {
    "summary": "Depend on an abstraction owned by \"domain\" instead of ...",
    "steps": [
      "Delete `from shop.infrastructure.sql_orders import SqlOrderRepository`. Do not move the import into a function or behind TYPE_CHECKING; Inwards checks those too.",
      "Declare a typing.Protocol in `shop.domain` (for example `shop.domain.ports`) ...",
      "Type this module against that Protocol and receive the implementation through a constructor ...",
      "Make the class in \"infrastructure\" satisfy the Protocol, and wire it in the composition root."
    ]
  }
}
```

Ta diagnostyka pochodzi z działającego scaffoldu w tym repozytorium, uruchomionego na kopii `examples/clean-app` z jednym dodanym błędnym importem. Długie napisy są tu ucięte przez `...`. Prawdziwe wyjście zawiera je w całości.

Żeby wprowadzać reguły stopniowo, tabela `[tool.inwards.rules]` ustala, które reguły zgłaszają naruszenia i na jakim poziomie:

<!-- config: fragment -->

```toml title="pyproject.toml"
[tool.inwards.rules]
ignore = ["INW007", "INW008"]      # these rules never report (optional)
severity = { INW005 = "warning" }  # reported, but doesn't fail a check or block the agent (optional)
# select = ["INW001", "INW011"]    # or: only these rules report (default: every rule)
```

Kody muszą być dokładne, nie są prefiksami, a nieznany kod to błąd konfiguracji (kod wyjścia 2). `ignore` ma pierwszeństwo przed `select`. INW000 zawsze zgłasza błąd, bo plik, którego zadeklarowane kodowanie może ukryć importy, w ogóle nie jest sprawdzany, a sprawdzenie Stop gate, czy w trakcie sesji nie przeniesiono warstwy, też pomija tabelę. Tabelę stosują `inwards check`, hooki, Stop gate i rozszerzenie VS Code; rozszerzenie czyta ją ponownie przy każdej zmianie `pyproject.toml` i pokazuje błąd konfiguracji (na przykład nieznany kod) na `pyproject.toml`. Jest częścią `[tool.inwards]`, więc config guard nie pozwala agentowi jej zmienić. [ADR-027](05-ADR.md#adr-027-per-rule-select-ignore-and-severity-in-a-toolinwardsrules-table) opisuje, jak działa z baseline'em i SARIF.

`generated` wymienia moduły, które zapisuje krok budowania, na przykład `orders_pb2` z protoc albo moduł `_version` zapisywany przez setuptools-scm. Checkout programisty je ma, a świeży checkout w CI nie, więc INW010 nie zgłasza importu takiego modułu, którego nie ma na dysku. Wzorce pasują do całych segmentów nazwy w dowolnym miejscu, tak jak `ignore`, a segment może używać `*` i `?`: `*_pb2` obejmuje `shop.api.orders_pb2`, a `shop.gen` wszystko w `shop/gen/`. Bez tego klucza lista to `["*_pb2", "*_pb2_grpc", "_version"]`; ustawienie klucza zastępuje tę listę, a `generated = []` ją wyłącza. Zbiór w nawiasach albo wzorzec złożony z samych symboli wieloznacznych to błąd konfiguracji. Szczegóły są w [GitHub Actions](guides/ci.md#generated-modules) i w [ADR-029](05-ADR.md#adr-029-generated-modules-pass-inw010-protoc-and-version-modules-by-default).

Żeby na stałe zaakceptować jeden import, dopisz w jego linii wyciszenie z kodem reguły i powodem:

```python title="shop/domain/order.py"
from shop.infrastructure.legacy import LegacyClient  # inwards: ignore[INW001] reason="old billing adapter, removed in #210"
```

Komentarz trafia do linii, na którą wskazuje diagnostyka: w imporcie w nawiasach do linii importowanej nazwy, a w imporcie dynamicznym rozpisanym na kilka linii do pierwszej linii wywołania:

```python title="shop/domain/plugins.py"
importlib.import_module(  # inwards: ignore[INW011] reason="plugin loader, reviewed in #230"
    "shop.infrastructure.plugins",
)
```

Wyciszenie bez powodu, z nieznanym kodem albo w złej postaci niczego nie ukrywa i jest zgłaszane jako INW009, a wyciszenie, które nie pasuje do żadnej diagnostyki w swojej linii, jako ostrzeżenie INW009. Każdy format wyjścia liczy wyciszone diagnostyki, a SARIF wymienia je jako wyniki oznaczone jako wyciszone. Hooki Claude Code pomijają wyciszenie, którego nie było w pliku na starcie sesji, więc agent nie może uciszyć naruszenia komentarzem; `agent-suppressions = "allow"` w `[tool.inwards]` pozwala takim wyciszeniom działać. Szczegóły są w [ADR-028](05-ADR.md#adr-028-inline-suppressions-need-a-reason-and-an-agent-cant-add-one-by-default).

<div class="grid cards" markdown>

-   :material-lightning-bolt:{ .lg .middle } __Na tyle szybki, by działać po każdej edycji__

    ---

    Sprawdzenie jednego pliku trwa w medianie poniżej 50 ms, łącznie ze startem procesu ([pomiary](06-Constraints-and-Quality.md#measurements)), więc sprawdzenie może się uruchamiać po każdej edycji agenta.

-   :material-robot-outline:{ .lg .middle } __Pisany dla agentów__

    ---

    Każde naruszenie ma ponumerowane kroki naprawy. Inwards wyłapuje też typowe obejścia, takie jak importy schowane w funkcjach albo w blokach `TYPE_CHECKING`.

-   :material-package-variant-closed:{ .lg .middle } __Jeden plik binarny, bez Pythona__

    ---

    Jeden plik wykonywalny skompilowany Bunem. Wrzuć go do CI, do hooka pre-commit albo do hooka agenta, albo dodaj go przez `uv add --dev` jako wheel platformowy z plikiem binarnym w środku.

-   :material-microsoft-visual-studio-code:{ .lg .middle } __Te same reguły w edytorze__

    ---

    Rozszerzenie VS Code uruchamia `inwards server`, który wykonuje to samo sprawdzenie co `inwards check`, więc podkreślenie w edytorze i błąd w CI nigdy się nie rozjeżdżają.

</div>

## Czym Inwards nie jest { #what-inwards-is-not }

To nie jest linter ogólnego przeznaczenia, narzędzie do sprawdzania typów ani formatter. Nadal używaj Ruffa i ty. Domyślnie Inwards zajmuje się wyłącznie strukturą zależności między twoimi własnymi modułami (rodziny reguł opt-in, takie jak [FastAPI](rules/index.md#fastapi), idą dalej, [ADR-037](05-ADR.md#adr-037-framework-rule-families-opt-in-with-their-own-prefix)) i zakłada, że wiesz już, jakiej architektury chcesz. Nie wymyśli jej za ciebie.

## Jak zorganizowana jest ta dokumentacja { #how-these-docs-are-organised }

Struktura opiera się na C4 dla architektury i na zwykłych ADR-ach dla decyzji.

| Rozdział | Przeczytaj, jeśli chcesz wiedzieć |
|---|---|
| [Pierwsze kroki](guides/install.md) | Jak zainstalować Inwards i podłączyć go do Claude Code, Aidera albo `AGENTS.md` |
| [2. Kontekst biznesowy](02-Business-Context.md) | Kto jeszcze działa w tym obszarze, dlaczego Inwards powinien istnieć i jaką hipotezę testujemy |
| [3. Architektura (C4)](03-Architecture-C4.md) | Kontekst, kontenery i komponenty, z diagramami |
| [4. Integracja z AI](04-AI-Integration.md) | Jak Inwards współpracuje z Claude Code, Aiderem, Copilotem i innymi |
| [5. Decyzje (ADR)](05-ADR.md) | Dlaczego TypeScript, dlaczego tree-sitter w WASM, dlaczego Bun i z czego zrezygnowaliśmy |
| [6. Ograniczenia i jakość](06-Constraints-and-Quality.md) | Budżety wydajności, pomiary, ryzyka |
| [7. Słownik](07-Glossary.md) | Słownictwo, od „portu” po „szkielet importów” |
| [8. Run log](08-Run-Log.md) | Opcjonalny lokalny log, którym design partnerzy mierzą hipotezę |

!!! info "Stan"
    Pre-alpha.
    Osiem reguł działa od początku do końca w CLI, w silniku i w edytorze (`inwards server`): INW001 (kierunek warstw), INW011 (importy dynamiczne), INW005 ([biblioteki w warstwach](guides/libraries.md): domyślnie żadnych frameworków ani operacji wejścia-wyjścia w domenie), INW006 (kod poza wszystkimi warstwami, martwe prefiksy), INW010 (importy własnych modułów, które nie istnieją), INW007 i INW008 ([kształt pakietu](guides/package-shape.md): elementy dozwolone, zabronione i wymagane) oraz INW000 (zadeklarowane kodowanie źródła, które mogłoby ukryć importy).
    `inwards init --agent claude` instaluje hooki Claude Code: sprawdzenie po każdej edycji, Stop gate obejmujący to, co zmieniła sesja, config guard oraz eskalację do użytkownika. Dla Aidera `init` wypisuje linię `lint-cmd` do dodania, a dla innych agentów zapisuje sekcję w `AGENTS.md`. W nowym projekcie `inwards init --style layered|clean|hexagonal|vertical-slices|bounded-contexts|django|fastapi` zapisuje warstwy, a `--scaffold` dodaje przykładowy pakiet, który przechodzi sprawdzenie.
    Każde wydanie to GitHub Release z plikami binarnymi dla sześciu platform, pięcioma wheelami platformowymi i rozszerzeniem VS Code, po jednym VSIX na platformę z plikiem binarnym w środku. Jak dotąd jedynym wydaniem jest wersja przedpremierowa v0.1.0-rc.1.
    Wszystko, co w tej dokumentacji jest oznaczone :material-progress-clock:, jest zaplanowane, a nie zbudowane.
