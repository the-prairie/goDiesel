import type { QuestRoute, RoutePoint } from "@/domain/routes";

export type GenomeConfidence = "recorded" | "derived" | "prototype";

export interface RouteGenomeMetric {
  label: string;
  value: number;
  display: string;
  confidence: GenomeConfidence;
}

export interface RouteGenomeBin {
  distanceKm: number;
  elevationM: number;
  gradePct: number;
  intensity: number;
}

export interface RouteChapter {
  startKm: number;
  endKm: number;
  title: string;
  character: string;
  elevationM: number;
}

export interface EnvironmentalSignal {
  key: "built" | "green" | "water" | "exposure" | "change";
  label: string;
  value: number | null;
  status: "prototype-prior" | "earth-engine-ready";
}

export interface RouteEnvironmentSample {
  distance_km: number;
  built: number;
  green: number;
  water: number;
  exposure: number;
  change: number;
}

export interface RouteVisualScene {
  key: "portrait" | "recorded-season" | "winter" | "spring" | "summer" | "autumn" | "terrain";
  label: string;
  src: string;
  dataset: string;
}

export interface RouteJourneyFrame {
  index: number;
  distance_km: number;
  elevation_m: number;
  lat: number;
  lng: number;
  is_finish: boolean;
  src: string;
  dataset: string;
  window_m?: number;
  window_radius_m?: number;
  generation?: string;
  marker_x_pct?: number;
  marker_y_pct?: number;
}

export interface RouteGenome {
  routeId: string;
  distanceKm: number;
  bins: RouteGenomeBin[];
  chapters: RouteChapter[];
  metrics: RouteGenomeMetric[];
  environmental: EnvironmentalSignal[];
  environmentalSamples?: RouteEnvironmentSample[];
  visuals?: RouteVisualScene[];
  journeyStrip?: RouteJourneyFrame[];
  routePath: string;
  elevationPath: string;
  editorialHypothesis: string;
}

export interface RouteGenomeEnrichment {
  route_id: string;
  generated_at: string;
  corridor_m: number;
  signals: Partial<Record<EnvironmentalSignal["key"], number>>;
  samples: RouteEnvironmentSample[];
  visuals?: RouteVisualScene[];
  journey_strip?: RouteJourneyFrame[];
  datasets: Array<{ id: string; role: string }>;
}

const EARTH_RADIUS_M = 6_371_000;

function haversineMeters(a: RoutePoint, b: RoutePoint) {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function fixed(value: number, digits = 1) {
  return Number(value.toFixed(digits));
}

function sampleRoute(route: RoutePoint[], count: number) {
  const distanceM = route.at(-1)?.d ?? 0;
  if (route.length === 0 || distanceM <= 0) return [];

  return Array.from({ length: count }, (_, index) => {
    const target = (distanceM * index) / (count - 1);
    let pointIndex = route.findIndex((point) => point.d >= target);
    if (pointIndex < 0) pointIndex = route.length - 1;
    return route[pointIndex];
  });
}

function svgPath(points: RoutePoint[], width: number, height: number, inset: number) {
  const minLat = Math.min(...points.map((point) => point.lat));
  const maxLat = Math.max(...points.map((point) => point.lat));
  const minLng = Math.min(...points.map((point) => point.lng));
  const maxLng = Math.max(...points.map((point) => point.lng));
  const latRange = Math.max(maxLat - minLat, 0.00001);
  const lngRange = Math.max(maxLng - minLng, 0.00001);
  const availableWidth = width - inset * 2;
  const availableHeight = height - inset * 2;
  const scale = Math.min(availableWidth / lngRange, availableHeight / latRange);
  const drawingWidth = lngRange * scale;
  const drawingHeight = latRange * scale;
  const offsetX = inset + (availableWidth - drawingWidth) / 2;
  const offsetY = inset + (availableHeight - drawingHeight) / 2;

  return points
    .map((point, index) => {
      const x = offsetX + (point.lng - minLng) * scale;
      const y = offsetY + (maxLat - point.lat) * scale;
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

function elevationPath(bins: RouteGenomeBin[], width: number, height: number) {
  const min = Math.min(...bins.map((bin) => bin.elevationM));
  const max = Math.max(...bins.map((bin) => bin.elevationM));
  const range = Math.max(max - min, 1);
  return bins
    .map((bin, index) => {
      const x = (index / (bins.length - 1)) * width;
      const y = height - ((bin.elevationM - min) / range) * height;
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

function chapterCharacter(gain: number, loss: number, relief: number) {
  if (gain > loss * 1.8 && gain > 35) return "A sustained climb that asks for patience.";
  if (loss > gain * 1.8 && loss > 35) return "A descending release with speed in reserve.";
  if (relief > 65) return "Broken terrain with repeated changes of rhythm.";
  if (gain + loss < 35) return "A steadier passage where the surroundings can lead.";
  return "Rolling ground with no single dominant effort.";
}

function buildChapters(route: QuestRoute) {
  const chapterNames = ["Opening", "Commitment", "High country", "Return"];
  return chapterNames.map((title, chapterIndex) => {
    const startD = (route.distanceKm * chapterIndex) / chapterNames.length;
    const endD = (route.distanceKm * (chapterIndex + 1)) / chapterNames.length;
    const points = route.route.filter(
      (point) => point.d / 1000 >= startD && point.d / 1000 <= endD,
    );
    let gain = 0;
    let loss = 0;
    points.slice(1).forEach((point, index) => {
      const delta = point.elev - points[index].elev;
      if (delta > 0) gain += delta;
      else loss += Math.abs(delta);
    });
    const elevations = points.map((point) => point.elev);
    const relief = Math.max(...elevations) - Math.min(...elevations);
    return {
      startKm: fixed(startD),
      endKm: fixed(endD),
      title,
      character: chapterCharacter(gain, loss, relief),
      elevationM: Math.round(Math.max(...elevations)),
    } satisfies RouteChapter;
  });
}

const hypotheses: Record<string, string> = {
  "14736711660":
    "A long urban crossing where neighborhood texture, coastline, and repeated short climbs matter more than one summit.",
  "14023448720":
    "A compact mountain loop shaped by exposure, abrupt climbing, and the feeling of committing to remote terrain.",
};

const environmentalPriors: Record<string, number[]> = {
  "14736711660": [86, 43, 64, 38, 22],
  "14023448720": [7, 31, 52, 91, 18],
};

export function buildRouteGenome(route: QuestRoute): RouteGenome {
  const sampled = sampleRoute(route.route, 64);
  const bins = sampled.map((point, index) => {
    const previous = sampled[Math.max(0, index - 1)];
    const distanceDelta = Math.max(point.d - previous.d, 1);
    const gradePct = clamp(((point.elev - previous.elev) / distanceDelta) * 100, -24, 24);
    return {
      distanceKm: fixed(point.d / 1000, 2),
      elevationM: fixed(point.elev),
      gradePct: fixed(gradePct),
      intensity: fixed(clamp(Math.abs(gradePct) / 12, 0, 1), 2),
    };
  });
  const elevations = route.route.map((point) => point.elev);
  const closureM = haversineMeters(route.route[0], route.route.at(-1) ?? route.route[0]);
  const gradeVolatility =
    bins.slice(1).reduce((sum, bin, index) => sum + Math.abs(bin.gradePct - bins[index].gradePct), 0) /
    Math.max(1, bins.length - 1);
  const climbDensity = route.elevationGainM / route.distanceKm;
  const environmental = environmentalPriors[route.activityId] ?? [null, null, null, null, null];
  const environmentalLabels = [
    ["built", "Built texture"],
    ["green", "Living cover"],
    ["water", "Water presence"],
    ["exposure", "Exposure"],
    ["change", "Recent change"],
  ] as const;

  return {
    routeId: route.activityId,
    distanceKm: route.distanceKm,
    bins,
    chapters: buildChapters(route),
    routePath: svgPath(sampled, 720, 390, 34),
    elevationPath: elevationPath(bins, 720, 116),
    editorialHypothesis: hypotheses[route.activityId] ?? route.description,
    metrics: [
      {
        label: "Climb density",
        value: climbDensity,
        display: `${Math.round(climbDensity)} m / km`,
        confidence: "derived",
      },
      {
        label: "Vertical range",
        value: Math.max(...elevations) - Math.min(...elevations),
        display: `${Math.round(Math.max(...elevations) - Math.min(...elevations))} m`,
        confidence: "derived",
      },
      {
        label: "Rhythm changes",
        value: gradeVolatility,
        display: `${fixed(gradeVolatility)} grade points`,
        confidence: "derived",
      },
      {
        label: "Loop closure",
        value: clamp(100 - (closureM / Math.max(route.distanceKm * 1000, 1)) * 500, 0, 100),
        display: closureM < 350 ? "Closed loop" : `${fixed(closureM / 1000)} km apart`,
        confidence: "derived",
      },
    ],
    environmental: environmentalLabels.map(([key, label], index) => ({
      key,
      label,
      value: environmental[index],
      status: environmental[index] === null ? "earth-engine-ready" : "prototype-prior",
    })),
  };
}

export function applyRouteGenomeEnrichment(
  genome: RouteGenome,
  enrichment: RouteGenomeEnrichment,
) {
  if (genome.routeId !== enrichment.route_id) return genome;
  return {
    ...genome,
    environmentalSamples: enrichment.samples,
    visuals: enrichment.visuals,
    journeyStrip: enrichment.journey_strip,
    environmental: genome.environmental.map((signal) => ({
      ...signal,
      value: enrichment.signals[signal.key] ?? signal.value,
      status: enrichment.signals[signal.key] === undefined
        ? signal.status
        : "earth-engine-ready",
    })),
  } satisfies RouteGenome;
}
