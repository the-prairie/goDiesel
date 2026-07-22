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
    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-godiesel-google-maps="true"]',
    );
    const timeout = window.setTimeout(() => {
      reject(new Error("Google Maps did not finish loading."));
    }, 20_000);

    const complete = () => {
      window.clearTimeout(timeout);
      delete window.__godieselGoogleMapsReady;
      resolve();
    };

    if (existing) {
      existing.addEventListener("load", complete, { once: true });
      existing.addEventListener(
        "error",
        () => reject(new Error("Google Maps could not be loaded.")),
        { once: true },
      );
      return;
    }

    window.__godieselGoogleMapsReady = complete;
    window.gm_authFailure = () => {
      window.dispatchEvent(new CustomEvent("godiesel:google-maps-auth-failure"));
    };
    const script = document.createElement("script");
    script.async = true;
    script.dataset.godieselGoogleMaps = "true";
    script.src =
      `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}` +
      `&v=weekly&loading=async&callback=${callbackName}`;
    script.addEventListener(
      "error",
      () => reject(new Error("Google Maps could not be loaded.")),
      { once: true },
    );
    document.head.append(script);
  }).catch((error) => {
    mapsPromise = undefined;
    throw error;
  });

  return mapsPromise;
}
