import { describe, expect, it } from "vitest";

import { appSectionForPath } from "@/app/app-sections";

describe("appSectionForPath", () => {
  it("finds the section a surface belongs to", () => {
    expect(appSectionForPath("/atlas")?.id).toBe("atlas");
    expect(appSectionForPath("/routes/17654151284")?.id).toBe("routes");
    expect(appSectionForPath("/courses/abc/preview")?.id).toBe("routes");
    expect(appSectionForPath("/lab/playable-earth/17654151284")?.id).toBe("replay");
  });

  it("marks no section for a page that does not exist", () => {
    expect(appSectionForPath("/finderr")).toBeUndefined();
    expect(appSectionForPath("/atlass")).toBeUndefined();
  });
});
