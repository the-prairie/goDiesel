import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import apiKeyInvalidBody from "@/providers/fixtures/google-tiles-root-api-key-invalid.json";
import {
  classifyTilesRootResponse,
  GOOGLE_KEY_PREFLIGHT_STORAGE_KEY,
  googleKeyFingerprint,
  type GoogleKeyPreflightRuntime,
} from "@/providers/google-key-preflight";

const TILES_ROOT = "https://tile.googleapis.com/v1/3dtiles/root.json";

function errorBody(status: string, reason?: string) {
  return {
    error: {
      code: 403,
      message: "fixture",
      status,
      details: reason
        ? [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason, domain: "googleapis.com" }]
        : [],
    },
  };
}

describe("classifyTilesRootResponse", () => {
  it("treats Google's recorded invalid-key answer as a rejection", () => {
    expect(classifyTilesRootResponse(400, apiKeyInvalidBody)).toBe("invalid");
  });

  it("accepts the same explicit reason on a 403", () => {
    expect(classifyTilesRootResponse(403, errorBody("PERMISSION_DENIED", "API_KEY_INVALID"))).toBe("invalid");
  });

  it("accepts API_KEY_INVALID as the error status", () => {
    expect(classifyTilesRootResponse(400, errorBody("API_KEY_INVALID"))).toBe("invalid");
  });

  it.each([
    ["a served tileset", 200, { asset: { version: "1.0" }, root: {} }],
    ["an API that is not enabled", 403, errorBody("PERMISSION_DENIED", "SERVICE_DISABLED")],
    ["a referrer restriction", 403, errorBody("PERMISSION_DENIED", "API_KEY_HTTP_REFERRER_BLOCKED")],
    ["a blocked service", 403, errorBody("PERMISSION_DENIED", "API_KEY_SERVICE_BLOCKED")],
    ["an exhausted quota", 429, errorBody("RESOURCE_EXHAUSTED", "RATE_LIMIT_EXCEEDED")],
    ["a server error that names the reason", 500, apiKeyInvalidBody],
    ["a body that is not JSON", 400, null],
    ["an error with no details", 400, errorBody("INVALID_ARGUMENT")],
    ["a reason outside an ErrorInfo", 400, { error: { status: "INVALID_ARGUMENT", details: [{ reason: "API_KEY_INVALID" }] } }],
  ])("treats %s as unknown", (_name, status, body) => {
    expect(classifyTilesRootResponse(status, body)).toBe("unknown");
  });
});

describe("googleKeyFingerprint", () => {
  it("is short, stable, distinct per key, and does not contain the key", () => {
    const key = "AIzaFixtureKey0000000000000000000000000";
    expect(googleKeyFingerprint(key)).toMatch(/^[0-9a-f]{8}$/);
    expect(googleKeyFingerprint(key)).toBe(googleKeyFingerprint(key));
    expect(googleKeyFingerprint(key)).not.toBe(googleKeyFingerprint(`${key}x`));
    expect(key).not.toContain(googleKeyFingerprint(key));
  });
});

class MemoryStorage {
  values = new Map<string, string>();
  getItem(name: string) { return this.values.get(name) ?? null; }
  setItem(name: string, value: string) { this.values.set(name, value); }
}

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("preflightGoogleMapsKey", () => {
  let storage: MemoryStorage;
  let fetchMock: ReturnType<typeof vi.fn>;

  async function freshPreflight(overrides: Partial<GoogleKeyPreflightRuntime> = {}) {
    vi.resetModules();
    const { preflightGoogleMapsKey } = await import("@/providers/google-key-preflight");
    const runtime: GoogleKeyPreflightRuntime = {
      fetch: fetchMock as unknown as typeof fetch,
      sessionStorage: storage as unknown as Storage,
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
      ...overrides,
    };
    return (key: string) => preflightGoogleMapsKey(key, runtime);
  }

  beforeEach(() => {
    storage = new MemoryStorage();
    fetchMock = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("asks the 3D Tiles root once, with only the key in the URL and no credentials", async () => {
    fetchMock.mockResolvedValue(jsonResponse(400, apiKeyInvalidBody));
    const preflight = await freshPreflight();
    await expect(preflight("bad key/+")).resolves.toBe("invalid");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${TILES_ROOT}?key=bad%20key%2F%2B`);
    expect(init).toMatchObject({ method: "GET", mode: "cors", credentials: "omit", cache: "no-store" });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([
    ["a served tileset", () => Promise.resolve(jsonResponse(200, { asset: { version: "1.0" } }))],
    ["a referrer restriction", () => Promise.resolve(jsonResponse(403, errorBody("PERMISSION_DENIED", "API_KEY_HTTP_REFERRER_BLOCKED")))],
    ["a network failure", () => Promise.reject(new TypeError("Failed to fetch"))],
    ["a CORS failure", () => Promise.reject(new TypeError("Load failed"))],
    ["an unreadable body", () => Promise.resolve(new Response("<html>", { status: 400 }))],
  ])("reports unknown for %s", async (_name, answer) => {
    fetchMock.mockImplementation(answer);
    const preflight = await freshPreflight();
    await expect(preflight("key-a")).resolves.toBe("unknown");
  });

  it("gives up as unknown after three seconds and aborts the request", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    fetchMock.mockImplementation((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      signal = init.signal ?? undefined;
      signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    }));
    const preflight = await freshPreflight({
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
    });
    let outcome: string | undefined;
    void preflight("key-a").then((value) => { outcome = value; });
    await vi.advanceTimersByTimeAsync(2_999);
    expect(outcome).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(outcome).toBe("unknown");
    expect(signal?.aborted).toBe(true);
  });

  it("reuses the session's answer instead of asking again", async () => {
    fetchMock.mockResolvedValue(jsonResponse(400, apiKeyInvalidBody));
    await (await freshPreflight())("key-a");
    const reloaded = await freshPreflight();
    await expect(reloaded("key-a")).resolves.toBe("invalid");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("caches an unknown answer too, so a session costs at most one request", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { asset: { version: "1.0" } }));
    await (await freshPreflight())("key-a");
    await expect((await freshPreflight())("key-a")).resolves.toBe("unknown");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("ignores a cached answer for a different key", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(400, apiKeyInvalidBody));
    await (await freshPreflight())("old-key");
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { asset: { version: "1.0" } }));
    await expect((await freshPreflight())("new-key")).resolves.toBe("unknown");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("stores a fingerprint and the outcome, never the key", async () => {
    fetchMock.mockResolvedValue(jsonResponse(400, apiKeyInvalidBody));
    await (await freshPreflight())("AIzaSecretFixture123456789");
    const stored = storage.getItem(GOOGLE_KEY_PREFLIGHT_STORAGE_KEY) ?? "";
    expect(JSON.parse(stored)).toEqual({
      fingerprint: googleKeyFingerprint("AIzaSecretFixture123456789"),
      outcome: "invalid",
    });
    expect(stored).not.toContain("AIzaSecretFixture");
  });

  it("shares one request between concurrent callers", async () => {
    fetchMock.mockResolvedValue(jsonResponse(400, apiKeyInvalidBody));
    const preflight = await freshPreflight();
    const outcomes = await Promise.all([preflight("key-a"), preflight("key-a")]);
    expect(outcomes).toEqual(["invalid", "invalid"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("still answers when session storage is unavailable", async () => {
    fetchMock.mockResolvedValue(jsonResponse(400, apiKeyInvalidBody));
    const throwing = {
      getItem: () => { throw new DOMException("denied", "SecurityError"); },
      setItem: () => { throw new DOMException("denied", "SecurityError"); },
    } as unknown as Storage;
    const preflight = await freshPreflight({ sessionStorage: throwing });
    await expect(preflight("key-a")).resolves.toBe("invalid");
  });

  it("makes no request without a key", async () => {
    const preflight = await freshPreflight();
    await expect(preflight("")).resolves.toBe("unknown");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("makes no request where fetch does not exist", async () => {
    const preflight = await freshPreflight({ fetch: undefined });
    await expect(preflight("key-a")).resolves.toBe("unknown");
  });
});
