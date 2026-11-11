import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { QuestRoute } from "@/domain/route";
import type { PlayableEarthPose } from "@/labs/playable-earth/playable-earth-controller";
import {
  createPlayableEarthViewer,
  type PlayableEarthGroundingDebug,
} from "@/labs/playable-earth/playable-earth-viewer";

type Sample = Array<{ height?: number } | undefined>;
type PendingSample = {
  resolve: (positions: Sample) => void;
  reject: (error: Error) => void;
};

const route = {
  slug: "fixture",
  name: "Fixture",
  route: [
    { lat: 35, lng: 24, elev: 100, d: 0 },
    { lat: 35.01, lng: 24.01, elev: 120, d: 2_000 },
  ],
} as unknown as QuestRoute;

function pose(progressM = 0): PlayableEarthPose {
  return {
    lat: 35,
    lng: 24,
    elev: 100,
    bearingDeg: 0,
    cameraHeadingDeg: 0,
    progressM,
    progressRatio: 0,
    lateralOffsetM: 0,
    cameraRangeM: 720,
  };
}

let now = 0;
let samples: PendingSample[];
let sampleHeightSupported: boolean;

function installCesium() {
  samples = [];
  sampleHeightSupported = true;
  const scene = {
    globe: {},
    skyAtmosphere: {},
    screenSpaceCameraController: {},
    primitives: { add() {} },
    get sampleHeightSupported() {
      return sampleHeightSupported;
    },
    sampleHeightMostDetailed: () =>
      new Promise<Sample>((resolve, reject) => samples.push({ resolve, reject })),
  };
  class Viewer {
    scene = scene;
    entities = { add: (entity: object) => ({ ...entity }) };
    camera = { setView() {} };
    private destroyed = false;
    async zoomTo() {}
    isDestroyed() {
      return this.destroyed;
    }
    destroy() {
      this.destroyed = true;
    }
  }
  const Cesium = {
    Viewer,
    Ion: {},
    Cesium3DTileset: { fromUrl: async () => ({}) },
    Cartesian3: { fromDegrees: () => ({}) },
    Cartographic: { fromDegrees: () => ({}) },
    Color: {
      TRANSPARENT: {},
      fromCssColorString: () => ({ withAlpha: () => ({}) }),
    },
    ClassificationType: { CESIUM_3D_TILE: 1 },
    PolylineGlowMaterialProperty: class {},
    HeadingPitchRange: class {},
  };
  vi.stubGlobal("window", { Cesium, setTimeout });
  vi.stubGlobal("document", {
    createElement: () => ({ getContext: () => ({}) }),
  });
}

async function flush() {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
}

async function mountedViewer() {
  const grounding: PlayableEarthGroundingDebug[] = [];
  const viewer = createPlayableEarthViewer();
  const statuses: string[] = [];
  await viewer.mount({
    container: {} as HTMLElement,
    route,
    onStatus: (status) => statuses.push(status.state),
    onGroundingChange: (debug) => grounding.push(debug),
  });
  expect(statuses.at(-1)).toBe("ready");
  const setPoseAt = (atMs: number, progressM = 0) => {
    now = atMs;
    viewer.setPose(pose(progressM));
  };
  return { viewer, grounding, setPoseAt };
}

beforeEach(() => {
  now = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", "fixture-key");
  installCesium();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Playable Earth surface sampling", () => {
  it("starts at most one sample per 1.2 seconds", async () => {
    const { setPoseAt } = await mountedViewer();
    setPoseAt(0);
    expect(samples).toHaveLength(1);
    samples[0].resolve([{ height: 110 }]);
    await flush();
    setPoseAt(1_199);
    expect(samples).toHaveLength(1);
    setPoseAt(1_200);
    expect(samples).toHaveLength(2);
  });

  it("does not start another sample while one is in flight", async () => {
    const { setPoseAt } = await mountedViewer();
    setPoseAt(0);
    setPoseAt(5_000);
    expect(samples).toHaveLength(1);
    samples[0].resolve([{ height: 110 }]);
    await flush();
    setPoseAt(5_001);
    expect(samples).toHaveLength(2);
  });

  it("applies an observed height on the next pose", async () => {
    const { setPoseAt, grounding } = await mountedViewer();
    setPoseAt(0);
    expect(grounding).toEqual([{ source: "fallback", reason: "recorded" }]);
    samples[0].resolve([{ height: 110 }]);
    await flush();
    setPoseAt(16);
    expect(grounding.at(-1)).toEqual({
      source: "sampled",
      reason: "sampled",
      offsetM: 10,
    });
  });

  it("keeps a sample within 500 m of the latest pose and drops a farther one", async () => {
    const near = await mountedViewer();
    near.setPoseAt(0, 0);
    near.setPoseAt(16, 500);
    samples[0].resolve([{ height: 110 }]);
    await flush();
    near.setPoseAt(32, 500);
    expect(near.grounding.at(-1)?.source).toBe("sampled");

    installCesium();
    const far = await mountedViewer();
    far.setPoseAt(0, 0);
    far.setPoseAt(16, 501);
    samples[0].resolve([{ height: 110 }]);
    await flush();
    far.setPoseAt(32, 501);
    expect(far.grounding).toEqual([{ source: "fallback", reason: "recorded" }]);
  });

  it("reports a missing height and a failed sample as missing", async () => {
    const missing = await mountedViewer();
    missing.setPoseAt(0);
    samples[0].resolve([{}]);
    await flush();
    missing.setPoseAt(16);
    expect(missing.grounding.at(-1)).toEqual({ source: "fallback", reason: "missing" });

    installCesium();
    const failed = await mountedViewer();
    failed.setPoseAt(0);
    samples[0].reject(new Error("sample failed"));
    await flush();
    failed.setPoseAt(16);
    expect(failed.grounding.at(-1)).toEqual({ source: "fallback", reason: "missing" });
    failed.setPoseAt(1_200);
    expect(samples).toHaveLength(2);
  });

  it("an unsupported scene reports missing once per interval without sampling", async () => {
    sampleHeightSupported = false;
    const { setPoseAt, grounding } = await mountedViewer();
    setPoseAt(0);
    setPoseAt(16);
    expect(grounding).toHaveLength(2);
    expect(grounding.at(-1)?.reason).toBe("missing");
    setPoseAt(1_100);
    setPoseAt(1_199);
    expect(grounding).toHaveLength(2);
    setPoseAt(1_200);
    setPoseAt(1_216);
    expect(grounding).toHaveLength(3);
    expect(samples).toHaveLength(0);
  });

  it("destroy discards an in-flight sample and lets a remount sample at once", async () => {
    const { viewer, setPoseAt, grounding } = await mountedViewer();
    setPoseAt(0);
    viewer.destroy();
    await viewer.mount({
      container: {} as HTMLElement,
      route,
      onStatus: () => {},
      onGroundingChange: (debug) => grounding.push(debug),
    });
    grounding.length = 0;
    setPoseAt(10);
    expect(samples).toHaveLength(2);
    samples[0].resolve([{ height: 110 }]);
    await flush();
    setPoseAt(26);
    expect(grounding).toEqual([{ source: "fallback", reason: "recorded" }]);
    setPoseAt(5_000);
    expect(samples).toHaveLength(2);
    samples[1].resolve([{ height: 105 }]);
    await flush();
    setPoseAt(5_016);
    expect(grounding.at(-1)).toEqual({ source: "sampled", reason: "sampled", offsetM: 5 });
  });
});
