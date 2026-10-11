/**
 * @file The sidebar tree's toggle names: each rule category's expand control
 * must read as a button named after its category, with its open state. The
 * wiring runs in the browser, so this tests the attributes it applies.
 */
import { describe, expect, test } from "bun:test";
import { toggleAttributes } from "../chapters/javascripts/nav-tree.mjs";

describe("nav tree toggle attributes", () => {
  test("names the toggle after its section and reports it open", () => {
    expect(toggleAttributes("\n    Imports\n  ", true)).toEqual({
      role: "button",
      "aria-label": "Imports",
      "aria-expanded": "true",
    });
  });

  test("reports a closed section, in any language", () => {
    expect(toggleAttributes("Integralność", false)["aria-expanded"]).toBe("false");
    expect(toggleAttributes("Integralność", false)["aria-label"]).toBe("Integralność");
  });
});
