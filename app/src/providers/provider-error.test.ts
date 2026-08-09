import { describe, expect, it, vi } from "vitest";

import { ProviderError, providerFailureMessage } from "@/providers/provider-error";

describe("provider failures", () => {
  it("shows a deliberate message as written", () => {
    expect(
      providerFailureMessage(new ProviderError("Google Maps rejected this browser key."), "fallback"),
    ).toBe("Google Maps rejected this browser key.");
  });

  it("never shows a raw exception to a person", () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const raw = new TypeError("Cannot read properties of undefined (reading 'keys')");

    expect(providerFailureMessage(raw, "Atlas replay works everywhere.")).toBe(
      "Atlas replay works everywhere.",
    );
    expect(logged).toHaveBeenCalledWith("[goDiesel] provider failure:", raw);
    logged.mockRestore();
  });

  it("logs a thrown non-error too", () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(providerFailureMessage("something odd", "named state")).toBe("named state");
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });
});
