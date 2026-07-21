import { forwardRef, lazy, Suspense, useState } from "react";

import {
  atlasWorldEngineMode,
  type AtlasGlobeHandle,
  type AtlasGlobeProps,
} from "@/components/globe/atlas-world";
import { ThreeAtlasGlobe } from "@/components/globe/three-atlas-globe";

const CesiumAtlasGlobe = lazy(() =>
  import("@/components/globe/cesium-atlas-globe").then((module) => ({
    default: module.CesiumAtlasGlobe,
  })),
);

export type { AtlasGlobeHandle } from "@/components/globe/atlas-world";

export const AtlasGlobe = forwardRef<AtlasGlobeHandle, AtlasGlobeProps>(
  function AtlasGlobe(props, ref) {
    const [cesiumFailure, setCesiumFailure] = useState<string>();
    const useCesium = atlasWorldEngineMode() === "cesium" && !cesiumFailure;

    if (!useCesium) {
      return (
        <div
          className="contents"
          data-atlas-engine={cesiumFailure ? "three-fallback" : "three"}
        >
          <ThreeAtlasGlobe ref={ref} {...props} />
          {cesiumFailure ? (
            <div
              role="status"
              className="pointer-events-none absolute bottom-24 left-4 z-20 max-w-xs border border-white/25 bg-[#f6f2e8]/94 px-3 py-2 text-xs text-[#24322d] shadow-lg xl:left-[15.5rem]"
            >
              Cesium world unavailable. Showing the classic Atlas.
            </div>
          ) : null}
        </div>
      );
    }

    return (
      <Suspense
        fallback={
          <div className="absolute inset-0 grid place-items-center bg-[#02070a] text-sm text-white">
            Opening the Atlas world.
          </div>
        }
      >
        <CesiumAtlasGlobe ref={ref} {...props} onUnavailable={setCesiumFailure} />
      </Suspense>
    );
  },
);
