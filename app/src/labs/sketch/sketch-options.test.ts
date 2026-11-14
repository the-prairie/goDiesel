import { describe, expect, it } from "vitest";

import { sketchOptions, withOption } from "@/labs/sketch/sketch-options";

describe("sketchOptions", () => {
  it("defaults to the clean line look with a corridor, review control hidden", () => {
    expect(sketchOptions(new URLSearchParams())).toEqual({ review: false, look: "line", reveal: "corridor", realCity: false });
  });

  it("shows the review control only when asked, and reads the chosen options", () => {
    expect(sketchOptions(new URLSearchParams("review=1&look=pencil&reveal=wash"))).toEqual({ review: true, look: "pencil", reveal: "wash", realCity: false });
  });

  it("ignores values it does not know", () => {
    expect(sketchOptions(new URLSearchParams("look=crayon&reveal=everything&review=yes&real=yes"))).toEqual({ review: false, look: "line", reveal: "corridor", realCity: false });
  });

  it("keeps the zoom hand-over to the real city in ink off, unless the lab switch asks for it", () => {
    expect(sketchOptions(new URLSearchParams("real=1")).realCity).toBe(true);
  });

  it("changes one option and keeps the rest of the URL", () => {
    const next = withOption(new URLSearchParams("review=1&route=abc"), "reveal", "line");
    expect(next.toString()).toBe("review=1&route=abc&reveal=line");
  });
});
