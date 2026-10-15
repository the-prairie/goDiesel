import { useSyncExternalStore } from "react";
import type { ExternalRoute } from "@/domain/search/external";
import type { FinderIntent } from "@/domain/planning";
export interface ExternalPlan {
  route: ExternalRoute;
  place: string;
  createdAt: string;
  intent: FinderIntent;
}
export const EXTERNAL_PLAN_KEY = "godiesel.external-plans.v1";
const empty: ExternalPlan[] = [];
let cachedRaw: string | null | undefined;
let cached: ExternalPlan[] = empty;
const listeners = new Set<() => void>();
export function decodeExternalPlans(raw: string | null): ExternalPlan[] {
  try {
    const data = JSON.parse(raw ?? "null");
    if (data?.version !== 1 || !Array.isArray(data.plans)) return [];
    return data.plans.filter(
      (p: ExternalPlan) =>
        typeof p.place === "string" &&
        typeof p.createdAt === "string" &&
        /^osm-\d+$/.test(p.route?.id) &&
        p.route.sourceUrl ===
          `https://www.openstreetmap.org/relation/${p.route.id.slice(4)}` &&
        typeof p.route.name === "string" &&
        ["Run", "Ride"].includes(p.route.activity) &&
        Number.isFinite(p.route.distanceKm) &&
        p.route.distanceKm > 0 &&
        ["source", "mapped"].includes(p.route.distanceKind) &&
        (p.route.ascentM == null ||
          (Number.isFinite(p.route.ascentM) && p.route.ascentM >= 0)) &&
        (p.route.surface == null || typeof p.route.surface === "string") &&
        (p.route.description == null || typeof p.route.description === "string") &&
        (p.route.surfaces == null || Array.isArray(p.route.surfaces) && p.route.surfaces.every(s => typeof s === "string")) &&
        (p.route.surfaceCoverage == null || Number.isFinite(p.route.surfaceCoverage) && p.route.surfaceCoverage >= 0 && p.route.surfaceCoverage <= 1.000001) &&
        Array.isArray(p.route.lines) &&
        p.route.lines.length > 0 &&
        p.route.lines.every(
          (l) =>
            Array.isArray(l) &&
            l.length >= 2 &&
            l.every(
              (c) =>
                Array.isArray(c) &&
                c.length === 2 &&
                Number.isFinite(c[0]) &&
                Math.abs(c[0]) <= 180 &&
                Number.isFinite(c[1]) &&
                Math.abs(c[1]) <= 90,
            ),
        ),
    );
  } catch {
    return [];
  }
}
export function getExternalPlans() {
  if (typeof window === "undefined") return empty;
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(EXTERNAL_PLAN_KEY);
  } catch {
    return cached;
  }
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cached = decodeExternalPlans(raw);
  }
  return cached;
}
function write(plans: ExternalPlan[]) {
  const raw = JSON.stringify({ version: 1, plans });
  // Do not report a durable save if storage is blocked or full.
  window.localStorage.setItem(EXTERNAL_PLAN_KEY, raw);
  cachedRaw = raw;
  cached = plans;
  listeners.forEach((fn) => fn());
}
export function saveExternalPlan(
  route: ExternalRoute,
  place: string,
  intent: FinderIntent,
) {
  if (getExternalPlans().some((p) => p.route.id === route.id)) return;
  write([
    ...getExternalPlans(),
    { route, place, intent, createdAt: new Date().toISOString() },
  ]);
}
export function removeExternalPlan(id: string) {
  write(getExternalPlans().filter((p) => p.route.id !== id));
}
function subscribe(fn: () => void) {
  listeners.add(fn);
  const onStorage = (e: StorageEvent) => {
    if (e.key === EXTERNAL_PLAN_KEY || e.key === null) {
      cachedRaw = undefined;
      fn();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("storage", onStorage);
  };
}
export const useExternalPlans = () =>
  useSyncExternalStore(subscribe, getExternalPlans, () => empty);
export function externalPlanGpx(route: ExternalRoute) {
  const escape = (s: string) =>
    s.replace(
      /[<>&"']/g,
      (c) =>
        ({
          "<": "&lt;",
          ">": "&gt;",
          "&": "&amp;",
          '"': "&quot;",
          "'": "&apos;",
        })[c]!,
    );
  return `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="goDiesel" xmlns="http://www.topografix.com/GPX/1/1"><metadata><desc>Mapped OpenStreetMap paths; not a recorded activity. Sections are not joined.</desc><link href="${escape(route.sourceUrl)}"/></metadata><trk><name>${escape(route.name)}</name>${route.lines.map((l) => `<trkseg>${l.map((p) => `<trkpt lat="${p[1]}" lon="${p[0]}"/>`).join("")}</trkseg>`).join("")}</trk></gpx>`;
}
