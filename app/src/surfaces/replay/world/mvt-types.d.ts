// 3d-tiles-renderer 0.5.2 exports these runtime APIs but omits their declarations.
// Narrow declarations verified against the pinned package, not ambient `any`.
import { ImageOverlay } from "3d-tiles-renderer/three/plugins";
declare module "3d-tiles-renderer/three/plugins" {
  interface MVTOptions {
    url: string; levels?: number; resolution?: number;
    getStyle?: (layer: string, properties: Record<string, unknown> | null) => object | null;
  }
  class MVTOverlay extends ImageOverlay {
    constructor(options: MVTOptions);
    init(): void;
    whenReady(): Promise<void>;
    readonly imageSource: { dispose(): void };
    fetchOptions: RequestInit;
    fetch: (url: string, options?: RequestInit) => Promise<Response>;
  }
  class PMTilesOverlay extends MVTOverlay {}
  interface MVTAnnotationsDriver { needsUpdate: boolean; }
  interface MVTAnnotationsPlugin { maxParseTimeMs: number; }
}
