/**
 * One documented, readable answer to "does Google reject this key?".
 *
 * On the 3D Maps path Google never tells the page that it rejected the key:
 * `gm_authFailure` is not called and `gmp-error` does not fire. The Map Tiles
 * API's 3D Tiles root, fetched with the same key, answers an invalid key with
 * HTTP 400 and the ErrorInfo reason `API_KEY_INVALID`, readable through CORS.
 *
 * Only that explicit answer counts. Anything else (a tileset, another error,
 * a network or CORS failure, a timeout) is "unknown", and the caller carries on
 * as if it had never asked. The outcome is cached per browser session under a
 * fingerprint of the key, so a session costs at most one root-tile request and
 * a deploy with a new key ignores an old answer. The key itself is never stored.
 */

export type GoogleKeyPreflightOutcome = "invalid" | "unknown";

export type GoogleKeyPreflightRuntime = {
  fetch?: typeof fetch;
  sessionStorage?: Pick<Storage, "getItem" | "setItem">;
  setTimeout: (handler: () => void, timeout: number) => number | ReturnType<typeof setTimeout>;
  clearTimeout: (handle: number | ReturnType<typeof setTimeout>) => void;
};

export const GOOGLE_KEY_PREFLIGHT_STORAGE_KEY = "godiesel:google-key-preflight";
const TILES_ROOT = "https://tile.googleapis.com/v1/3dtiles/root.json";
const TIMEOUT_MS = 3_000;
const ERROR_INFO_TYPE = "type.googleapis.com/google.rpc.ErrorInfo";

const pending = new Map<string, Promise<GoogleKeyPreflightOutcome>>();

/** Google's explicit invalid-key answer, and nothing else, is a rejection. */
export function classifyTilesRootResponse(status: number, body: unknown): GoogleKeyPreflightOutcome {
  if (status !== 400 && status !== 403) return "unknown";
  const error = (body as { error?: { status?: unknown; details?: unknown } } | null)?.error;
  if (!error || typeof error !== "object") return "unknown";
  if (error.status === "API_KEY_INVALID") return "invalid";
  const details = Array.isArray(error.details) ? error.details : [];
  const named = details.some((detail) =>
    detail?.["@type"] === ERROR_INFO_TYPE && detail?.reason === "API_KEY_INVALID");
  return named ? "invalid" : "unknown";
}

/** FNV-1a, 32 bits: enough to tell keys apart, useless for recovering one. */
export function googleKeyFingerprint(apiKey: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < apiKey.length; index++) {
    hash ^= apiKey.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function readCached(runtime: GoogleKeyPreflightRuntime, fingerprint: string) {
  try {
    const cached = JSON.parse(runtime.sessionStorage?.getItem(GOOGLE_KEY_PREFLIGHT_STORAGE_KEY) ?? "null");
    if (cached?.fingerprint === fingerprint && (cached.outcome === "invalid" || cached.outcome === "unknown")) {
      return cached.outcome as GoogleKeyPreflightOutcome;
    }
  } catch {
    // Storage can be unavailable or hold something else: ask again.
  }
  return undefined;
}

function writeCached(runtime: GoogleKeyPreflightRuntime, fingerprint: string, outcome: GoogleKeyPreflightOutcome) {
  try {
    runtime.sessionStorage?.setItem(GOOGLE_KEY_PREFLIGHT_STORAGE_KEY, JSON.stringify({ fingerprint, outcome }));
  } catch {
    // A session without storage asks once per page instead.
  }
}

async function askTilesRoot(apiKey: string, runtime: GoogleKeyPreflightRuntime): Promise<GoogleKeyPreflightOutcome> {
  const request = runtime.fetch;
  if (typeof request !== "function") return "unknown";
  const controller = new AbortController();
  let timeout: ReturnType<GoogleKeyPreflightRuntime["setTimeout"]> | undefined;
  // The deadline answers "unknown" even if a fetch ignores its abort signal.
  const deadline = new Promise<GoogleKeyPreflightOutcome>((resolve) => {
    timeout = runtime.setTimeout(() => {
      controller.abort();
      resolve("unknown");
    }, TIMEOUT_MS);
  });
  const answer = (async (): Promise<GoogleKeyPreflightOutcome> => {
    try {
      const response = await request.call(runtime, `${TILES_ROOT}?key=${encodeURIComponent(apiKey)}`, {
        method: "GET",
        mode: "cors",
        credentials: "omit",
        cache: "no-store",
        signal: controller.signal,
      });
      const body: unknown = await response.json().catch(() => null);
      return classifyTilesRootResponse(response.status, body);
    } catch {
      return "unknown";
    }
  })();
  try {
    return await Promise.race([answer, deadline]);
  } finally {
    if (timeout !== undefined) runtime.clearTimeout(timeout);
  }
}

export function preflightGoogleMapsKey(
  apiKey: string,
  runtime: GoogleKeyPreflightRuntime,
): Promise<GoogleKeyPreflightOutcome> {
  if (!apiKey) return Promise.resolve("unknown");
  const fingerprint = googleKeyFingerprint(apiKey);
  const cached = readCached(runtime, fingerprint);
  if (cached) return Promise.resolve(cached);
  let check = pending.get(fingerprint);
  if (!check) {
    check = askTilesRoot(apiKey, runtime).then((outcome) => {
      writeCached(runtime, fingerprint, outcome);
      return outcome;
    });
    pending.set(fingerprint, check);
  }
  return check;
}
