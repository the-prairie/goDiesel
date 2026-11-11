import * as maplibregl from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";

// MapLibre 6 requires an explicit worker URL when bundled by Vite.
maplibregl.setWorkerUrl(workerUrl);

export default maplibregl;
