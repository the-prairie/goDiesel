import type { QuestRoute } from "@/domain/routes";
import {
  cinematicDuration,
  cinematicFrame,
  cinematicShotTimeline,
  type CinematicCut,
} from "@/replay/cinematic/route-cinematic-director";

export const ROUTE_FILM_MANIFEST_CONTRACT = "godiesel.route-film/1" as const;

export interface RouteFilmManifestOptions {
  cut?: CinematicCut;
  durationSeconds?: number;
  fps?: number;
  height?: number;
  keyframeIntervalFrames?: number;
  width?: number;
}

export interface PortableRouteFilmManifest {
  contract: typeof ROUTE_FILM_MANIFEST_CONTRACT;
  camera: {
    keyframes: Array<{
      eye: { latitude: number; longitude: number; heightM: number };
      frame: number;
      headingDeg: number;
      lensMm: number;
      look: ReturnType<typeof cinematicFrame>["look"];
      pitchDeg: number;
      rangeM: number;
      routeProgressM: number;
      target: { latitude: number; longitude: number; heightM: number };
      timeSeconds: number;
    }>;
    shotTimeline: ReturnType<typeof cinematicShotTimeline>;
  };
  comparison: {
    frames: number[];
    repeatedRunsRequired: number;
  };
  coordinateReference: {
    altitudeSource: "recorded-activity";
    horizontal: "EPSG:4326";
    vertical: "WGS84-ellipsoidal-approximation";
  };
  render: {
    durationSeconds: number;
    fps: number;
    frameCount: number;
    height: number;
    output: {
      master: "exr-sequence";
      mezzanine: "prores-422-hq";
      proxy: "h264-mp4";
    };
    tileReadiness: {
      incompleteFramesAllowed: 0;
      settleFrames: number;
      strategy: "camera-cut-prestream-and-block";
    };
    width: number;
  };
  route: {
    activityId: string;
    distanceKm: number;
    elevationGainM: number;
    name: string;
    points: Array<{
      distanceM: number;
      elapsedSeconds?: number;
      heightM: number;
      latitude: number;
      longitude: number;
    }>;
    region: string;
    slug: string;
    type: string;
  };
  schemaVersion: 1;
}

function boundedInteger(value: number, fallback: number, minimum: number) {
  return Number.isFinite(value) ? Math.max(minimum, Math.round(value)) : fallback;
}

function cameraEyePosition(
  target: { lat: number; lng: number; elev: number },
  headingDeg: number,
  pitchDeg: number,
  rangeM: number,
) {
  const heading = (headingDeg * Math.PI) / 180;
  const downwardPitch = (Math.abs(pitchDeg) * Math.PI) / 180;
  const horizontalM = Math.cos(downwardPitch) * rangeM;
  const verticalM = Math.sin(downwardPitch) * rangeM;
  const northM = -Math.cos(heading) * horizontalM;
  const eastM = -Math.sin(heading) * horizontalM;
  const metresPerLongitudeDegree =
    111_320 * Math.max(0.01, Math.cos((target.lat * Math.PI) / 180));
  return {
    latitude: target.lat + northM / 111_320,
    longitude: target.lng + eastM / metresPerLongitudeDegree,
    heightM: target.elev + verticalM,
  };
}

export function createPortableRouteFilmManifest(
  route: QuestRoute,
  options: RouteFilmManifestOptions = {},
): PortableRouteFilmManifest {
  const cut = options.cut ?? "feature";
  const fps = boundedInteger(options.fps ?? 24, 24, 1);
  const width = boundedInteger(options.width ?? 3840, 3840, 640);
  const height = boundedInteger(options.height ?? 2160, 2160, 360);
  const fullDuration = cinematicDuration(route, cut);
  const durationSeconds = Math.min(
    fullDuration,
    Math.max(1, options.durationSeconds ?? Math.min(24, fullDuration)),
  );
  const frameCount = Math.max(2, Math.round(durationSeconds * fps) + 1);
  const keyframeIntervalFrames = boundedInteger(
    options.keyframeIntervalFrames ?? Math.max(1, Math.round(fps / 2)),
    Math.max(1, Math.round(fps / 2)),
    1,
  );
  const keyframeFrames = new Set<number>([0, frameCount - 1]);
  for (let frame = 0; frame < frameCount; frame += keyframeIntervalFrames) {
    keyframeFrames.add(frame);
  }

  const comparisonFrames = [0.1, 0.3, 0.5, 0.7, 0.9].map((ratio) =>
    Math.round((frameCount - 1) * ratio),
  );

  return {
    contract: ROUTE_FILM_MANIFEST_CONTRACT,
    schemaVersion: 1,
    coordinateReference: {
      horizontal: "EPSG:4326",
      vertical: "WGS84-ellipsoidal-approximation",
      altitudeSource: "recorded-activity",
    },
    route: {
      activityId: route.activityId,
      distanceKm: route.distanceKm,
      elevationGainM: route.elevationGainM,
      name: route.name,
      points: route.route.map((point) => ({
        latitude: point.lat,
        longitude: point.lng,
        heightM: point.elev,
        distanceM: point.d,
        ...(point.elapsedS === undefined
          ? {}
          : { elapsedSeconds: point.elapsedS }),
      })),
      region: route.region,
      slug: route.slug,
      type: route.type,
    },
    camera: {
      keyframes: [...keyframeFrames]
        .sort((left, right) => left - right)
        .map((frame) => {
          const timeSeconds = Math.min(durationSeconds, frame / fps);
          const camera = cinematicFrame(route, cut, timeSeconds);
          return {
            eye: cameraEyePosition(
              camera.target,
              camera.headingDeg,
              camera.pitchDeg,
              camera.rangeM,
            ),
            frame,
            headingDeg: camera.headingDeg,
            lensMm: camera.lensMm,
            look: camera.look,
            pitchDeg: camera.pitchDeg,
            rangeM: camera.rangeM,
            routeProgressM: camera.routeProgressM,
            target: {
              latitude: camera.target.lat,
              longitude: camera.target.lng,
              heightM: camera.target.elev,
            },
            timeSeconds,
          };
        }),
      shotTimeline: cinematicShotTimeline(route, cut).filter(
        (shot) => shot.startSeconds < durationSeconds,
      ),
    },
    render: {
      durationSeconds,
      fps,
      frameCount,
      height,
      output: {
        master: "exr-sequence",
        mezzanine: "prores-422-hq",
        proxy: "h264-mp4",
      },
      tileReadiness: {
        strategy: "camera-cut-prestream-and-block",
        settleFrames: fps * 2,
        incompleteFramesAllowed: 0,
      },
      width,
    },
    comparison: {
      frames: comparisonFrames,
      repeatedRunsRequired: 3,
    },
  };
}
