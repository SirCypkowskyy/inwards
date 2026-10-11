/**
 * @file INW016 `orm-naming` on a project that follows another naming
 * scheme consistently (#361): a whole-project run reports plural tables, or
 * datetime and date columns with another suffix or none, once instead of on
 * every name, and per-edit checks keep the per-name findings. Also the
 * suggestions that would repeat a word, such as `date_of_birth_date`.
 */
import { describe, expect, test } from "bun:test";
import { checkOrm, FIRST, HEAD, inw016, MODELS, models } from "../support/orm-naming.ts";

/**
 * Builds one model file per table name, each with a naming convention so
 * that finding stays out of the way.
 *
 * @param names - the table names, one per file, in order.
 * @returns file text by path.
 */
function tableFiles(names: readonly string[]): Record<string, string> {
  return Object.fromEntries(
    names.map((name, i) => [
      `shop/infrastructure/m${i}.py`,
      `${HEAD}class M${i}(Base):\n    metadata = MetaData(naming_convention={})\n    __tablename__ = "${name}"\n`,
    ]),
  );
}

/**
 * Builds a model with a naming convention and the given column lines.
 *
 * @param columns - the class body's column lines, each ending in a newline.
 * @returns the module text.
 */
function event(columns: string): string {
  return `${HEAD}class Event(Base):\n    metadata = MetaData(naming_convention={})\n    __tablename__ = "event"\n${columns}`;
}

describe("INW016 on a project with another scheme (#361)", () => {
  test("a whole-project run reports a plural scheme once; a per-edit check, each name", async () => {
    const tables = [
      "accounts",
      "orders",
      "order_items",
      "webhook_events",
      "users",
      "payouts",
      "refunds",
      "people",
      "categories",
      "billing_entry",
    ];
    const all = tableFiles(tables);
    expect(await inw016(all, "", true)).toEqual([
      `shop/infrastructure/m0.py:${FIRST + 2}:21 This project names its tables in the plural, which the singular scheme reports on every table: \`table-name = "snake"\` matches it.`,
    ]);
    const perEdit = await inw016(all);
    expect(perEdit).toHaveLength(9);
    expect(perEdit[0]).toBe(
      `shop/infrastructure/m0.py:${FIRST + 2}:21 Table name "accounts" is plural; this project names tables in the singular: "account".`,
    );
    expect(await inw016(all, 'table-name = "snake"', true)).toEqual([]);
    // The message has no counts, so a baseline keeps accepting it as tables are added.
    const more = {
      ...all,
      "shop/infrastructure/z.py": `${HEAD}class Z(Base):\n    __tablename__ = "zones"\n`,
    };
    expect(await inw016(more, "", true)).toEqual(await inw016(all, "", true));
  });

  test("the scheme finding counts the names and asks the user for the option", async () => {
    const files = tableFiles(["accounts", "orders", "users", "posts", "tags"]);
    const found = await checkOrm(files, '[tool.inwards.rules]\nextend-select = ["INW016"]', true);
    expect(found.filter((d) => d.code === "INW016").map((d) => d.fix)).toMatchSnapshot();
  });

  test("too few names, or a mixed project, keep a finding per name", async () => {
    const few = tableFiles(["accounts", "orders", "users", "posts"]);
    expect(await inw016(few, "", true)).toHaveLength(4);
    const mixed = ["accounts", "orders", "users", "posts", "tags", "product", "price"];
    expect(await inw016(tableFiles(mixed), "", true)).toHaveLength(5);
  });

  test("datetime and date columns that share another suffix, or none, are reported once", async () => {
    const on = ["created_on", "updated_on", "sent_on", "paid_on", "seen_on"]
      .map((name) => `    ${name}: Mapped[datetime]\n`)
      .join("");
    expect(await inw016({ [MODELS]: event(on) }, "", true)).toEqual([
      `${MODELS}:${FIRST + 3}:5 This project ends its datetime column names with \`_on\`, not \`_at\`: \`datetime-suffix = "_on"\` matches it.`,
    ]);
    const django = ["date_joined", "created", "modified", "last_login", "date"]
      .map((name) => `    ${name} = Column(DateTime)\n`)
      .join("");
    expect(await inw016({ [MODELS]: event(django) }, "", true)).toEqual([
      `${MODELS}:${FIRST + 3}:5 This project's datetime column names don't end with \`_at\` or any other one suffix: \`datetime-suffix = false\` matches it.`,
    ]);
    const dates = ["birthday", "opened", "closed", "due", "issued"]
      .map((name) => `    ${name}: Mapped[date]\n`)
      .join("");
    expect(await inw016({ [MODELS]: event(dates) }, "", true)).toEqual([
      `${MODELS}:${FIRST + 3}:5 This project's date column names don't end with \`_date\` or any other one suffix: \`date-suffix = false\` matches it.`,
    ]);
    expect(await inw016({ [MODELS]: event(on) })).toHaveLength(5);
    expect(await inw016({ [MODELS]: event(on) }, 'datetime-suffix = "_on"', true)).toEqual([]);
  });

  test("a name that already says date or time gets no suffix repeated", async () => {
    const body = `class Event(Base):
    __tablename__ = "event"

    date: Mapped[datetime]
    date_joined: Mapped[datetime]
    date_of_birth: Mapped[date]
    timestamp: Mapped[datetime]
`;
    expect(await models(body)).toEqual([
      `${FIRST + 3}:5 Datetime column \`date\` doesn't end with \`_at\`: name it for what it records, ending with \`_at\`.`,
      `${FIRST + 4}:5 Datetime column \`date_joined\` doesn't end with \`_at\`: name it \`joined_at\`.`,
      `${FIRST + 5}:5 Date column \`date_of_birth\` doesn't end with \`_date\`: name it \`birth_date\`.`,
      `${FIRST + 6}:5 Datetime column \`timestamp\` doesn't end with \`_at\`: name it for what it records, ending with \`_at\`.`,
    ]);
  });
});
