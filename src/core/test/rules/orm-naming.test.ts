/**
 * @file INW016 `orm-naming` (#297, from #98): table names and the names of
 * datetime and date columns follow the project's scheme. By default that is
 * fastapi-best-practices' scheme: lower_case_snake singular tables, `_at`
 * for datetimes and `_date` for dates. SQLAlchemy `__tablename__`,
 * `Table(...)`, `Mapped[...]`, `mapped_column` and `Column`, SQLModel table
 * classes and Django's `Meta.db_table` and date fields are read. A whole-project
 * run also reports a project with tables and no `MetaData(naming_convention=...)`.
 * It is opt-in, `modules` narrows it, and a suppression hides it.
 */
import { describe, expect, test } from "bun:test";
import type { Diagnostic } from "../../src/index.ts";
import { Engine, parseConfig } from "../../src/index.ts";
import { isSnake, singularOf, toSnake, withSuffix } from "../../src/rules/orm-naming/names.ts";
import { file, grammars, indexOn } from "../support/helpers.ts";

const LAYERS = `[tool.inwards]
layers = [
  { name = "domain", modules = ["shop.domain"] },
  { name = "infrastructure", modules = ["shop.infrastructure"] },
]
`;

const HEAD = `from datetime import date, datetime

from sqlalchemy import Column, Date, DateTime, MetaData, Table
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

`;

/** The path most cases check. */
const MODELS = "shop/infrastructure/models.py";

/**
 * Checks some files with a rules table.
 *
 * @param files - file text by path.
 * @param rules - the rules table and any options tables, TOML.
 * @param whole - true for a whole-project run.
 * @returns every diagnostic.
 */
async function check(
  files: Readonly<Record<string, string>>,
  rules: string,
  whole = false,
): Promise<Diagnostic[]> {
  const engine = await Engine.create(grammars(), parseConfig(`${LAYERS}\n${rules}\n`));
  const texts = new Map(Object.entries(files));
  const kinds = new Map<string, "file" | "dir">([...texts.keys()].map((p) => [p, "file"]));
  const sources = [...texts].map(([path, text]) => file(path, text));
  return engine.check(sources, indexOn(kinds, texts), undefined, { whole }).diagnostics;
}

/**
 * Checks files with INW016 on and keeps its findings.
 *
 * @param files - file text by path.
 * @param options - the `[tool.inwards.rules.orm-naming]` body, TOML.
 * @param whole - true for a whole-project run.
 * @returns `path:line:column message` for each INW016 finding.
 */
async function inw016(
  files: Readonly<Record<string, string>>,
  options = "",
  whole = false,
): Promise<string[]> {
  const table = `[tool.inwards.rules.orm-naming]\n${options}\n`;
  const found = await check(
    files,
    `[tool.inwards.rules]\nextend-select = ["INW016"]\n${table}`,
    whole,
  );
  return found
    .filter((d) => d.code === "INW016")
    .map((d) => `${d.file}:${d.line}:${d.column} ${d.message}`);
}

/**
 * Checks `MODELS` alone, after `HEAD`.
 *
 * @param body - the module after `HEAD`.
 * @param options - the options table's body.
 * @returns the findings, as `inw016` gives them, without the path.
 */
async function models(body: string, options = ""): Promise<string[]> {
  const found = await inw016({ [MODELS]: `${HEAD}${body}` }, options);
  return found.map((line) => line.slice(MODELS.length + 1));
}

/** The line in `HEAD` + body where a body's first line lands. */
const FIRST: number = HEAD.split("\n").length;

const FASTAPI_BAD = `class Base(DeclarativeBase):
    pass


class Post(Base):
    __tablename__ = "posts"

    id: Mapped[int] = mapped_column(primary_key=True)
    created: Mapped[datetime]
`;

const FASTAPI_GOOD = `class Base(DeclarativeBase):
    metadata = MetaData(naming_convention={"pk": "%(table_name)s_pkey"})


class Post(Base):
    __tablename__ = "post"

    id: Mapped[int] = mapped_column(primary_key=True)
    created_at: Mapped[datetime]
    published_date: Mapped[date | None]
`;

describe("INW016 orm-naming", () => {
  test("is off unless selected", async () => {
    const found = await check({ [MODELS]: `${HEAD}${FASTAPI_BAD}` }, "");
    expect(found.filter((d) => d.code === "INW016")).toEqual([]);
  });

  test("the fastapi fixture: a plural table and a datetime without _at fail", async () => {
    expect(await models(FASTAPI_BAD)).toEqual([
      `${FIRST + 5}:21 Table name "posts" is plural; this project names tables in the singular: "post".`,
      `${FIRST + 8}:5 Datetime column \`created\` doesn't end with \`_at\`: name it \`created_at\`.`,
    ]);
  });

  test("the fixed fixture passes, a whole-project run included", async () => {
    expect(await models(FASTAPI_GOOD)).toEqual([]);
    expect(await inw016({ [MODELS]: `${HEAD}${FASTAPI_GOOD}` }, "", true)).toEqual([]);
  });

  test("the fix renames through a migration", async () => {
    const found = await check(
      { [MODELS]: `${HEAD}${FASTAPI_BAD}` },
      '[tool.inwards.rules]\nextend-select = ["INW016"]',
    );
    expect(found.filter((d) => d.code === "INW016").map((d) => d.fix)).toMatchSnapshot();
  });

  test("table names: not snake case, Table(...), plural forms, allow-tables", async () => {
    const body = `class A(Base):
    __tablename__ = "UserAccount"


class B(Base):
    __tablename__ = "categories"


class C(Base):
    __tablename__ = "address"


class D(Base):
    __tablename__ = "news"


class E(Base):
    __tablename__ = "status"


tags = Table("post_tags", Base.metadata, Column("post_id"))
people = Table("people", Base.metadata)
`;
    expect(await models(body, 'allow-tables = ["news"]')).toEqual([
      `${FIRST + 1}:21 Table name "UserAccount" isn't lower_case_snake: "user_account".`,
      `${FIRST + 5}:21 Table name "categories" is plural; this project names tables in the singular: "category".`,
      `${FIRST + 20}:14 Table name "post_tags" is plural; this project names tables in the singular: "post_tag".`,
      `${FIRST + 21}:16 Table name "people" is plural; this project names tables in the singular: "person".`,
    ]);
  });

  test('table-name = "snake" accepts plurals, false turns the check off', async () => {
    const body = `class A(Base):
    __tablename__ = "posts"


class B(Base):
    __tablename__ = "Bad-Name"
`;
    expect(await models(body, 'table-name = "snake"')).toEqual([
      `${FIRST + 5}:21 Table name "Bad-Name" isn't lower_case_snake: "bad_name".`,
    ]);
    expect(await models(body, "table-name = false")).toEqual([]);
  });

  test("columns: mapped_column and Column types, explicit names, Optional", async () => {
    const body = `from typing import Optional

import sqlalchemy as sa


class Event(Base):
    __tablename__ = "event"

    starts: Mapped[Optional[datetime]] = mapped_column(sa.DateTime(timezone=True))
    ends_at = Column(DateTime)
    day = Column(Date, nullable=False)
    stamp = mapped_column(sa.TIMESTAMP)
    _hidden: Mapped[datetime] = mapped_column("removed", DateTime)
    renamed: Mapped[datetime] = mapped_column("updated_at")
    birthday: Mapped[date]
    due_date: Mapped[datetime]
    title: Mapped[str]
    count = Column(sa.Integer)


log = Table("log", Base.metadata, Column("logged", DateTime), Column("logged_at", DateTime))
`;
    expect(await models(body)).toEqual([
      `${FIRST + 8}:5 Datetime column \`starts\` doesn't end with \`_at\`: name it \`starts_at\`.`,
      `${FIRST + 10}:5 Date column \`day\` doesn't end with \`_date\`: name it \`day_date\`.`,
      `${FIRST + 11}:5 Datetime column \`stamp\` doesn't end with \`_at\`: name it \`stamp_at\`.`,
      `${FIRST + 12}:47 Datetime column \`removed\` doesn't end with \`_at\`: name it \`removed_at\`.`,
      `${FIRST + 14}:5 Date column \`birthday\` doesn't end with \`_date\`: name it \`birthday_date\`.`,
      `${FIRST + 15}:5 Datetime column \`due_date\` doesn't end with \`_at\`: name it \`due_at\`.`,
      `${FIRST + 20}:42 Datetime column \`logged\` doesn't end with \`_at\`: name it \`logged_at\`.`,
    ]);
  });

  test("configured suffixes, and false to turn one off", async () => {
    const body = `class Event(Base):
    __tablename__ = "event"

    created_at: Mapped[datetime]
    created_on: Mapped[date]
    starts_at: Mapped[date]
`;
    expect(await models(body, 'datetime-suffix = "_ts"\ndate-suffix = "_on"')).toEqual([
      `${FIRST + 3}:5 Datetime column \`created_at\` doesn't end with \`_ts\`: name it \`created_ts\`.`,
      `${FIRST + 5}:5 Date column \`starts_at\` doesn't end with \`_on\`: name it \`starts_on\`.`,
    ]);
    expect(await models(body, "datetime-suffix = false\ndate-suffix = false")).toEqual([]);
  });

  test("SQLModel: a table class's derived name and its datetime fields", async () => {
    const body = `from sqlmodel import Field, SQLModel


class Heroes(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    created: datetime = Field(default_factory=datetime.now)


class HeroRead(SQLModel):
    created: datetime


class Team(SQLModel, table=True):
    __tablename__ = "team"
    founded: date
`;
    expect(await models(body)).toEqual([
      `${FIRST + 3}:7 Table name "heroes", which SQLModel derives from the class name \`Heroes\`, is plural; this project names tables in the singular: "hero".`,
      `${FIRST + 5}:5 Datetime column \`created\` doesn't end with \`_at\`: name it \`created_at\`.`,
      `${FIRST + 14}:5 Date column \`founded\` doesn't end with \`_date\`: name it \`founded_date\`.`,
    ]);
  });

  test("Django: Meta.db_table and date fields, db_column wins", async () => {
    const body = `from django.db import models


class Article(models.Model):
    published = models.DateTimeField()
    edited = models.DateTimeField(db_column="edited_at")
    issue = models.DateField(db_column="issue")

    class Meta:
        db_table = "articles"
`;
    expect(await models(body)).toEqual([
      `${FIRST + 4}:5 Datetime column \`published\` doesn't end with \`_at\`: name it \`published_at\`.`,
      `${FIRST + 6}:40 Date column \`issue\` doesn't end with \`_date\`: name it \`issue_date\`.`,
      `${FIRST + 9}:20 Table name "articles" is plural; this project names tables in the singular: "article".`,
    ]);
  });

  test("names that aren't SQLAlchemy's or literals are left alone", async () => {
    const body = `NAME = "posts"


class Plain:
    created: datetime
    when = Column(DateTime)


class Post(Base):
    __tablename__ = NAME.upper()
`;
    // A plain class's annotation isn't a column; Column(DateTime) is, whatever the class.
    expect(await models(body)).toEqual([
      `${FIRST + 5}:5 Datetime column \`when\` doesn't end with \`_at\`: name it \`when_at\`.`,
    ]);
  });

  test("modules narrows the rule, and a suppression hides a finding", async () => {
    const found = await inw016(
      {
        [MODELS]: `${HEAD}${FASTAPI_BAD}`,
        "shop/domain/models.py": `${HEAD}class X(Base):\n    __tablename__ = "orders"  # inwards: ignore[INW016] reason="legacy table"\n\n\nclass Y(Base):\n    __tablename__ = "items"\n`,
      },
      'modules = ["shop.domain"]',
    );
    expect(found).toEqual([
      `shop/domain/models.py:${FIRST + 5}:21 Table name "items" is plural; this project names tables in the singular: "item".`,
    ]);
  });

  test("a whole-project run reports a missing naming convention once, on the first table", async () => {
    const files = {
      "shop/infrastructure/a.py": `${HEAD}class Base(DeclarativeBase):\n    pass\n`,
      "shop/infrastructure/b.py": `${HEAD}class Post(Base):\n    __tablename__ = "post"\n`,
      "shop/infrastructure/c.py": `${HEAD}class Tag(Base):\n    __tablename__ = "tag"\n`,
    };
    expect(await inw016(files, "", true)).toEqual([
      `shop/infrastructure/b.py:${FIRST + 1}:21 No \`MetaData(naming_convention=...)\` in the project, so SQLAlchemy leaves unique, check, foreign key and primary key constraints unnamed and the database picks their names.`,
    ]);
    expect(await inw016(files, "require-naming-convention = false", true)).toEqual([]);
    expect(await inw016(files)).toEqual([]);
  });

  test("a naming convention anywhere in the project counts, in or out of modules", async () => {
    const tables = `${HEAD}class Post(Base):\n    __tablename__ = "post"\n`;
    const set = {
      "shop/infrastructure/db.py": `from sqlmodel import SQLModel\n\nSQLModel.metadata.naming_convention = {"pk": "pk_%(table_name)s"}\n`,
      "shop/domain/models.py": tables,
    };
    expect(await inw016(set, 'modules = ["shop.domain"]', true)).toEqual([]);
    const call = {
      "shop/infrastructure/db.py":
        "import sqlalchemy as sa\n\nmetadata = sa.MetaData(naming_convention=CONVENTION)\n",
      "shop/domain/models.py": tables,
    };
    expect(await inw016(call, "", true)).toEqual([]);
    const django = {
      "shop/domain/models.py": `from django.db import models\n\n\nclass A(models.Model):\n    class Meta:\n        db_table = "a"\n`,
    };
    expect(await inw016(django, "", true)).toEqual([]);
  });
});

describe("INW016's naming heuristics", () => {
  test.each([
    ["posts", "post"],
    ["post_likes", "post_like"],
    ["categories", "category"],
    ["movies", "movie"],
    ["addresses", "address"],
    ["statuses", "status"],
    ["houses", "house"],
    ["boxes", "box"],
    ["batches", "batch"],
    ["heroes", "hero"],
    ["children", "child"],
    ["post", undefined],
    ["status", undefined],
    ["address", undefined],
    ["analysis", undefined],
    ["analytics", undefined],
    ["news", undefined],
    ["user_alias", undefined],
    ["gps", undefined],
  ])("%s reads as singular %p", (name, singular) => {
    expect(singularOf(name)).toBe(singular);
  });

  test.each([
    ["UserAccount", "user_account"],
    ["HTTPLog", "http_log"],
    ["user-account", "user_account"],
    ["Order Items", "order_items"],
  ])("%s in snake case is %s", (name, snake) => {
    expect([isSnake(name), toSnake(name)]).toEqual([false, snake]);
  });

  test.each([
    ["created", "_at", "created_at"],
    ["due_date", "_at", "due_at"],
    ["birth_at", "_date", "birth_date"],
    ["updated_timestamp", "_at", "updated_at"],
    ["at", "_at", "at_at"],
  ])("%s with %s is %s", (name, suffix, wanted) => {
    expect(withSuffix(name, suffix)).toBe(wanted);
  });
});
