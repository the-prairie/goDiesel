import { describe, expect, it } from "vitest";

import { sketchOptions, withOption } from "@/labs/sketch/sketch-options";

describe("sketchOptions", () => {
  it("defaults to the clean line look with a corridor, review control hidden", () => {
    expect(sketchOptions(new URLSearchParams())).toEqual({ review: false, look: "line", reveal: "corridor" });
  });

  it("shows the review control only when asked, and reads the chosen options", () => {
    expect(sketchOptions(new URLSearchParams("review=1&look=pencil&reveal=wash"))).toEqual({ review: true, look: "pencil", reveal: "wash" });
  });

  it("ignores values it does not know", () => {
    expect(sketchOptions(new URLSearchParams("look=crayon&reveal=everything&review=yes"))).toEqual({ review: false, look: "line", reveal: "corridor" });
  });

  it("changes one option and keeps the rest of the URL", () => {
    const next = withOption(new URLSearchParams("review=1&route=abc"), "reveal", "line");
    expect(next.toString()).toBe("review=1&route=abc&reveal=line");
  });
});
