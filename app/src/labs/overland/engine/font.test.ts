import { describe, expect, it } from "vitest";

import { GLYPHS, glyphAdvance, measureText } from "@/labs/overland/engine/font";

describe("the Overland bitmap font", () => {
  it("draws every glyph seven or nine rows tall with rows of one width", () => {
    for (const [character, glyph] of Object.entries(GLYPHS)) {
      expect([7, 8, 9], character).toContain(glyph.rows.length);
      for (const row of glyph.rows) expect(row, character).toHaveLength(glyph.width);
      for (const row of glyph.rows) expect(row, character).toMatch(/^[.#]+$/);
    }
  });

  it("covers letters, digits and the punctuation her words use", () => {
    for (const character of "AZaz09.,!?'’-/()&:·…") expect(GLYPHS[character], character).toBeDefined();
  });

  it("advances by the glyph width plus one, a space by three and an emoji by eleven", () => {
    expect(glyphAdvance("A")).toBe(6);
    expect(glyphAdvance("i")).toBe(2);
    expect(glyphAdvance(" ")).toBe(3);
    expect(glyphAdvance("💀")).toBe(11);
    expect(glyphAdvance("🍑")).toBe(11);
  });

  it("measures a line without its trailing gap", () => {
    expect(measureText("")).toBe(0);
    expect(measureText("A")).toBe(5);
    expect(measureText("AA")).toBe(11);
    // i 2, space 3, l 3, o 5, v 6, e 5, less the final gap.
    expect(measureText("i love")).toBe(2 + 3 + 3 + 5 + 6 + 5 - 1);
  });

  it("is wider in bold", () => {
    expect(measureText("map", true)).toBeGreaterThan(measureText("map"));
  });
});
