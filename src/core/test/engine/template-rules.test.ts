/**
 * @file The acceptance test of template rules (#298, from #98): a FastAPI
 * project whose template turns INW012, INW013 and INW016 on per role gives
 * exactly the diagnostics of the hand-written selector config, pinned by a
 * snapshot. The same blocking call outside the role stays quiet, which shows
 * the role, not the whole project, is the rule's scope.
 */
import { expect, test } from "bun:test";
import type { Diagnostic } from "../../src/index.ts";
import { Engine, parseConfig } from "../../src/index.ts";
import { file, grammars, indexOn } from "../support/helpers.ts";

const LAYERS = `[tool.inwards]
layers = [
  { name = "core", modules = ["src.database"] },
  { name = "domain", modules = ["src.*"], template = "domain" },
]
`;

const TEMPLATED = `${LAYERS}
[tool.inwards.templates.domain]
roles = ["models", "service", "router"]

[tool.inwards.templates.domain.rules]
router = { async-blocking = true, thin-endpoint = { max-statements = 2 } }
models = { orm-naming = "warning" }
`;

const HAND = `[tool.inwards]
layers = [
  { name = "core", modules = ["src.database"] },
  { name = "domain.models", modules = ["src.*.models"] },
  { name = "domain.service", modules = ["src.*.service"] },
  { name = "domain.router", modules = ["src.*.router"] },
]

[tool.inwards.rules]
extend-select = ["INW012", "INW013", "INW016"]
severity = { INW016 = "warning" }

[tool.inwards.rules.async-blocking]
modules = ["src.*.router"]

[tool.inwards.rules.thin-endpoint]
modules = ["src.*.router"]
max-statements = 2

[tool.inwards.rules.orm-naming]
modules = ["src.*.models"]
`;

const BLOCKING = `from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from src.database import get_db

router = APIRouter()


@router.get("/{item_id}")
async def get_item(item_id: int, db: Annotated[Session, Depends(get_db)]):
    db.execute("select 1")
    total = item_id + 1
    total += 1
    return total
`;

const MODELS = `from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class Order(Base):
    __tablename__ = "Orders"
    id: Mapped[int] = mapped_column(primary_key=True)
`;

const SERVICE = `from sqlalchemy.orm import Session


async def load(db: Session):
    return db.execute("select 1")
`;

/** The project: two domains, each with a blocking router, a model and a service. */
const FILES: Readonly<Record<string, string>> = {
  "src/__init__.py": "",
  "src/database.py": "def get_db():\n    yield None\n",
  "src/orders/__init__.py": "",
  "src/orders/router.py": BLOCKING,
  "src/orders/models.py": MODELS,
  "src/orders/service.py": SERVICE,
  "src/users/__init__.py": "",
  "src/users/router.py": BLOCKING,
  "src/users/models.py": MODELS.replace('"Orders"', '"user"').replace("Order", "User"),
  "src/users/service.py": SERVICE,
};

/**
 * Checks every file of the project with a config.
 *
 * @param config - the pyproject text.
 * @returns `code path:line severity message`, one line per finding.
 */
async function checkAll(config: string): Promise<string[]> {
  const engine = await Engine.create(grammars(), parseConfig(config));
  const texts = new Map(Object.entries(FILES));
  const disk = new Map<string, "file" | "dir">();
  for (const rel of texts.keys()) {
    const parts = rel.split("/");
    for (let i = 1; i < parts.length; i += 1) {
      disk.set(parts.slice(0, i).join("/"), "dir");
    }
    disk.set(rel, "file");
  }
  const sources = [...texts].map(([path, text]) => file(path, text));
  const found: Diagnostic[] = await engine.checkFiles(sources, indexOn(disk, texts));
  return found.map((d) => `${d.code} ${d.file}:${d.line} ${d.severity} ${d.message}`).sort();
}

test("template rules give the diagnostics of the hand-written selector config", async () => {
  expect(parseConfig(TEMPLATED)).toEqual(parseConfig(HAND));
  const templated = await checkAll(TEMPLATED);
  expect(await checkAll(HAND)).toEqual(templated);
  expect(templated.some((line) => line.startsWith("INW013 src/orders/router.py"))).toBe(true);
  expect(templated.some((line) => line.startsWith("INW012 src/users/router.py"))).toBe(true);
  expect(templated.some((line) => line.startsWith("INW016 src/orders/models.py"))).toBe(true);
  expect(templated.filter((line) => line.includes("/service.py"))).toEqual([]);
  expect(templated).toMatchSnapshot();
});
