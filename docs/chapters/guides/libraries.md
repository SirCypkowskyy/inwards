# Libraries per layer

Layer rules (INW001) only look at your own code, so `from sqlalchemy.orm import Session` in the domain passes them, even though it ties the domain to a database as firmly as `import shop.infrastructure.db` would. INW005 `pure-domain` says which libraries each layer may import, and ships a default that keeps frameworks and I/O out of the innermost layer.

## What it checks

Every import of a file in a layer is sorted into one of three kinds:

- **first-party**: a layer owns it, or it is a module of your project (the same probe INW006 uses, so a top-level `redis/` package of your own is yours, not the library). INW001 and INW006 handle these; INW005 never reports them.
- **standard library**: its top-level name is in the bundled list, `sys.stdlib_module_names` of CPython 3.11 to 3.14 plus the modules older versions still had.
- **third-party**: everything else.

The import is checked wherever it is: top level, inside a function, behind `if TYPE_CHECKING:`, and in dynamic imports with a literal target (`importlib.import_module("requests")`, `exec("import socket")`), as INW001 and INW011 check them.

## Configure it

Three optional keys on a layer, each a list of import names: dotted Python identifiers such as `sqlalchemy` or `http.client`. An entry covers the module and everything below it: `sqlalchemy` covers `sqlalchemy.orm.Session`, `http.client` covers `http.client.HTTPConnection` but not `http.HTTPStatus`. Globs (`sqlalchemy.*`) and distribution names (`python-dateutil`, which imports as `dateutil`) are config errors, since they would match nothing.

- `allow-libraries`: once set, the layer may import only these third-party libraries. The standard library stays allowed.
- `deny-libraries`: the layer may not import these, standard library included. On the innermost layer it replaces the default deny list.
- `extend-deny-libraries`: adds these to the layer's deny list, standard library included. The list it adds to is `deny-libraries` when the layer sets it, else the default deny list on the innermost of two or more layers, else nothing, so on any other layer it works like `deny-libraries`. Repeated entries and entries already in the list are harmless.

When the allow and deny lists both name a module, the longer entry wins (`deny-libraries = ["os"]` with `allow-libraries = ["os.path"]` allows `os.path` only), and `allow` wins a tie. So `allow-libraries = ["http"]` does not undo the default's longer `http.client`; `allow-libraries = ["http.client"]` does. Without any of the three keys a layer may import any library, except the innermost layer of a config with two or more layers, which gets the default deny list below.

!!! warning "`deny-libraries` on the innermost layer replaces the default"
    It does not add to it. `deny-libraries = ["pydantic"]` on the domain denies `pydantic` and nothing else: SQLAlchemy, Requests and the rest of the default are allowed again. To deny one more library and keep the default, use `extend-deny-libraries = ["pydantic"]`, which also picks up entries later versions add to the default. `deny-libraries = []` turns the default off. To allow one default entry, add it to `allow-libraries` instead, which keeps the rest. `allow-libraries` wins over `extend-deny-libraries` by the same longest-entry rule.

<!-- e2e -->

```toml title="pyproject.toml"
[tool.inwards]
layers = [
  { name = "domain",         modules = ["shop.domain"], allow-libraries = ["attrs"], extend-deny-libraries = ["os"] },
  { name = "application",    modules = ["shop.application"], deny-libraries = ["sqlalchemy", "requests"] },
  { name = "infrastructure", modules = ["shop.infrastructure"] },
]
```

<!-- e2e -->

```sh
inwards check
```

Here the domain may use `attrs` and the standard library, minus the default deny list and `os`; the application may use any library except SQLAlchemy and Requests; the infrastructure may use anything. A value that isn't a list of module names, or an unknown key, is a config error (exit 2), and the [config guard](../04-AI-Integration.md#stopping-the-agent-from-gaming-the-check) denies an agent's edit to any of the three keys like the rest of `[tool.inwards]`.

### The default deny list

Frameworks and servers: `django`, `fastapi`, `flask`, `litestar`, `starlette`, `celery`, `grpc`. Databases and ORMs: `sqlalchemy`, `sqlmodel`, `alembic`, `peewee`, `psycopg`, `psycopg2`, `asyncpg`, `pymysql`, `pymongo`, `redis`, `sqlite3`. Network clients: `requests`, `httpx`, `aiohttp`, `urllib3`, `boto3`, `botocore`, `pika`. Standard-library I/O: `socket`, `subprocess`, `http.client`, `http.server`, `urllib.request`, `smtplib`, `ftplib`.

Pure standard-library modules stay allowed: `dataclasses`, `typing`, `datetime`, `decimal`, `enum`, `urllib.parse`, `http.HTTPStatus`. So do `os` and `pathlib`; add them to `extend-deny-libraries` if your domain must not touch the file system either.

## What the agent sees

The message names the layer, the import and the library's top-level package, never the lists, so a [baseline](install.md#on-an-existing-codebase) entry survives a change to them. The fix names the entry that denied the import, whichever list it comes from (`http.client` for `from http.client import HTTPConnection`; the top-level package when the import is outside `allow-libraries`), the port to introduce, and every outer layer allowed to use the library. The agent picks the one that holds adapters: in a hexagonal layout that isn't always the next layer out.

```text
shop/domain/order.py:3:28: INW005 Layer "domain" imports "sqlalchemy.orm.Session" from library "sqlalchemy", which "domain" may not use.
  fix: Use "sqlalchemy" in an outer layer, behind a port owned by "domain".
    1. Delete `from sqlalchemy.orm import Session`. Do not move the import into a function, behind TYPE_CHECKING or into importlib; Inwards checks those too.
    2. Declare a typing.Protocol in `shop.domain` (for example `shop.domain.ports`) that describes only what this module needs from "sqlalchemy".
    3. Type this module against that Protocol and receive the implementation through a constructor or function parameter.
    4. Implement the Protocol with "sqlalchemy" in the outer layer that holds adapters (allowed: "infrastructure"), and wire it in the outermost layer (the composition root).
    5. If "domain" should be allowed to use "sqlalchemy", ask the user to add "sqlalchemy" to that layer's allow-libraries in [tool.inwards]. Don't edit [tool.inwards] yourself.
```

When no outer layer may use the library either, the fix keeps steps 1 and 5 and tells the agent to ask the user where the library belongs.

## Not covered yet

Distribution names that differ from the import name (`PyYAML` is `yaml`) are not mapped: list the import name. The standard-library list is fixed at build time, so a module added in a later CPython counts as third-party until Inwards updates the list.
