/**
 * @file INW016's project-wide scheme finding and test modules (#362). The
 * finding counts only the names in modules the rule checks, so a test's
 * models don't move the 90% ratio. With `check-tests = true` they count again.
 */
import { describe, expect, test } from "bun:test";
import { inw016 } from "../support/orm-naming.ts";

/** The imports each model file in the INW016 cases needs. */
const ORM = "from sqlalchemy import MetaData\nfrom sqlalchemy.orm import DeclarativeBase\n\n";

/**
 * Builds one model file per table name under a package, each with a naming
 * convention so that finding stays out of the way.
 *
 * @param dir - the package path, such as `shop/tests`.
 * @param names - the table names, one per file.
 * @returns file text by path.
 */
function tables(dir: string, names: readonly string[]): Record<string, string> {
  return Object.fromEntries(
    names.map((name, i) => [
      `${dir}/m${i}.py`,
      `${ORM}class M${i}(Base):\n    metadata = MetaData(naming_convention={})\n    __tablename__ = "${name}"\n`,
    ]),
  );
}

describe("INW016's project-wide scheme finding", () => {
  const files = {
    ...tables("shop/infrastructure", ["orders", "users", "refunds", "payouts"]),
    ...tables("shop/tests", ["accounts", "people", "categories", "zones", "items", "events"]),
  };

  test("counts only the names outside test modules", async () => {
    const found = await inw016(files, "", true);
    expect(found).toHaveLength(4);
    expect(found.every((line) => line.startsWith("shop/infrastructure/"))).toBe(true);
  });

  test("counts the tests' names too with check-tests = true", async () => {
    const found = await inw016(files, "check-tests = true", true);
    expect(found).toEqual([expect.stringContaining('`table-name = "snake"` matches it.')]);
  });
});
