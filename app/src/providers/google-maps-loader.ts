import { googleKeyFingerprint, preflightGoogleMapsKey } from "@/providers/google-key-preflight";
import { ProviderError } from "@/providers/provider-error";

let mapsPromise: Promise<void> | undefined;
// Google reports a rejected key through `gm_authFailure`, often after the
// script's load callback (InvalidKeyMapError arrives asynchronously). The
// handler therefore stays installed once the API has loaded, and the page
// remembers the rejection so a later mount hears it too.
let authenticationRejected = false;
// The 3D Maps path never calls `gm_authFailure`, so the key is also checked
// once against the 3D Tiles root (google-key-preflight.ts). The check runs
// beside the script load and is never awaited: only an explicit invalid-key
// answer is reported, and every other outcome leaves the load as it was.
let preflightFingerprint: string | undefined;

const AUTH_FAILURE_EVENT = "godiesel:google-maps-auth-failure";

function reportAuthenticationFailure() {
  authenticationRejected = true;
  window.dispatchEvent(new CustomEvent(AUTH_FAILURE_EVENT));
}

function startKeyPreflight(apiKey: string) {
  if (!apiKey) return;
  const fingerprint = googleKeyFingerprint(apiKey);
  if (preflightFingerprint === fingerprint) return;
  preflightFingerprint = fingerprint;
  void preflightGoogleMapsKey(apiKey, window).then((outcome) => {
    if (outcome === "invalid" && preflightFingerprint === fingerprint && !authenticationRejected) {
      reportAuthenticationFailure();
    }
  });
}

declare global {
  interface Window {
    __godieselGoogleMapsReady?: () => void;
    gm_authFailure?: () => void;
  }
}

export function loadGoogleMaps(apiKey: string) {
  const runtime = window as unknown as {
    google?: { maps?: { importLibrary?: unknown } };
  };
  if (authenticationRejected) reportAuthenticationFailure();
  startKeyPreflight(apiKey);
  if (typeof runtime.google?.maps?.importLibrary === "function") {
    return Promise.resolve();
  }
  if (mapsPromise) return mapsPromise;

  mapsPromise = new Promise<void>((resolve, reject) => {
    const callbackName = "__godieselGoogleMapsReady";
    const staleScript = document.querySelector<HTMLScriptElement>(
      'script[data-godiesel-google-maps="true"]',
    );
    staleScript?.remove();

    const previousReady = window.__godieselGoogleMapsReady;
    const previousAuthFailure = window.gm_authFailure;
    const script = document.createElement("script");
    let settled = false;
    let timeout = 0;

    const cleanup = () => {
      window.clearTimeout(timeout);
      script.removeEventListener("error", handleScriptError);
      if (window.__godieselGoogleMapsReady === complete) {
        if (previousReady) window.__godieselGoogleMapsReady = previousReady;
        else delete window.__godieselGoogleMapsReady;
      }
    };

    const restoreAuthFailure = () => {
      if (window.gm_authFailure === handleAuthFailure) {
        if (previousAuthFailure) window.gm_authFailure = previousAuthFailure;
        else delete window.gm_authFailure;
      }
    };

    // A loaded API keeps its handler: Google can reject the key afterwards.
    const complete = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      restoreAuthFailure();
      script.remove();
      reject(error);
    };

    function handleScriptError() {
      fail(new ProviderError("Google Maps could not be loaded."));
    }

    function handleAuthFailure() {
      previousAuthFailure?.();
      if (!settled) {
        window.dispatchEvent(new CustomEvent(AUTH_FAILURE_EVENT));
        fail(new ProviderError("Google Maps rejected this browser key."));
        return;
      }
      reportAuthenticationFailure();
    }

    window.__godieselGoogleMapsReady = complete;
    window.gm_authFailure = handleAuthFailure;
    script.async = true;
    script.dataset.godieselGoogleMaps = "true";
    script.src =
      `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}` +
      `&v=weekly&loading=async&callback=${callbackName}`;
    script.addEventListener("error", handleScriptError, { once: true });
    timeout = window.setTimeout(() => {
      fail(new ProviderError("Google Maps did not finish loading."));
    }, 20_000);
    document.head.append(script);
  }).catch((error) => {
    mapsPromise = undefined;
    throw error;
  });

  return mapsPromise;
}
