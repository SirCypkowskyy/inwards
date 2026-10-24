/**
 * @file INW014 `ports-abstract` (#295, from #98): a port module holds only
 * interfaces. A class there that is neither an ABC nor a Protocol, and
 * extends no class from a port module, is reported on its name; a method
 * whose body does more than a docstring, `...`, `pass` or
 * `raise NotImplementedError` is reported on its name. Exceptions, DTOs and
 * dataclasses pass by default. It is opt-in, checks modules with a `ports`
 * segment unless `modules` says otherwise, and a suppression hides it.
 */
import { describe, expect, test } from "bun:test";
import type { Diagnostic } from "../../src/index.ts";
import { Engine, parseConfig } from "../../src/index.ts";
import { file, grammars, indexOn } from "../support/helpers.ts";

const LAYERS = `[tool.inwards]
layers = [
  { name = "domain", modules = ["shop.domain"] },
  { name = "application", modules = ["shop.application"] },
  { name = "adapters", modules = ["shop.adapters"] },
]
`;

/** Where the checked port module lives unless a test says otherwise. */
const PORT = "shop/application/ports/users.py";

/**
 * Checks one module with a rules table.
 *
 * @param text - the module's source.
 * @param rules - the rules table and any options tables, TOML.
 * @param path - where the module lives.
 * @param layers - the `[tool.inwards]` table with its layers.
 * @returns every diagnostic.
 */
async function check(
  text: string,
  rules: string,
  path = PORT,
  layers = LAYERS,
): Promise<Diagnostic[]> {
  const engine = await Engine.create(grammars(), parseConfig(`${layers}\n${rules}\n`));
  const files = new Map([[path, text]]);
  const kinds = new Map<string, "file" | "dir">([[path, "file"]]);
  return engine.checkFiles([file(path, text)], indexOn(kinds, files));
}

/**
 * Checks a module with INW014 on and keeps its findings.
 *
 * @param text - the module's source.
 * @param options - the `[tool.inwards.rules.ports-abstract]` body, TOML.
 * @param path - where the module lives.
 * @returns `line:column message` for each INW014 finding.
 */
async function inw014(text: string, options = "", path = PORT): Promise<string[]> {
  const table = options === "" ? "" : `[tool.inwards.rules.ports-abstract]\n${options}\n`;
  const found = await check(
    text,
    `[tool.inwards.rules]\nextend-select = ["INW014"]\n${table}`,
    path,
  );
  return found.filter((d) => d.code === "INW014").map((d) => `${d.line}:${d.column} ${d.message}`);
}

const PROTOCOL = `from typing import Protocol

class UserRepository(Protocol):
    """Stores users."""

    def get(self, user_id: int) -> "User":
        """Loads one user."""
        ...

    def save(self, user: "User") -> None: ...
`;

const CONCRETE_METHOD = `from abc import ABC, abstractmethod

class UserRepository(ABC):
    @abstractmethod
    def get(self, user_id: int) -> "User":
        raise NotImplementedError

    def save(self, user: "User") -> None:
        self._db.add(user)
        self._db.commit()
`;

describe("INW014 ports-abstract", () => {
  test("is off by default", async () => {
    const found = await check(CONCRETE_METHOD, "");
    expect(found.filter((d) => d.code === "INW014")).toEqual([]);
  });

  test("a Protocol with ... bodies passes", async () => {
    expect(await inw014(PROTOCOL)).toEqual([]);
  });

  test("a concrete method body in application/ports/x.py fails, on the method's name", async () => {
    const found = await inw014(CONCRETE_METHOD);
    expect(found).toEqual([
      "8:9 `UserRepository.save` in port module `shop.application.ports.users` has a body that does work: line 9 runs `self._db.add(user)`. A port declares what adapters implement; its methods hold only a docstring, `...`, `pass` or `raise NotImplementedError`.",
    ]);
  });

  test("a class that is neither an ABC nor a Protocol fails, on its name", async () => {
    const text = `class SqlUserRepository:
    def get(self, user_id):
        return self.session.get(User, user_id)
`;
    const found = await inw014(text);
    expect(found).toEqual([
      "1:7 `SqlUserRepository` in port module `shop.application.ports.users` is neither an ABC nor a Protocol, and extends no class from a port module. A port module holds only the interfaces adapters implement.",
    ]);
  });

  test("metaclass=ABCMeta, abc.ABC, Protocol[T] and typing_extensions count", async () => {
    const text = `import abc
import typing_extensions
from abc import ABCMeta
from typing import Protocol, TypeVar

T = TypeVar("T")

class A(metaclass=ABCMeta):
    def run(self) -> None:
        pass

class B(abc.ABC):
    @property
    @abc.abstractmethod
    def name(self) -> str: ...

class C(Protocol[T]):
    def put(self, item: T) -> None:
        # comments don't count
        ...

class D(typing_extensions.Protocol):
    async def fetch(self) -> bytes:
        """Fetches."""
        raise NotImplementedError("adapters implement this")

class E[K](Protocol):
    def key(self) -> K: ...
`;
    expect(await inw014(text)).toEqual([]);
  });

  test("a narrower port passes; a subclass that implements a port is one finding on the class", async () => {
    const text = `from abc import ABC

class Repository(ABC):
    pass

class UserRepository(Repository):
    def save(self, user) -> None:
        ...

class InMemoryUsers(UserRepository):
    def __init__(self) -> None:
        self.rows = {}

    def save(self, user) -> None:
        self.rows[user.id] = user
`;
    expect(await inw014(text)).toEqual([
      "10:7 `InMemoryUsers` in port module `shop.application.ports.users` extends the port `UserRepository` and implements it: `__init__` (line 11) and `save` (line 14) do work. An implementation is an adapter; a port module holds only the interfaces adapters implement.",
    ]);
  });

  test("a Protocol's fix doesn't ask for a subclass or @abstractmethod", async () => {
    const text = PROTOCOL.replace('"""Loads one user."""\n        ...', "return User(user_id)");
    const found = await check(text, '[tool.inwards.rules]\nextend-select = ["INW014"]');
    const [finding] = found.filter((d) => d.code === "INW014");
    expect(finding?.fix?.steps.slice(0, 2)).toEqual([
      "Replace the body of `UserRepository.get` with `...`, keeping its docstring.",
      "Put the code in a class in `shop.adapters` (layer `adapters`) that has the methods of the Protocol `UserRepository` (it doesn't need to subclass it), and implement `get` there.",
    ]);
  });

  test("a base imported from another port module counts; one from elsewhere doesn't", async () => {
    const text = `from shop.application.ports.base import Repository
from .base import Unit
from shop.domain.model import Entity

class Users(Repository):
    def all(self): ...

class Work(Unit):
    def commit(self): ...

class Orders(Entity):
    def all(self): ...
`;
    const found = await inw014(text);
    expect(found.map((f) => f.split(" ").slice(0, 2).join(" "))).toEqual(["11:7 `Orders`"]);
    expect(found[0]).toContain("is neither an ABC nor a Protocol");
  });

  test("exceptions, DTOs and dataclasses pass by default", async () => {
    const text = `from dataclasses import dataclass
import enum
from typing import NamedTuple, TypedDict

from pydantic import BaseModel

class PortError(Exception):
    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason

class UserNotFound(PortError):
    pass

class Conflict(ValueError):
    pass

class UserDto(BaseModel):
    name: str

    def display(self) -> str:
        return self.name.title()

@dataclass(frozen=True)
class Page:
    size: int

    def next(self) -> "Page":
        return Page(self.size)

class Point(NamedTuple):
    x: int

class Row(TypedDict):
    id: int

class Status(enum.Enum):
    ACTIVE = "active"
`;
    expect(await inw014(text)).toEqual([]);
  });

  test("allow-bases replaces the default and extend-allow-bases adds to it", async () => {
    const text = `from shop.domain.model import Entity

class PortError(Exception):
    pass

class User(Entity):
    def name(self):
        return "x"
`;
    expect(await inw014(text, 'extend-allow-bases = ["shop.domain.*"]')).toEqual([]);
    const replaced = await inw014(text, 'allow-bases = ["shop.domain.*"]');
    expect(replaced.map((f) => f.split(" ").slice(0, 2).join(" "))).toEqual(["3:7 `PortError`"]);
  });

  test("allow-decorators replaces the decorator list", async () => {
    const text = `from dataclasses import dataclass

@dataclass
class Page:
    size: int
`;
    const found = await inw014(text, 'allow-decorators = ["attrs.define"]');
    expect(found.map((f) => f.split(" ").slice(0, 2).join(" "))).toEqual(["4:7 `Page`"]);
  });

  test("only modules with a ports segment are checked unless modules is set", async () => {
    const concrete = "class Service:\n    def run(self):\n        return 1\n";
    expect(await inw014(concrete, "", "shop/application/services.py")).toEqual([]);
    expect(await inw014(concrete, "", "shop/application/ports/__init__.py")).toHaveLength(1);
    const scoped = 'modules = ["shop.application.interfaces"]';
    expect(await inw014(concrete, scoped, "shop/application/interfaces/repo.py")).toHaveLength(1);
    expect(await inw014(concrete, scoped, PORT)).toEqual([]);
  });

  test("with modules set, a base counts when its module is in them", async () => {
    const text = `from shop.application.interfaces.base import Repo

class Users(Repo):
    def all(self): ...
`;
    const scoped = 'modules = ["shop.application.interfaces"]';
    expect(await inw014(text, scoped, "shop/application/interfaces/users.py")).toEqual([]);
  });

  test("the fix names the adapter layer's module", async () => {
    const found = await check(CONCRETE_METHOD, '[tool.inwards.rules]\nextend-select = ["INW014"]');
    const [finding] = found.filter((d) => d.code === "INW014");
    expect(finding?.fix?.summary).toBe(
      "Move the body of `UserRepository.save` to an implementation in `shop.adapters` (layer `adapters`), and leave `...` here.",
    );
    expect(finding?.fix?.steps).toMatchSnapshot();
  });

  test("the fix prefers an outbound adapter layer, and says what to do without one", async () => {
    const hexagonal = `[tool.inwards]
layers = [
  { name = "domain", modules = ["shop.domain"] },
  { name = "application", modules = ["shop.application"] },
  { name = "inbound-adapters", modules = ["shop.adapters.inbound"] },
  { name = "outbound-adapters", modules = ["shop.adapters.outbound"] },
]
`;
    const rules = '[tool.inwards.rules]\nextend-select = ["INW014"]';
    const [out] = await check("class Repo:\n    pass\n", rules, PORT, hexagonal);
    expect(out?.fix?.summary).toBe(
      "Move `Repo` to `shop.adapters.outbound` (layer `outbound-adapters`), and leave an ABC or Protocol here.",
    );
    const bare = `[tool.inwards]
layers = [
  { name = "domain", modules = ["shop.domain"] },
  { name = "application", modules = ["shop.application"] },
]
`;
    const [none] = await check("class Repo:\n    pass\n", rules, PORT, bare);
    expect(none?.fix?.summary).toBe(
      "Move `Repo` to an adapter module outside the ports package, and leave an ABC or Protocol here.",
    );
  });

  test("an inline suppression hides it", async () => {
    const text = CONCRETE_METHOD.replace(
      'def save(self, user: "User") -> None:',
      'def save(self, user: "User") -> None:  # inwards: ignore[INW014] reason="template method, moving out"',
    );
    expect(await inw014(text)).toEqual([]);
  });
});

describe('INW014 interface = "protocol"', () => {
  const AbcPort = `from abc import ABC, abstractmethod

class UserRepository(ABC):
    @abstractmethod
    def get(self, user_id: int) -> "User": ...
`;

  test("an ABC port passes with the defaults and is reported on its name with the option", async () => {
    expect(await inw014(AbcPort)).toEqual([]);
    const found = await check(
      AbcPort,
      '[tool.inwards.rules]\nextend-select = ["INW014"]\n[tool.inwards.rules.ports-abstract]\ninterface = "protocol"',
    );
    const [finding] = found.filter((d) => d.code === "INW014");
    expect(`${finding?.line}:${finding?.column} ${finding?.message}`).toBe(
      '3:7 `UserRepository` in port module `shop.application.ports.users` is an ABC; ports here are `typing.Protocol` classes (`interface = "protocol"`), which adapters implement by their shape.',
    );
    expect(finding?.fix?.steps[0]).toBe(
      "Replace `ABC` with `Protocol` (from `typing`) among the bases of `UserRepository`, and drop `@abstractmethod` from its methods: it matters only to subclasses.",
    );
  });

  test("metaclass=ABCMeta counts as an ABC; a Protocol passes", async () => {
    const meta =
      "from abc import ABCMeta\n\nclass Repo(metaclass=ABCMeta):\n    def get(self): ...\n";
    expect(await inw014(meta, 'interface = "protocol"')).toHaveLength(1);
    expect(await inw014(PROTOCOL, 'interface = "protocol"')).toEqual([]);
  });

  test("a port that extends a port without listing Protocol is reported; one that lists it passes", async () => {
    const text = `from typing import Protocol

class Repository(Protocol):
    def all(self) -> list[object]: ...

class Users(Repository):
    def by_email(self, email: str) -> object: ...

class Orders(Repository, Protocol):
    def by_user(self, user_id: int) -> list[object]: ...
`;
    expect(await inw014(text)).toEqual([]);
    expect(await inw014(text, 'interface = "protocol"')).toEqual([
      '6:7 `Users` in port module `shop.application.ports.users` extends the port `Repository` but doesn\'t list `Protocol` among its own bases, so the type checker treats it as a regular class; ports here are `typing.Protocol` classes (`interface = "protocol"`).',
    ]);
  });

  test("an implementation in a port module is reported once, as an implementation", async () => {
    const text = `from typing import Protocol

class Repository(Protocol):
    def all(self) -> list[object]: ...

class InMemory(Repository):
    def all(self) -> list[object]:
        return []
`;
    const found = await inw014(text, 'interface = "protocol"');
    expect(found).toHaveLength(1);
    expect(found[0]).toContain("and implements it");
  });
});

describe("INW014 allow-subclassing = false", () => {
  const Adapter = "shop/adapters/users.py";
  const Off = "allow-subclassing = false";

  const Subclass = `import shop.application.ports.orders
from shop.application.ports.users import UserRepository
from shop.application.ports import audit as ports_audit
from shop.domain.model import Entity

class SqlUsers(UserRepository, Entity):
    def get(self, user_id):
        return None

class SqlOrders(shop.application.ports.orders.OrderRepository):
    pass

class Audit(ports_audit.AuditLog):
    pass
`;

  test("an adapter that subclasses a port passes with the defaults", async () => {
    expect(await inw014(Subclass, "", Adapter)).toEqual([]);
  });

  test("each port among an adapter's bases is reported on that base", async () => {
    expect(await inw014(Subclass, Off, Adapter)).toEqual([
      "6:16 `SqlUsers` in `shop.adapters.users` subclasses the port `UserRepository` from `shop.application.ports.users`. Ports here are implemented by shape (`allow-subclassing = false`): a subclass inherits the port's default bodies, and a missing method shows up only when the adapter is built.",
      "10:17 `SqlOrders` in `shop.adapters.users` subclasses the port `OrderRepository` from `shop.application.ports.orders`. Ports here are implemented by shape (`allow-subclassing = false`): a subclass inherits the port's default bodies, and a missing method shows up only when the adapter is built.",
      "13:13 `Audit` in `shop.adapters.users` subclasses the port `AuditLog` from `shop.application.ports.audit`. Ports here are implemented by shape (`allow-subclassing = false`): a subclass inherits the port's default bodies, and a missing method shows up only when the adapter is built.",
    ]);
  });

  test("the fix removes the base and adds a conformance line", async () => {
    const found = await check(
      Subclass,
      `[tool.inwards.rules]\nextend-select = ["INW014"]\n[tool.inwards.rules.ports-abstract]\n${Off}`,
      Adapter,
    );
    const [first] = found.filter((d) => d.code === "INW014");
    expect(first?.fix?.steps).toEqual([
      "Remove `UserRepository` from the bases of `SqlUsers`, and keep the methods it implements.",
      "Add `_: UserRepository = SqlUsers(...)` under `if TYPE_CHECKING:` (from `typing`) at the end of the module, importing `UserRepository` there, so the type checker checks `SqlUsers` against the port.",
    ]);
  });

  test("an exception from a port module, a port's own subclasses and test modules pass", async () => {
    const errors = `from shop.application.ports.users import UserNotFoundError

class MissingUser(UserNotFoundError):
    pass
`;
    expect(await inw014(errors, Off, Adapter)).toEqual([]);
    const narrower = `from typing import Protocol
from shop.application.ports.base import Repository

class Users(Repository, Protocol):
    def all(self): ...
`;
    expect(await inw014(narrower, Off)).toEqual([]);
    expect(await inw014(Subclass, Off, "tests/test_users.py")).toEqual([]);
  });

  test("a Protocol outside the port modules may extend a port; a class that isn't one may not", async () => {
    const text = `from typing import Protocol
import typing
from shop.application.ports.users import UserRepository

class UserReader(UserRepository, Protocol):
    def all(self): ...

class UserLister(UserRepository, typing.Protocol[int]):
    def list(self): ...

class SqlUsers(UserRepository):
    pass
`;
    expect(await inw014(text, Off, "shop/application/services/users.py")).toEqual([
      "11:16 `SqlUsers` in `shop.application.services.users` subclasses the port `UserRepository` from `shop.application.ports.users`. Ports here are implemented by shape (`allow-subclassing = false`): a subclass inherits the port's default bodies, and a missing method shows up only when the adapter is built.",
    ]);
  });

  test("a base from a module that isn't a port passes", async () => {
    const text = "from shop.domain.model import Entity\n\nclass User(Entity):\n    pass\n";
    expect(await inw014(text, Off, Adapter)).toEqual([]);
  });
});
