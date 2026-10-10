---
source: docs/chapters/guides/install.md
source_hash: 5246f7564334fa60fa075301dd01b79f5c8f70d7a01c01f509a30b822d7ecfeb
---

# Instalacja Inwards { #install-inwards }

!!! info "Zweryfikowano 2026-09-25"
    Budowanie ze źródeł i każde następne polecenie, ręcznie na Linuksie x64. Na macOS (arm64) i Windows CI uruchamia `init`, `check` i hook ze skompilowanym plikiem binarnym przed każdym wydaniem; ręczne sprawdzenie na tych systemach wciąż jest do zrobienia. Kroków z `curl` i `Invoke-WebRequest` nie da się wypróbować, dopóki repozytorium jest prywatne; `gh release download` działa. Rozszerzenie VS Code 2026-10-10: VSIX dla platformy zainstalowany w VS Code 1.141 na macOS (arm64) pokazał INW007, sprawdzone skryptem `src/vscode-extension/scripts/try-in-vscode.ts`; Linux i Windows wciąż są do sprawdzenia.

Inwards to jeden plik wykonywalny, bez środowiska uruchomieniowego do instalowania. Najnowsze wydanie to wersja przedpremierowa v0.1.0-rc.1; pierwsze pełne wydanie przyjdzie z jednym z późniejszych kamieni milowych. Możesz też zbudować Inwards ze źródeł.

## Z wydania { #from-a-release }

Każde wydanie w [GitHub Releases](https://github.com/SirCypkowskyy/inwards/releases) ma jeden plik binarny na platformę, wheele platformowe, rozszerzenie VS Code (`.vsix` dla każdej platformy, [niżej](#vs-code)) i `SHA256SUMS`. Atestacje buildów dojdą, gdy repozytorium stanie się publiczne.

| Platforma | Plik |
|---|---|
| Linux x64 | `inwards-linux-x64` (glibc) albo `inwards-linux-x64-musl` (Alpine: najpierw `apk add libstdc++ libgcc`) |
| Linux arm64 | `inwards-linux-arm64` |
| macOS Apple silicon | `inwards-darwin-arm64` |
| macOS Intel | `inwards-darwin-x64` |
| Windows x64 | `inwards-windows-x64.exe` |

=== "Linux / macOS"

    ```sh
    VERSION=v0.1.0-rc.1; FILE=inwards-linux-x64   # pick your file from the table
    curl -LO "https://github.com/SirCypkowskyy/inwards/releases/download/$VERSION/$FILE"
    curl -LO "https://github.com/SirCypkowskyy/inwards/releases/download/$VERSION/SHA256SUMS"
    sha256sum --check --ignore-missing SHA256SUMS   # macOS: shasum -a 256 --check --ignore-missing SHA256SUMS
    mkdir -p ~/.local/bin && install -m 755 "$FILE" ~/.local/bin/inwards
    inwards --version
    ```

    Jeśli powłoka nie znajduje `inwards`, dodaj `~/.local/bin` do `PATH` w profilu powłoki (`export PATH="$HOME/.local/bin:$PATH"`).

    Dopóki repozytorium jest prywatne, GitHub odpowiada na te adresy kodem 404. Pobierz pliki przez GitHub CLI, a potem kontynuuj od linii z `sha256sum`:

    ```sh
    gh release download "$VERSION" --repo SirCypkowskyy/inwards --pattern "$FILE" --pattern SHA256SUMS
    ```

=== "Windows (PowerShell)"

    ```powershell
    $Version = "v0.1.0-rc.1"; $File = "inwards-windows-x64.exe"
    Invoke-WebRequest "https://github.com/SirCypkowskyy/inwards/releases/download/$Version/$File" -OutFile inwards.exe
    Invoke-WebRequest "https://github.com/SirCypkowskyy/inwards/releases/download/$Version/SHA256SUMS" -OutFile SHA256SUMS
    (Get-FileHash inwards.exe -Algorithm SHA256).Hash.ToLower()   # compare with the line for $File in SHA256SUMS
    .\inwards.exe --version
    ```

    Umieść `inwards.exe` w katalogu, który jest w `PATH`.

Gdy atestacje zostaną opublikowane, `gh attestation verify <file> --repo SirCypkowskyy/inwards` sprawdzi, czy plik binarny zbudował workflow wydań tego repozytorium.

## Jako zależność deweloperska uv { #as-a-uv-dev-dependency }

Każde wydanie ma też po jednym wheelu na platformę, z plikiem binarnym w środku, tak jak dystrybuowany jest Ruff (Linux z glibc, macOS i Windows; na Alpine użyj pliku binarnego). uv instaluje go jak każdy inny pakiet, a `inwards` trafia do środowiska wirtualnego projektu.

### Z PyPI (od pierwszego wydania na PyPI) { #from-pypi-from-the-first-pypi-release }

Na PyPI nie ma jeszcze żadnego wydania. Gdy się pojawi, instalacja zajmie jedną linię, a uv wybierze wheel dla każdej platformy:

```sh
uv add --dev inwards
uv run inwards check
uvx inwards --version   # one-off, no project
```

Do tego czasu `inwards` na PyPI to rezerwacja nazwy w wersji 0.0.0: `--version` mówi, że linter nie został jeszcze wydany, a każde inne polecenie kończy się kodem 2. Użyj wheeli z wydania na GitHubie, opisanych niżej. Wydania trafiają na PyPI przez [trusted publishing](../03-Architecture-C4.md#publishing-to-pypi); pierwsze przyjdzie z jednym z późniejszych kamieni milowych, nie z v0.1.0-rc.1.

Żeby podłączyć agenta w takim projekcie, przekaż `init` flagę `--launcher "uv run"` (`uv run inwards init --agent claude --launcher "uv run"`): hooki i sekcja w `AGENTS.md` podają wtedy `uv run inwards` i nie zawierają ścieżki. Bez niej `init` zapisuje ścieżkę pliku binarnego, jako który działa; w projekcie leży ona w `.venv` i różni się między worktree'ami, a pod `uvx` leży w pamięci podręcznej uv, o czym `init` ostrzega.

`uv add --dev inwards` bierze najnowsze pełne wydanie i pomija wersje przedpremierowe. Żeby wypróbować wersję przedpremierową, która jest na PyPI, poproś o nią wprost: `uv add --dev "inwards>=0.2.0rc1"`.

### Z wydania na GitHubie { #from-a-github-release }

```sh
TAG=v0.1.0-rc.1; VER=0.1.0rc1   # the release, and its Python version
uv add --dev "inwards @ https://github.com/SirCypkowskyy/inwards/releases/download/$TAG/inwards-$VER-py3-none-manylinux_2_17_x86_64.whl"
uv run inwards check
uvx --from "https://github.com/SirCypkowskyy/inwards/releases/download/$TAG/inwards-$VER-py3-none-manylinux_2_17_x86_64.whl" inwards --version   # one-off, no project
```

Wybierz wheel dla swojej platformy: `manylinux_2_17_x86_64`, `manylinux_2_17_aarch64`, `macosx_13_0_arm64`, `macosx_13_0_x86_64` albo `win_amd64`. Zespołowi pracującemu na kilku platformach daj uv po jednym źródle na platformę w `pyproject.toml`. Wymień wszystkie pięć: na platformie, do której nie pasuje żaden znacznik, uv wraca do PyPI, a tam do pierwszego wydania na PyPI jest tylko rezerwacja nazwy.

```toml title="pyproject.toml"
[dependency-groups]
dev = ["inwards"]

[tool.uv.sources]
inwards = [
  { url = "https://github.com/SirCypkowskyy/inwards/releases/download/v0.1.0-rc.1/inwards-0.1.0rc1-py3-none-manylinux_2_17_x86_64.whl", marker = "sys_platform == 'linux' and platform_machine == 'x86_64'" },
  { url = "https://github.com/SirCypkowskyy/inwards/releases/download/v0.1.0-rc.1/inwards-0.1.0rc1-py3-none-manylinux_2_17_aarch64.whl", marker = "sys_platform == 'linux' and platform_machine == 'aarch64'" },
  { url = "https://github.com/SirCypkowskyy/inwards/releases/download/v0.1.0-rc.1/inwards-0.1.0rc1-py3-none-macosx_13_0_arm64.whl", marker = "sys_platform == 'darwin' and platform_machine == 'arm64'" },
  { url = "https://github.com/SirCypkowskyy/inwards/releases/download/v0.1.0-rc.1/inwards-0.1.0rc1-py3-none-macosx_13_0_x86_64.whl", marker = "sys_platform == 'darwin' and platform_machine == 'x86_64'" },
  { url = "https://github.com/SirCypkowskyy/inwards/releases/download/v0.1.0-rc.1/inwards-0.1.0rc1-py3-none-win_amd64.whl", marker = "sys_platform == 'win32'" },
]
```

Żaden znacznik nie odróżnia glibc od musl, więc na Alpine `uv sync` zatrzymuje się z komunikatem „incompatible platform”; tam użyj pliku binarnego.

!!! warning "Dopóki repozytorium jest prywatne"
    GitHub udostępnia pliki wydań prywatnego repozytorium tylko przez swoje API, którego uv nie potrafi wywołać, więc te adresy zwracają 404 nawet z tokenem. Pobierz wheele przez GitHub CLI i każ uv szukać w tym katalogu. uv wybierze wtedy wheel dla każdej platformy:

    ```sh
    gh release download v0.1.0-rc.1 --repo SirCypkowskyy/inwards --pattern '*.whl' --dir wheels
    ```

    ```toml title="pyproject.toml"
    [tool.uv]
    find-links = ["wheels"]
    prerelease = "allow"
    ```

    ```sh
    uv add --dev inwards
    uv run inwards --version
    ```

`inwards --version` wypisuje wydanie, z którego zbudowano plik binarny, bez przyrostka wersji przedpremierowej (`0.1.0` dla `0.1.0rc1`).

## Ze źródeł { #from-source }

Potrzebujesz [Buna](https://bun.sh) 1.4.2 (wersji z `.bun-version`) i dostępu do repozytorium.

```sh
git clone https://github.com/SirCypkowskyy/inwards && cd inwards
bun install
bun run build:cli bun-linux-x64          # or bun-darwin-arm64, bun-windows-x64, ...
mkdir -p ~/.local/bin && install -m 755 dist/inwards-linux-x64 ~/.local/bin/inwards
inwards --version
```

## W edytorze { #in-your-editor }

`inwards server` to serwer języka przez stdio. Edytor z klientem LSP uruchamia go i pokazuje dla każdego pliku w obszarze roboczym to, co zgłasza dla niego `inwards check`: dokument, w którym piszesz, jest sprawdzany przy każdej zmianie, a cały obszar roboczy ponownie przy każdym zapisie i za każdym razem, gdy pliki powstają albo znikają. Każdy folder obszaru roboczego używa własnego `[tool.inwards]`, tak jak `inwards check` uruchomione w tym folderze ([ADR-041](../05-ADR.md#adr-041-inwards-server-runs-inwards-checks-own-code-the-extensions-node-server-stays-until-it-switches)). Wskaż edytorowi plik binarny:

=== "Neovim 0.11+"

    ```lua title="init.lua"
    vim.lsp.config("inwards", {
      cmd = { "inwards", "server" },
      filetypes = { "python" },
      root_markers = { "pyproject.toml" },
    })
    vim.lsp.enable("inwards")
    ```

=== "Helix"

    ```toml title="~/.config/helix/languages.toml"
    [language-server.inwards]
    command = "inwards"
    args = ["server"]

    [[language]]
    name = "python"
    language-servers = ["ruff", "inwards"]   # keep the servers you already use in this list
    ```

Z uv użyj jako komendy `uv run inwards server`, żeby każdy projekt dostał własną wersję. Testy sterują plikiem binarnym przez stdio tak, jak robią to te edytory; żadnego z nich nie sprawdzono jeszcze ręcznie.

### VS Code { #vs-code }

Rozszerzenie jest cienkim klientem: uruchamia `inwards server` i pokazuje to, co serwer zgłasza ([ADR-043](../05-ADR.md#adr-043-the-vs-code-extension-bundles-the-binary-one-vsix-per-platform)). Pakiet dla każdej platformy zawiera plik binarny `inwards` tej platformy, więc nie trzeba instalować niczego więcej.

| Platforma | Cel VS Code | Plik w wydaniu |
|---|---|---|
| Linux x64 | `linux-x64` | `inwards-vscode-linux-x64-<tag>.vsix` |
| Linux arm64 | `linux-arm64` | `inwards-vscode-linux-arm64-<tag>.vsix` |
| Alpine x64 | `alpine-x64` | `inwards-vscode-alpine-x64-<tag>.vsix` |
| macOS na Apple silicon | `darwin-arm64` | `inwards-vscode-darwin-arm64-<tag>.vsix` |
| macOS na Intelu | `darwin-x64` | `inwards-vscode-darwin-x64-<tag>.vsix` |
| Windows x64 | `win32-x64` | `inwards-vscode-win32-x64-<tag>.vsix` |
| każda inna | | `inwards-vscode-universal-<tag>.vsix`, bez pliku binarnego: dodaj `inwards` do `PATH` albo ustaw `inwards.path` |

`.github/workflows/vscode-publish.yml` wysyła te pliki do Visual Studio Marketplace i Open VSX (dla VSCodium, Cursora i innych edytorów, które z niego korzystają), gdy właściciel opublikuje pełne wydanie; rozszerzenia nie ma jeszcze w żadnym z rejestrów. Do tego czasu zainstaluj plik dla swojej platformy z wydania nowszego niż v0.1.0-rc.1 (ta wersja przedpremierowa ma jeszcze stary pojedynczy `.vsix` z własnym serwerem):

```sh
code --install-extension inwards-vscode-darwin-arm64-vX.Y.Z.vsix
```

Ustawienia:

| Ustawienie | Domyślnie | Co robi |
|---|---|---|
| `inwards.enable` | `true` | Uruchamia sprawdzenia. Wyłączone zatrzymuje serwer języka. |
| `inwards.path` | `""` | Plik wykonywalny `inwards` do uruchomienia. Puste: dołączony plik binarny, a jeśli go nie ma, `inwards` z `PATH`. Sama nazwa jest szukana w `PATH`, ścieżka względna liczy się od pierwszego folderu obszaru roboczego, a `~` i `${workspaceFolder}` są rozwijane. Na Windows musi to być `.exe`. |

Zmiana któregokolwiek ustawienia restartuje serwer, tak samo jak **Inwards: Restart Server** w palecie poleceń. Żeby uruchamiać wersję, którą projekt przypina przez `uv add --dev inwards`, ustaw w ustawieniach obszaru roboczego `inwards.path` na `${workspaceFolder}/.venv/bin/inwards` (`${workspaceFolder}\.venv\Scripts\inwards.exe` na Windows). W niezaufanym obszarze roboczym VS Code pomija wartość `inwards.path` z obszaru roboczego, więc sklonowane repozytorium nie może wybrać programu, który uruchomi rozszerzenie; zaufaj folderowi albo ustaw ścieżkę w ustawieniach użytkownika.

Gdy rozszerzenie nie znajdzie pliku binarnego (ustawione `inwards.path` wskazuje na nic albo pakiet uniwersalny nie ma nic w `PATH`), mówi o tym, podaje przyciski do ustawienia i do tej strony i niczego nie uruchamia. Kanał **Inwards** w panelu Output pokazuje to, co serwer pisze na stderr.

## Skonfiguruj warstwy { #configure-the-layers }

### Nowy projekt: zacznij od presetu { #a-new-project-start-from-a-preset }

`inwards init --style` zapisuje `[tool.inwards]` dla znanej architektury, a `--scaffold` dodaje mały przykładowy pakiet, który przechodzi sprawdzenie. Projekt tworzy uv; Inwards dodaje tylko warstwy:

```sh
uv init --package app && cd app
inwards init --style hexagonal --scaffold
```

```text
inwards init: wrote the hexagonal preset to pyproject.toml and 14 example files.

src/app/  (hexagonal)
├── adapters/
│   ├── inbound/   inbound: may import domain, application; not its sibling outbound
│   └── outbound/  outbound: may import domain, application; not its sibling inbound
├── application/   application: may import domain
├── bootstrap.py   bootstrap: may import every other layer
└── domain/        domain: imports no other layer

inwards check: 0 violations, 0 warnings.

Try the example: uv run python -m app.bootstrap book 2
Wire an agent: inwards init --agent claude|opencode|aider|agents-md
```

Gdy Inwards trafi na PyPI ([#32](https://github.com/SirCypkowskyy/inwards/issues/32)), druga linia zmieni się w `uvx inwards init --style hexagonal --scaffold` i nie trzeba będzie niczego wcześniej instalować.

Istnieje siedem presetów, każdy z warstwami wymienionymi od najbardziej wewnętrznej. `inwards init --list-styles` wypisuje je razem z ich pakietami.

| Styl | Warstwy | Czego nie potrafi zabronić |
|---|---|---|
| `layered` | domain, persistence, services, presentation, bootstrap | presentation wywołującej persistence bezpośrednio (otwarte warstwy) |
| `clean` | domain, application, infrastructure, presentation, bootstrap | presentation importującej infrastructure |
| `hexagonal` | domain, application, outbound (`adapters.outbound`) i inbound (`adapters.inbound`) jako [warstwy sąsiednie](configuration.md#sibling-layers), bootstrap | adaptera inbound wywołującego port zamiast przypadku użycia |
| `vertical-slices` | shared, features, bootstrap; każdy wycinek w `features` jest kontekstem, którego modułem publicznym jest `api` | kodu używanego przez jeden wycinek, przeniesionego do `shared` |
| `bounded-contexts` | `app.*` z szablonem `context`: domain, application, infrastructure, api w każdym kontekście; bootstrap | `api` kontekstu reeksportującego jego encje domenowe |
| `django` | `app.*` z szablonem `django-app`: models, services, views, urls w każdej aplikacji; sam pakiet (settings, główny URLconf) | widoku używającego modeli zamiast serwisów |
| `fastapi` | sam pakiet jako jądro (kernel); `app.*` z szablonem `fastapi-domain`: constants, exceptions i config, potem models i schemas, utils, service, dependencies, router w każdej domenie; `app.main` | routera używającego modeli bezpośrednio zamiast przez service |

Każda warstwa może importować samą siebie i warstwy przed nią, więc konfiguracja złożona z samych warstw nie wyrazi luk z ostatniej kolumny; komentarz w tabeli `[tool.inwards]` nazywa tę lukę. `bootstrap.py` to korzeń kompozycji (composition root), jedyny moduł, który widzi każdą warstwę. W `hexagonal` adaptery inbound i outbound zajmują jedno miejsce w kolejności, więc żaden nie może importować drugiego.

Ostatnie cztery presety rozdzielają pakiety [kontekstami](configuration.md#contexts) i opisują pakiety [szablonem](configuration.md#templates):

- **`vertical-slices`** umieszcza jeden pakiet na funkcję w `app.features`, na wspólnym jądrze `app.shared`. Każdy wycinek jest kontekstem: importuje inny wycinek tylko wtedy, gdy wymienia go jego `depends-on` ([INW002](../rules/INW002.md)), i wtedy tylko moduł `api` tego wycinka ([INW003](../rules/INW003.md)); to samo dotyczy kodu poza wszystkimi wycinkami, takiego jak `bootstrap.py`.
- **`bounded-contexts`** nadaje każdemu pakietowi bezpośrednio pod `app` te same warstwy, `app.*.domain` < `app.*.application` < `app.*.infrastructure` < `app.*.api`, przez jeden wpis z szablonem. Konteksty przechodzą jeden do drugiego tylko przez `app.<ctx>.api`, a ponieważ `api` to najbardziej zewnętrzna rola, kontekst sięga do innego ze swojego własnego `api`.
- **`django`** nadaje każdej aplikacji pod `app` warstwy `models` < `services` < `views` < `urls`. Sam pakiet jest najbardziej zewnętrzną warstwą, na ustawienia, główny URLconf i moduły aplikacji spoza ról, takie jak `admin.py` i `apps.py`. Aplikacje są niezależne z wyjątkiem `services`: preset wyłącza INW002, więc aplikacja może używać serwisów innej bez deklarowania tego, a INW003 zgłasza import każdego innego modułu innej aplikacji. Najbardziej wewnętrzna rola dostaje `deny-libraries = []`, bo modele importują `django.db`.
- **`fastapi`** to układ [fastapi-best-practices](https://github.com/zhanymkanov/fastapi-best-practices). Każdy pakiet pod `app` jest domeną, której warstwy nadaje szablon `fastapi-domain`: `constants | exceptions | config` < `models | schemas` < `utils` < `service` < `dependencies` < `router` (`|` oznacza [warstwy sąsiednie](configuration.md#sibling-layers)). Sam pakiet jest jądrem (kernel), najbardziej wewnętrzną warstwą, na wspólne moduły (`config.py`, `models.py` z modelem bazowym, `exceptions.py`, `database.py`), z `deny-libraries = []`, bo importują pydantic i klienta bazy danych. `app.main` buduje aplikację i jest najbardziej zewnętrzną warstwą. Inne domeny i `main.py` mogą importować z domeny `router`, `service`, `schemas`, `dependencies`, `constants` i `exceptions`, nigdy `models`, `config` ani `utils` (INW003); tak jak `django`, preset wyłącza INW002. Włącza też wszystkie wydane [reguły FastAPI](../rules/index.md#fastapi), od FAPI001 do FAPI003 i od FAPI005 do FAPI009, przez `extend-select`, jako ostrzeżenia przez tabelę `[tool.inwards.rules.severity]` z jedną linią na regułę (usuń linię, żeby reguła zgłaszała ze swoim własnym poziomem), i ustawia w FAPI002 `report-direct-raises = false`, żeby nie powtarzała `FAST004` z Ruffa. Tak samo włącza [INW012](../rules/INW012.md), z `delegate-to = ["domain.service"]`: endpoint, który nie wywołuje niczego z modułu `service` swojej domeny albo sam wykonuje pracę, dostaje ostrzeżenie, którego poprawka wskazuje moduł `service` jego własnej domeny, np. `app.posts.service` dla endpointu w `app/posts/router.py`. Plik `posts/router.py` z przykładowego pakietu przechodzi: każdy endpoint wywołuje `posts.service`, a `remove_post` najpierw dostaje post przez zależność `valid_post_id`. Jako ostrzeżenie włączona jest też [INW013](../rules/INW013.md), we wszystkich modułach: endpoint albo zależność `async def`, które wywołują synchroniczną `Session` z SQLAlchemy, redis-py, boto3 albo sterownik DB-API, blokują pętlę zdarzeń. Scaffold trzyma posty w pamięci, więc nic w nim nie blokuje; z bazą danych w endpointach `async def` czekaj (`await`) na `AsyncSession` albo zamień je na zwykłe `def`, które FastAPI uruchamia w puli wątków. Po sprawdzeniu init wypisuje pasującą konfigurację Ruffa (`ASYNC`, `FAST`, `TID251`, z `pydantic.BaseModel` i `pydantic_settings.BaseSettings` zabronionymi poza modułem bazowym i plikami `config.py`); nigdy jej nie zapisuje. Żeby dostać dokładnie ten układ, z `src` jako pakietem, uruchom `inwards init --style fastapi --scaffold --package src` w projekcie bez katalogu `src/`.

Tabela kontekstów wymienia każdy pakiet z nazwy, bo `modules` kontekstu to dosłowne prefiksy. Z `--scaffold` init zapisuje wpis dla pakietu `orders` ze scaffoldu (`posts` w `fastapi`); bez niego ten sam wpis trafia do pliku jako komentarz, jako przykład do skopiowania dla każdego pakietu, który projekt ma. Pakiet bez wpisu nie jest odseparowany od pozostałych.

Co zapisuje `--style` i kiedy się zatrzymuje:

- **Tabela:** warstwy, `root` (`src` dla układu src, w przeciwnym razie `.`), `required-version`, domyślna lista `ignore` i komentarz z nazwą presetu i wersją Inwards. Pakiet pochodzi z `[project].name`, znormalizowanego tak jak robi to uv (`my-app` staje się `my_app`), albo z `--package`; słowo kluczowe Pythona nie może nim być. Uruchomiony w podkatalogu projektu, init używa najbliższego `pyproject.toml` powyżej i mówi, którego. Zanim pakiet powstanie, `root` to `src`, gdy backendem budowania jest uv_build albo gdy `src/` zawiera już kod w Pythonie.
- **Nigdy nie nadpisuje warstw.** Jeśli `[tool.inwards]` już istnieje, init kończy się kodem 2 i niczego nie zapisuje. Bez `pyproject.toml` kończy się kodem 2 i proponuje `uv init --package`.
- **`--scaffold`** zapisuje encję, port (`typing.Protocol`), przypadek użycia, adapter implementujący port, adapter sterujący z wiersza poleceń, korzeń kompozycji i jeden test w `tests/`. W `vertical-slices` i `bounded-contexts` leżą one w pakiecie `orders`, za `api.py`, który reeksportuje to, czego potrzebuje korzeń kompozycji. `django` zapisuje zamiast tego aplikację `orders` (models, services, views, urls), `settings.py` i główny `urls.py`, bez testu. `fastapi` zapisuje domenę `posts` z modułem dla każdej roli, pliki jądra `config.py`, `models.py` i `exceptions.py` oraz `main.py`, który dołącza router i odpowiada na `NotFound` z jądra kodem 404; każdy endpoint deklaruje podsumowanie, kod statusu, model odpowiedzi i odpowiedzi błędów, więc reguły FastAPI niczego nie znajdują. Ten scaffold też nie ma testu; `uv add fastapi uvicorn pydantic-settings` pozwala go uruchomić. Nigdy niczego nie zastępuje: jeśli na drodze stoi plik albo dowiązanie symboliczne, albo katalog prowadzi przez dowiązanie poza projekt, init kończy się kodem 2, wypisuje ścieżki i niczego nie zapisuje. Istniejący `__init__.py`, taki jak ten tworzony przez uv, zostaje bez zmian. Najpierw zapisywane są pliki, a `pyproject.toml` na końcu; jeśli zapis się nie uda, init usuwa to, co utworzył, więc to samo polecenie można uruchomić ponownie.
- **Kształty pakietów przychodzą z `--scaffold`.** Tabela dostaje wtedy także wpisy `[[tool.inwards.shape]]` ([Kształt pakietu](package-shape.md)) dla pakietów ze scaffoldu, więc ograniczone są też elementy, nie tylko importy. Sam pakiet może zawierać tylko swoje pakiety warstw, `bootstrap.py`, `__main__.py` i `_version.py` (który zapisują hatch-vcs i setuptools-scm), a w `hexagonal` `adapters/` zawiera tylko `inbound/` i `outbound/`: moduł obok nich nie należałby do żadnej warstwy, więc jest błędem INW007, a shape guard ([INW007](../rules/INW007.md)) odrzuca Write, który by go utworzył. W `clean` i `hexagonal` `application/` musi zawierać `ports/` i `use_cases/`, a wszystko inne jest tam tylko ostrzeżeniem. W `vertical-slices` `features/` zawiera tylko pakiety wycinków, a każdy wycinek musi mieć `api`; w `bounded-contexts` każdy kontekst musi mieć swoje cztery role; w `django` pakiet musi zawierać `settings.py` i `urls.py`, a każda aplikacja swoje cztery role, obok których dozwolone jest to, co zapisuje `startapp`; w `fastapi` pakiet musi zawierać `main.py` i może zawierać tylko domeny oraz typowe moduły jądra, a każda domena musi zawierać `__init__`, `router` i `service` i nic spoza ról szablonu; to błąd, bo taki moduł trafiłby do warstwy jądra. Same pakiety warstw nie mają kształtu, więc nowa encja, adapter czy przypadek użycia nigdy go nie naruszą. Brak wymaganego elementu to błąd INW008. Bez `--scaffold` kształty nie są zapisywane, bo opisują układ scaffoldu, a nie kod, który projekt już ma. `inwards init --list-styles` pokazuje kształty każdego presetu.
- **`--dry-run`** wypisuje każdą zmianę jako diff i niczego nie zapisuje. **`--agent`** łączy się z `--style`: `inwards init --style clean --agent claude` zapisuje warstwy i hooki Claude Code w jednym uruchomieniu. **`--brief`** zapisuje też do `AGENTS.md` [opis architektury](agents-md.md#the-architecture-brief-opt-in), podając preset i miejsce na jego porty.
- Po zapisie init uruchamia sprawdzenie w tym samym procesie i wypisuje powyższe drzewo. Bez `--scaffold` każdy pakiet warstwy jest oznaczony `(missing)` i nie przechodzi sprawdzenia, dopóki nie będzie miał modułu.

W terminalu `inwards init` bez `--style` i bez `--agent` zadaje pytania: o styl (podświetlony pokazuje swoje warstwy), o to, czy dodać scaffold, i o to, którego agenta podłączyć. Na koniec wypisuje to samo polecenie z flagami. Bez terminala (stdin albo stdout nie jest TTY albo ustawiono `CI`) nigdy nie czeka na dane: od razu kończy się kodem 2 i wypisuje flagi oraz style. Agenci uruchamiają init właśnie w ten sposób.

### Dowolny projekt: napisz tabelę ręcznie { #any-project-write-the-table-by-hand }

Dodaj `[tool.inwards]` do `pyproject.toml` projektu, który chcesz sprawdzać, zaczynając od najbardziej wewnętrznej warstwy:

<!-- e2e -->

```toml title="pyproject.toml"
[tool.inwards]
layers = [
  { name = "domain",         modules = ["shop.domain"] },
  { name = "application",    modules = ["shop.application"] },
  { name = "infrastructure", modules = ["shop.infrastructure"] },
]
```

Następnie sprawdź cały projekt:

<!-- e2e -->

```sh
inwards check
```

`All clear` z kodem wyjścia 0 oznacza, że każdy import wskazuje do środka. Przy kodzie wyjścia 1 polecenie wypisuje każde naruszenie z ponumerowanymi krokami naprawy, a kod wyjścia 2 to błąd użycia albo konfiguracji.

### Przejście z import-linter { #coming-from-import-linter }

`inwards import-config` zamienia kontrakty z `.importlinter`, `setup.cfg` albo `[tool.importlinter]` na `[tool.inwards]`, a `--write` dopisuje tabelę do `pyproject.toml`. Każdy kontrakt, którego nie dało się przenieść, trafia do raportu razem z powodem. Mapowanie opisuje [Migracja z import-linter](import-linter.md).

### Istniejący kod { #on-an-existing-codebase }

Kod, który już łamie swoje warstwy, nie przechodzi pierwszego sprawdzenia. Żeby mimo to wdrożyć Inwards, zaakceptuj to, co jest dziś, i blokuj tylko nowe naruszenia:

<!-- e2e -->

```sh
inwards baseline
git add inwards-baseline.json
```

`inwards baseline` sprawdza cały projekt w ramach jednej konfiguracji i zapisuje każde naruszenie do `inwards-baseline.json` obok jego `pyproject.toml`. Zacommituj ten plik: czytają go `inwards check`, hooki agentów i CI. W monorepo uruchom polecenie raz dla każdego pakietu, który ma własne `[tool.inwards]` (`inwards baseline --config packages/api/pyproject.toml`), bo każdy plik jest sprawdzany względem baseline'u leżącego obok jego konfiguracji. Zaakceptowany import może przenieść się do innej linii i nadal przechodzić, bo wpisy są dopasowywane po regule, module i komunikacie, bez zdania „Allowed direction” z komunikatu, więc dodanie warstwy nie sprawia, że wracają. Druga kopia tego samego importu w tym samym module nie przechodzi. Gdy sprawdzenie całego projektu stwierdzi, że zaakceptowanych naruszeń już nie ma, mówi o tym. Uruchom wtedy ponownie `inwards baseline`, żeby je usunąć. Z `--format json` i istniejącym baseline'em podsumowanie liczy jedno i drugie: `baselined` przy każdym uruchomieniu, `resolved` przy sprawdzeniu całego projektu. Agenci nie mogą edytować tego pliku ani uruchamiać tego polecenia: hooki Claude Code odrzucają jedno i drugie, a Stop gate oblewa sesję, która go zmieniła, i sprawdza pliki tej sesji zupełnie bez baseline'u.

Uruchom je też, zanim włączysz hooki agenta. Hooki Claude Code już traktują naruszenie, które plik miał na początku sesji, jako kontekst, a nie blokadę ([rozdział 4](../04-AI-Integration.md)), ale plik z niezacommitowanymi zmianami, zbyt duży, żeby hooki zachowały jego kopię (ponad 512 KiB albo ponad limit 4 MiB takich plików), nie ma znanej zawartości startowej, więc blokują wszystkie jego naruszenia, a agent, którego pcha się do ich naprawy, może przepisać kod niepotrzebny do zadania. Baseline utrzymuje też na zielono `inwards check` i CI.

Gdy projekt ma baseline, `stop-gate = "project"` w `[tool.inwards]` sprawia, że Stop gate w Claude Code sprawdza cały projekt względem baseline'u, a nie tylko pliki zmienione w sesji, więc naruszenie w dowolnym miejscu blokuje turę ([rozdział 4](../04-AI-Integration.md)). Sprawdzenie pomija parsowanie potwierdzające tam, gdzie baseline akceptuje wszystko, co znalazł prescan, więc w pełni pokryte baseline'em sprawdzenie kosztuje mniej więcej tyle, co czyste.

Następnie podłącz Inwards do swojego agenta: [Claude Code](claude-code.md), [OpenCode](opencode.md), [Aider](aider.md) albo dowolny agent czytający [AGENTS.md](agents-md.md). Żeby pull requesty łamiące warstwę nie przechodziły, dodaj workflow [GitHub Actions](ci.md).
