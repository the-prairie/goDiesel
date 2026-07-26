import { forwardRef, lazy, Suspense } from "react";

import {
  type AtlasGlobeHandle,
  type AtlasGlobeProps,
} from "@/components/globe/atlas-world";

const CesiumAtlasGlobe = lazy(() =>
  import("@/components/globe/cesium-atlas-globe").then((module) => ({
    default: module.CesiumAtlasGlobe,
  })),
);

export type { AtlasGlobeHandle } from "@/components/globe/atlas-world";

export const AtlasGlobe = forwardRef<AtlasGlobeHandle, AtlasGlobeProps>(
  function AtlasGlobe(props, ref) {
    return (
      <Suspense
        fallback={
          <div className="absolute inset-0 grid place-items-center bg-[#02070a] text-sm text-white">
            Opening the Atlas world.
          </div>
        }
      >
        <CesiumAtlasGlobe ref={ref} {...props} />
      </Suspense>
    );
  },
);
