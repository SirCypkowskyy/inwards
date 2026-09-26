import { describe, expect, test } from "bun:test";
import { counterpart } from "../chapters/javascripts/language-switch.mjs";

// The English site at /inwards/, as on GitHub Pages; Polish is "pl/" below it.
const EN = new URL("https://sircypkowskyy.github.io/inwards/");
const PL = new URL("https://sircypkowskyy.github.io/inwards/pl/");

describe("language switch counterpart", () => {
  test("keeps the page and the anchor in both directions", () => {
    const toPl = counterpart("pl/", EN, {
      pathname: "/inwards/guides/install/",
      hash: "#on-an-existing-codebase",
    });
    expect(toPl.page.href).toBe(
      "https://sircypkowskyy.github.io/inwards/pl/guides/install/#on-an-existing-codebase",
    );
    expect(toPl.root.href).toBe(PL.href);

    const toEn = counterpart("../", PL, { pathname: "/inwards/pl/05-ADR/", hash: "" });
    expect(toEn.page.href).toBe("https://sircypkowskyy.github.io/inwards/05-ADR/");
    expect(toEn.root.href).toBe(EN.href);
  });

  test("the home page maps to the other home page", () => {
    expect(counterpart("pl/", EN, { pathname: "/inwards/", hash: "" }).page.href).toBe(PL.href);
    expect(counterpart("../", PL, { pathname: "/inwards/pl/", hash: "" }).page.href).toBe(EN.href);
  });

  // GitHub Pages serves 404.html, which loads the script, for any path, so the
  // path is attacker-controlled. It must never become a scheme or another host.
  test.each([
    "/inwards/javascript:alert(document.domain)",
    "/inwards/javascript:void(0)//",
    "/inwards///example.org/x",
    "/inwards//example.org/x",
    "/inwards/https://example.org/x",
    "/inwards/data:text/html,<script>alert(1)</script>",
  ])("a crafted path stays on this origin: %s", (pathname) => {
    for (const [alternate, root] of [
      ["pl/", EN],
      ["./", EN],
      ["../", PL],
    ]) {
      const { page } = counterpart(alternate, root, { pathname, hash: "" });
      expect(page.origin).toBe(EN.origin);
      expect(page.protocol).toBe("https:");
    }
  });
});
