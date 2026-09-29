import { describe, expect, it } from "vitest";

import { footageKind } from "@/surfaces/replay/adventure/adventure-format";

describe("footageKind", () => {
  it("names the owner's footage, adding the clip title only when it adds something", () => {
    expect(footageKind({ title: "Over the saddle", origin: "recorded" }, "Over the saddle.")).toBe("Footage");
    expect(footageKind({ title: "The scree", origin: "recorded" }, "Down we go.")).toBe("Footage · The scree");
  });

  it("never calls a rendered flyover footage", () => {
    expect(footageKind({ title: "The ridge, from above", origin: "rendered", credit: "Google Earth Studio" }, "The ridge, from above."))
      .toBe("Rendered flyover · Google Earth Studio");
  });
});
