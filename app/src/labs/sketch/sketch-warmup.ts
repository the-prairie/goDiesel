import { loadGoogleMaps } from "@/providers/google-maps-loader";

// Wait 2 (S24). On Jump in, Google's renderer code (a 2.4 MB chunk and its
// config) loaded during the dive and the 3D tiles could only start after it.
// Choosing a route is the moment the person shows they may jump, so the Maps
// script, the maps3d library and that chunk are fetched then (about 2.7 MB,
// once per page). The scene itself is not kept: a 1 px hidden Map3DElement
// lives only until the chunk arrives (about 1.3 s, 8 s at most) and is removed,
// so a route that is never jumped holds the parsed code (about +2.3 MB of JS
// heap) and fetches no more. Skipped with Save-Data or prefers-reduced-data.
export type WarmInputs = {
  chosen: string | null;
  realmOpen: boolean;
  mapReady: boolean;
  saveData: boolean;
  reducedData: boolean;
  hasKey: boolean;
};

export function shouldWarmGoogle(inputs: WarmInputs) {
  return Boolean(inputs.chosen) && inputs.mapReady && !inputs.realmOpen && !inputs.saveData && !inputs.reducedData && inputs.hasKey;
}

type WarmWindow = Window & { __GODIESEL_GOOGLE_WARM__?: () => Promise<void> };

export function readDataSaving(win: Window = window) {
  const connection = (win.navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return {
    saveData: Boolean(connection?.saveData),
    reducedData: typeof win.matchMedia === "function" && win.matchMedia("(prefers-reduced-data: reduce)").matches,
  };
}

export function googleWarmKey(win: Window = window) {
  return import.meta.env.VITE_GOOGLE_MAPS_API_KEY || ((win as WarmWindow).__GODIESEL_GOOGLE_WARM__ ? "test" : "");
}

let warming: Promise<void> | undefined;

// The renderer's main chunk loads only once a Map3DElement is in the
// document (an unattached one fetches about 40 KB and stops). A 1 px hidden one is put in, and taken out as soon as that code's main chunk
// has arrived (or after 8 s); nothing of the scene is kept.
function warmScene(lib: google.maps.Maps3DLibrary): Promise<void> {
  const box = document.createElement("div");
  box.setAttribute("aria-hidden", "true");
  box.style.cssText = "position:fixed;left:-10px;top:-10px;width:1px;height:1px;overflow:hidden;visibility:hidden;pointer-events:none";
  box.append(new lib.Map3DElement({ center: { lat: 0, lng: 0, altitude: 0 }, range: 1e7, tilt: 0 }));
  document.body.append(box);
  return new Promise((resolve) => {
    const done = () => { observer.disconnect(); window.clearTimeout(timer); box.remove(); resolve(); };
    // The renderer's main chunk (about 2.4 MB). Its second chunk (0.8 MB) is
    // only asked for by a visible scene, so it still loads on Jump in.
    const observer = new PerformanceObserver((list) => {
      if (list.getEntries().some((e) => e.name.includes("maps.googleapis.com/maps-api-v3") && (e as PerformanceResourceTiming).encodedBodySize > 1_000_000)) done();
    });
    observer.observe({ type: "resource", buffered: false });
    const timer = window.setTimeout(done, 8000);
  });
}

// Idempotent: the loader caches the script, and the library import is asked
// for once per page. A failure is forgotten so Jump in can try again.
export function warmGoogle(apiKey: string, win: Window = window): Promise<void> {
  if (warming) return warming;
  const probe = (win as WarmWindow).__GODIESEL_GOOGLE_WARM__;
  performance.mark("sketch:google-warm-start");
  warming = (probe ? probe() : loadGoogleMaps(apiKey).then(() => google.maps.importLibrary("maps3d")).then((lib) => warmScene(lib as google.maps.Maps3DLibrary)))
    .then(() => { performance.mark("sketch:google-warm-done"); })
    .catch(() => { warming = undefined; });
  return warming;
}
