import { ProviderError } from "@/providers/provider-error";

let mapsPromise: Promise<void> | undefined;

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
      if (window.gm_authFailure === handleAuthFailure) {
        if (previousAuthFailure) window.gm_authFailure = previousAuthFailure;
        else delete window.gm_authFailure;
      }
    };

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
      script.remove();
      reject(error);
    };

    function handleScriptError() {
      fail(new ProviderError("Google Maps could not be loaded."));
    }

    function handleAuthFailure() {
      window.dispatchEvent(new CustomEvent("godiesel:google-maps-auth-failure"));
      fail(new ProviderError("Google Maps rejected this browser key."));
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
