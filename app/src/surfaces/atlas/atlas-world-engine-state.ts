import type { AtlasWorldStatus } from "@/surfaces/atlas/atlas-world";
import {
  initialRegionalTransitionState,
  reduceRegionalTransition,
  regionalOperationIsCurrent,
  type RegionalTransitionEvent,
  type RegionalTransitionState,
} from "@/surfaces/atlas/regional-transition-state";

/**
 * Lifecycle of one Cesium Atlas engine: mount, the global camera flight, and
 * the canvas dataset and statuses it publishes. The regional phase stays owned
 * by `reduceRegionalTransition`; this reducer composes it:
 *
 * - `regionSelected`, `selectionCleared`, and `disposed` are engine events that
 *   also feed the regional reducer its event of the same name.
 * - `regionalOutcome` carries the regional reducer's own outcome events
 *   (`transitionSettled`, `terrainFailed`, `tileFailed`, `frameObserved`).
 * - Every other event is the engine's alone.
 *
 * The engine keeps its IO handles (viewer, tileset, timers, flight resolvers)
 * and guards each late callback with `atlasEngineRunIsCurrent`,
 * `atlasRegionIsCurrent`, or the flight id carried by `globalFlightSettled`.
 */

export type AtlasEngineUnavailableReason = "webgl" | "mount" | "render";

export type AtlasEngineMount =
  | { phase: "idle" }
  | { phase: "mounting"; viewer: boolean }
  | { phase: "ready" }
  | { phase: "unavailable"; reason: AtlasEngineUnavailableReason; viewer: boolean }
  | { phase: "disposed" };

/** `flightId` is the latest allocated identity; a superseded flight cannot settle. */
export type AtlasGlobalCamera =
  | { state: "settled"; flightId: number }
  | { state: "flying"; flightId: number; durationMs: number };

export interface AtlasRegionFraming {
  rangeM: number;
  sphereRadiusM: number;
  pitchRadians: number;
}

export interface AtlasWorldEngineState {
  /** The single identity of the current mount run. Allocated by `mountStarted`. */
  operationId: number;
  mount: AtlasEngineMount;
  camera: AtlasGlobalCamera;
  regional: RegionalTransitionState;
  /** Route threads on the globe (`data-heat-lines`). */
  routeCount: number;
  /** Routes in the selected region (`data-region-route-count` outside global). */
  regionRouteCount: number;
  /** `data-camera-region`; absent until the first selection on this canvas. */
  cameraRegion?: string;
  /** The route styled as active. Cleared on global return. */
  routeSlug?: string;
  /** `data-selected-route`: the last route the globe sent on this canvas. */
  selectedRouteAttribute?: string;
  framing?: AtlasRegionFraming;
  /** `data-camera-duration-ms`: the duration of the latest global or regional flight. */
  flightDurationMs?: number;
  /** Increments exactly when a transition publishes `status`. */
  statusRevision: number;
  status?: AtlasWorldStatus;
}

export type AtlasRegionalOutcomeEvent = Exclude<
  RegionalTransitionEvent,
  { type: "regionSelected" | "selectionCleared" | "disposed" }
>;

export type AtlasWorldEngineEvent =
  | { type: "mountStarted"; routeCount: number }
  | { type: "webglUnavailable"; operationId: number }
  | { type: "viewerAttached"; operationId: number }
  | { type: "mountFailed"; operationId: number }
  | { type: "renderFailed"; operationId: number }
  | { type: "mountSettled"; operationId: number }
  | { type: "globalViewRequested"; durationMs: number }
  | { type: "globalFlightSettled"; flightId: number }
  | { type: "globalViewRestored"; regionalOperationId: number }
  | { type: "regionSelected"; regionName: string; routeCount: number }
  | { type: "selectionCleared"; durationMs: number }
  | {
      type: "regionFramed";
      regionalOperationId: number;
      framing: AtlasRegionFraming;
      durationMs: number;
    }
  | { type: "routeSelected"; slug?: string }
  | { type: "regionalOutcome"; event: AtlasRegionalOutcomeEvent }
  | { type: "disposed" };

const MESSAGES = {
  loading: "Opening the Atlas world.",
  ready: "Atlas world ready.",
  regionFallback: "3D terrain partially unavailable",
  unavailable: {
    webgl: "This browser cannot start the Cesium world.",
    mount: "The Cesium world could not load.",
    render: "The Cesium world stopped rendering.",
  } satisfies Record<AtlasEngineUnavailableReason, string>,
};

export function initialAtlasWorldEngineState(): AtlasWorldEngineState {
  return {
    operationId: 0,
    mount: { phase: "idle" },
    camera: { state: "settled", flightId: 0 },
    regional: initialRegionalTransitionState(),
    routeCount: 0,
    regionRouteCount: 0,
    statusRevision: 0,
  };
}

function announce(
  state: AtlasWorldEngineState,
  status: AtlasWorldStatus,
): AtlasWorldEngineState {
  return { ...state, status, statusRevision: state.statusRevision + 1 };
}

/** Whether the run that allocated `operationId` is still the live run. */
export function atlasEngineRunIsCurrent(
  state: AtlasWorldEngineState,
  operationId: number,
) {
  return state.operationId === operationId && state.mount.phase !== "disposed";
}

/** Whether this run owns a Cesium viewer the engine may drive. */
export function atlasEngineHasViewer(state: AtlasWorldEngineState) {
  switch (state.mount.phase) {
    case "mounting":
    case "unavailable":
      return state.mount.viewer;
    case "ready":
      return true;
    case "idle":
    case "disposed":
      return false;
  }
}

/** Whether outcomes captured for a regional operation still belong to it. */
export function atlasRegionIsCurrent(
  state: AtlasWorldEngineState,
  regionalOperationId: number,
) {
  return regionalOperationIsCurrent(state.regional, regionalOperationId) &&
    atlasEngineHasViewer(state);
}

/**
 * `data-camera-state`. A regional transition stays `transitioning` for the whole
 * terrain wait, even after its camera flight settled (pinned behaviour).
 */
export function atlasCameraState(
  state: AtlasWorldEngineState,
): "settled" | "transitioning" {
  switch (state.regional.status) {
    case "loading":
      return "transitioning";
    case "ready":
    case "fallback":
      return "settled";
    case "global":
    case "disposed":
      return state.camera.state === "flying" && state.camera.durationMs > 0
        ? "transitioning"
        : "settled";
  }
}

export function atlasGlobeIsSettled(state: AtlasWorldEngineState) {
  return state.regional.status === "global" && atlasCameraState(state) === "settled";
}

function startGlobalFlight(
  state: AtlasWorldEngineState,
  durationMs: number,
): AtlasWorldEngineState {
  if (state.camera.state === "flying") return state;
  return {
    ...state,
    camera: { state: "flying", flightId: state.camera.flightId + 1, durationMs },
    flightDurationMs: durationMs,
  };
}

function supersedeGlobalFlight(camera: AtlasGlobalCamera): AtlasGlobalCamera {
  return { state: "settled", flightId: camera.flightId + 1 };
}

export function reduceAtlasWorldEngine(
  state: AtlasWorldEngineState,
  event: AtlasWorldEngineEvent,
): AtlasWorldEngineState {
  switch (event.type) {
    case "mountStarted":
      return announce({
        ...state,
        operationId: state.operationId + 1,
        mount: { phase: "mounting", viewer: false },
        routeCount: event.routeCount,
        cameraRegion: undefined,
        selectedRouteAttribute: undefined,
        framing: undefined,
        flightDurationMs: undefined,
      }, { state: "loading", message: MESSAGES.loading });
    case "webglUnavailable":
      if (!atlasEngineRunIsCurrent(state, event.operationId)) return state;
      return announce(
        { ...state, mount: { phase: "unavailable", reason: "webgl", viewer: false } },
        { state: "unavailable", message: MESSAGES.unavailable.webgl },
      );
    case "viewerAttached":
      if (
        !atlasEngineRunIsCurrent(state, event.operationId) ||
        state.mount.phase !== "mounting"
      ) return state;
      return { ...state, mount: { phase: "mounting", viewer: true } };
    case "mountFailed":
    case "renderFailed": {
      if (!atlasEngineRunIsCurrent(state, event.operationId)) return state;
      const reason = event.type === "mountFailed" ? "mount" : "render";
      return announce(
        {
          ...state,
          mount: { phase: "unavailable", reason, viewer: atlasEngineHasViewer(state) },
        },
        { state: "unavailable", message: MESSAGES.unavailable[reason] },
      );
    }
    case "mountSettled": {
      if (
        !atlasEngineRunIsCurrent(state, event.operationId) ||
        state.mount.phase !== "mounting"
      ) return state;
      const ready: AtlasWorldEngineState = { ...state, mount: { phase: "ready" } };
      return state.regional.status === "global"
        ? announce(ready, { state: "ready", message: MESSAGES.ready })
        : ready;
    }
    case "globalViewRequested":
      if (!atlasEngineHasViewer(state)) return state;
      return startGlobalFlight(state, event.durationMs);
    case "globalFlightSettled":
      if (state.camera.state !== "flying" || state.camera.flightId !== event.flightId) {
        return state;
      }
      return { ...state, camera: { state: "settled", flightId: event.flightId } };
    case "globalViewRestored":
      if (
        state.regional.operationId !== event.regionalOperationId ||
        state.regional.status !== "global" ||
        !atlasEngineHasViewer(state)
      ) return state;
      return announce(state, { state: "ready", message: MESSAGES.ready });
    case "regionSelected":
      if (!atlasEngineHasViewer(state)) return state;
      return announce({
        ...state,
        regional: reduceRegionalTransition(state.regional, {
          type: "regionSelected",
          regionName: event.regionName,
        }),
        camera: supersedeGlobalFlight(state.camera),
        regionRouteCount: event.routeCount,
        cameraRegion: event.regionName,
      }, {
        state: "region-loading",
        regionName: event.regionName,
        message: `Loading ${event.regionName} terrain`,
      });
    case "selectionCleared": {
      if (!atlasEngineHasViewer(state)) return state;
      const alreadyGlobal = atlasGlobeIsSettled(state);
      const cleared: AtlasWorldEngineState = {
        ...state,
        regional: reduceRegionalTransition(state.regional, { type: "selectionCleared" }),
        routeSlug: undefined,
        cameraRegion: "",
      };
      return alreadyGlobal
        ? announce(cleared, { state: "ready", message: MESSAGES.ready })
        : announce(startGlobalFlight(cleared, event.durationMs), {
            state: "loading",
            message: MESSAGES.loading,
          });
    }
    case "regionFramed":
      if (!atlasRegionIsCurrent(state, event.regionalOperationId)) return state;
      return { ...state, framing: event.framing, flightDurationMs: event.durationMs };
    case "routeSelected":
      return {
        ...state,
        routeSlug: event.slug,
        selectedRouteAttribute: atlasEngineHasViewer(state)
          ? (event.slug ?? "")
          : state.selectedRouteAttribute,
      };
    case "regionalOutcome": {
      if (!atlasEngineHasViewer(state)) return state;
      const regional = reduceRegionalTransition(state.regional, event.event);
      if (regional === state.regional) return state;
      const next = { ...state, regional };
      if (regional.status === state.regional.status) return next;
      if (regional.status === "ready") {
        return announce(next, {
          state: "region-ready",
          regionName: regional.regionName,
          message: `${regional.regionName} terrain ready.`,
        });
      }
      if (regional.status === "fallback") {
        return announce(next, {
          state: "region-fallback",
          regionName: regional.regionName,
          message: MESSAGES.regionFallback,
        });
      }
      return next;
    }
    case "disposed":
      return {
        ...state,
        mount: { phase: "disposed" },
        regional: reduceRegionalTransition(state.regional, { type: "disposed" }),
        camera: supersedeGlobalFlight(state.camera),
        routeSlug: undefined,
      };
    default: {
      const unhandled: never = event;
      throw new Error(`Unhandled Atlas engine event: ${JSON.stringify(unhandled)}`);
    }
  }
}

export const ATLAS_GLOBAL_POSE = {
  heightM: 18_500_000,
  heading: 0,
  pitch: -Math.PI / 2,
} as const;

/**
 * The lifecycle attributes of the Cesium canvas dataset. A missing key has
 * never been written on this canvas. The engine writes these and never reads
 * them back.
 */
export function atlasEngineDataset(
  state: AtlasWorldEngineState,
): Record<string, string> {
  const regional = state.regional.status;
  const inRegion = regional === "loading" || regional === "ready" || regional === "fallback";
  const dataset: Record<string, string> = {
    atlasEngine: "cesium",
    heatLines: String(state.routeCount),
    routePalette: "monochrome",
    atlasState: inRegion ? `region-${regional}` : "global",
    cameraState: atlasCameraState(state),
    terrainState: inRegion ? regional : "global",
    regionRouteCount: inRegion ? String(state.regionRouteCount) : "0",
    regionCameraRange: state.framing ? state.framing.rangeM.toFixed(0) : "",
    regionSphereRadius: state.framing ? state.framing.sphereRadiusM.toFixed(0) : "",
    regionCameraPitch: state.framing ? state.framing.pitchRadians.toFixed(2) : "",
  };
  if (state.cameraRegion !== undefined) dataset.cameraRegion = state.cameraRegion;
  if (state.selectedRouteAttribute !== undefined) {
    dataset.selectedRoute = state.selectedRouteAttribute;
  }
  if (state.flightDurationMs !== undefined) {
    dataset.cameraDurationMs = String(state.flightDurationMs);
  }
  return dataset;
}

/**
 * The camera pose a transition commits to: the global pose when a global
 * flight starts or settles, and the framed range when a region is framed.
 * Between these, measured camera telemetry owns the same attributes.
 */
export function atlasCameraPoseIntent(
  previous: AtlasWorldEngineState,
  next: AtlasWorldEngineState,
): Partial<Record<"cameraTarget" | "cameraHeading" | "cameraPitch", string>> | undefined {
  const started = next.camera.state === "flying" &&
    (previous.camera.state !== "flying" || previous.camera.flightId !== next.camera.flightId);
  const settled = previous.camera.state === "flying" && next.camera.state === "settled" &&
    previous.camera.flightId === next.camera.flightId;
  if (started || settled) {
    return {
      cameraTarget: ATLAS_GLOBAL_POSE.heightM.toFixed(0),
      cameraHeading: ATLAS_GLOBAL_POSE.heading.toFixed(6),
      cameraPitch: ATLAS_GLOBAL_POSE.pitch.toFixed(6),
    };
  }
  if (next.framing && next.framing !== previous.framing) {
    return { cameraTarget: next.framing.rangeM.toFixed(0) };
  }
  return undefined;
}
