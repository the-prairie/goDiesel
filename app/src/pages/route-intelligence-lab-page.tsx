import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Building2,
  CheckCircle2,
  CircleDashed,
  Layers3,
  Mountain,
  Satellite,
  Sparkles,
  Waves,
} from "lucide-react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import {
  applyRouteGenomeEnrichment,
  buildRouteGenome,
  type RouteGenome,
  type RouteGenomeEnrichment,
} from "@/domain/route-genome";
import type { QuestRoute } from "@/domain/routes";
import { loadRouteDetail } from "@/data/route-repository";
import { cn } from "@/lib/utils";

const ROUTE_IDS = ["14736711660", "14023448720"] as const;

interface LabRoute {
  route: QuestRoute;
  genome: RouteGenome;
}

async function loadEnrichment(routeId: string) {
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}data/route-intelligence/${routeId}.json`);
    if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) {
      return undefined;
    }
    return (await response.json()) as RouteGenomeEnrichment;
  } catch {
    return undefined;
  }
}

function signalIcon(key: RouteGenome["environmental"][number]["key"]) {
  if (key === "built") return Building2;
  if (key === "green") return Sparkles;
  if (key === "water") return Waves;
  if (key === "exposure") return Mountain;
  return Layers3;
}

function environmentalSampleStyle(sample: NonNullable<RouteGenome["environmentalSamples"]>[number]) {
  const entries = [
    ["built", sample.built, "var(--route)"],
    ["green", sample.green, "var(--forest)"],
    ["water", sample.water, "#4d8ca8"],
    ["exposure", sample.exposure, "var(--repair)"],
  ] as const;
  const dominant = entries.reduce((best, entry) => (entry[1] > best[1] ? entry : best));
  return { background: dominant[2], opacity: 0.28 + (dominant[1] / 100) * 0.72 };
}

function RoutePortrait({ entry, active }: { entry: LabRoute; active: boolean }) {
  const { route, genome } = entry;
  const peak = Math.max(...genome.bins.map((bin) => bin.elevationM));
  const floor = Math.min(...genome.bins.map((bin) => bin.elevationM));

  return (
    <article
      className={cn(
        "relative min-w-0 overflow-hidden border border-[var(--line)] bg-[var(--surface)] transition-opacity",
        active ? "shadow-[inset_0_3px_0_var(--coral)]" : "",
      )}
      data-testid={`route-genome-${route.activityId}`}
    >
      <header className="grid gap-5 border-b border-[var(--line)] px-5 py-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:px-7">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-micro font-semibold uppercase text-[var(--forest)]">
            {route.activityId === "14736711660" ? (
              <Building2 className="size-3.5" aria-hidden="true" />
            ) : (
              <Mountain className="size-3.5" aria-hidden="true" />
            )}
            {route.activityId === "14736711660" ? "Urban field test" : "Mountain field test"}
          </div>
          <h2 className="mt-2 font-editorial text-place-lg font-semibold leading-none">
            {route.activityId === "14736711660" ? "San Francisco" : route.name}
          </h2>
          <p className="mt-3 max-w-xl text-body leading-relaxed text-[var(--ink-secondary)]">
            {genome.editorialHypothesis}
          </p>
        </div>
        <div className="grid grid-cols-3 gap-px self-start border border-[var(--line)] bg-[var(--line)] text-center">
          {[
            [route.distanceKm.toFixed(1), "km"],
            [route.elevationGainM.toLocaleString(), "m up"],
            [route.route.length.toLocaleString(), "points"],
          ].map(([value, label]) => (
            <div className="min-w-[4.25rem] bg-[var(--surface-raised)] px-3 py-2" key={label}>
              <div className="text-control font-semibold tabular-nums">{value}</div>
              <div className="mt-0.5 text-micro uppercase text-[var(--ink-muted)]">{label}</div>
            </div>
          ))}
        </div>
      </header>

      <div className="grid min-w-0 lg:grid-cols-[minmax(0,1.2fr)_minmax(18rem,0.8fr)]">
        <section className="relative min-h-[25rem] overflow-hidden border-b border-[var(--line)] bg-[#e6e8e1] lg:border-b-0 lg:border-r">
          <div className="absolute inset-0 opacity-80 [background-image:linear-gradient(rgb(23_32_30/5%)_1px,transparent_1px),linear-gradient(90deg,rgb(23_32_30/5%)_1px,transparent_1px),radial-gradient(circle_at_22%_18%,rgb(53_100_87/15%),transparent_31%),radial-gradient(circle_at_78%_74%,rgb(181_138_58/12%),transparent_30%)] [background-size:44px_44px,44px_44px,100%_100%,100%_100%]" />
          <svg
            aria-label={`${route.name} route geometry`}
            className="absolute inset-0 size-full"
            preserveAspectRatio="xMidYMid meet"
            viewBox="0 0 720 390"
          >
            <path
              d={genome.routePath}
              fill="none"
              opacity="0.9"
              stroke="white"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="11"
            />
            <path
              className="route-genome-draw"
              d={genome.routePath}
              fill="none"
              pathLength={1}
              stroke="var(--route)"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="5"
            />
          </svg>
          <div className="absolute bottom-4 left-4 border border-white/70 bg-[var(--surface-map-glass)] px-3 py-2 shadow-[var(--shadow-panel)]">
            <p className="text-micro font-semibold uppercase text-[var(--forest)]">Recorded geometry</p>
            <p className="mt-1 text-caption text-[var(--ink-secondary)]">
              Shape, distance, elevation, and time remain source truth.
            </p>
          </div>
        </section>

        <section className="min-w-0 bg-[var(--surface-raised)]">
          <div className="border-b border-[var(--line)] px-5 py-5 sm:px-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-micro font-semibold uppercase text-[var(--forest)]">Effort signature</p>
                <p className="mt-1 text-caption text-[var(--ink-secondary)]">
                  {Math.round(floor)} m low · {Math.round(peak)} m high
                </p>
              </div>
              <CheckCircle2 className="size-4 text-[var(--success)]" aria-label="Derived from recorded track" />
            </div>
            <svg className="mt-5 h-28 w-full overflow-visible" preserveAspectRatio="none" viewBox="0 0 720 116">
              <path d={`${genome.elevationPath} L720 116 L0 116 Z`} fill="rgb(14 64 57 / 12%)" />
              <path d={genome.elevationPath} fill="none" stroke="var(--forest)" strokeWidth="4" />
            </svg>
            <div className="mt-3 grid grid-cols-4 gap-2">
              {genome.metrics.map((metric) => (
                <div key={metric.label}>
                  <div className="text-control font-semibold tabular-nums">{metric.display}</div>
                  <div className="mt-1 text-micro uppercase leading-tight text-[var(--ink-muted)]">
                    {metric.label}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="px-5 py-5 sm:px-6">
            <div className="flex items-center justify-between gap-3">
              <p className="text-micro font-semibold uppercase text-[var(--forest)]">Environmental field</p>
              <span className="inline-flex items-center gap-1.5 text-micro uppercase text-[var(--ink-muted)]">
                {genome.environmental.some((signal) => signal.status === "earth-engine-ready") ? (
                  <CheckCircle2 className="size-3 text-[var(--success)]" aria-hidden="true" />
                ) : (
                  <CircleDashed className="size-3" aria-hidden="true" />
                )}
                {genome.environmental.some((signal) => signal.status === "earth-engine-ready")
                  ? "Satellite observed"
                  : "Satellite pass queued"}
              </span>
            </div>
            <div className="mt-4 grid gap-3">
              {genome.environmental.map((signal) => {
                const Icon = signalIcon(signal.key);
                return (
                  <div className="grid grid-cols-[1rem_minmax(0,1fr)_2.5rem] items-center gap-3" key={signal.key}>
                    <Icon className="size-4 text-[var(--ink-secondary)]" aria-hidden="true" />
                    <div>
                      <div className="flex items-center justify-between text-caption">
                        <span>{signal.label}</span>
                        <span className="text-[var(--ink-muted)]">
                          {signal.status === "earth-engine-ready" ? "measured" : "working hypothesis"}
                        </span>
                      </div>
                      <div className="mt-1.5 h-1.5 overflow-hidden bg-[var(--surface-muted)]">
                        <div
                          className="h-full bg-[var(--repair)] opacity-65"
                          style={{ width: `${signal.value ?? 0}%` }}
                        />
                      </div>
                    </div>
                    <span className="text-right text-caption tabular-nums text-[var(--ink-muted)]">
                      {signal.value ?? "--"}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      </div>

      <section className="border-t border-[var(--line)] px-5 py-5 sm:px-7">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-micro font-semibold uppercase text-[var(--forest)]">Experience ribbon</p>
            <p className="mt-1 text-caption text-[var(--ink-secondary)]">Each cell is a slice of the day. Darker means steeper.</p>
          </div>
          <span className="text-caption tabular-nums text-[var(--ink-muted)]">0 - {route.distanceKm.toFixed(1)} km</span>
        </div>
        <div className="mt-4 flex h-9 overflow-hidden border border-[var(--line)]">
          {genome.bins.map((bin, index) => (
            <div
              className={cn(
                "min-w-0 flex-1 border-r border-white/35 last:border-r-0",
                bin.gradePct >= 1.5 ? "bg-[var(--forest)]" : bin.gradePct <= -1.5 ? "bg-[var(--route)]" : "bg-[var(--repair)]",
              )}
              key={`${bin.distanceKm}-${index}`}
              style={{ opacity: 0.22 + bin.intensity * 0.72 }}
              title={`${bin.distanceKm} km · ${bin.gradePct}% · ${bin.elevationM} m`}
            />
          ))}
        </div>
        {genome.environmentalSamples?.length ? (
          <>
            <div className="mt-3 flex items-center justify-between gap-3">
              <span className="text-micro font-semibold uppercase text-[var(--ink-secondary)]">Satellite context</span>
              <span className="flex flex-wrap items-center justify-end gap-3 text-micro text-[var(--ink-muted)]">
                <span><i className="mr-1 inline-block size-2 bg-[var(--route)]" />Built</span>
                <span><i className="mr-1 inline-block size-2 bg-[var(--forest)]" />Living</span>
                <span><i className="mr-1 inline-block size-2 bg-[#4d8ca8]" />Water</span>
                <span><i className="mr-1 inline-block size-2 bg-[var(--repair)]" />Exposed</span>
              </span>
            </div>
            <div className="mt-2 flex h-5 overflow-hidden border border-[var(--line)]" data-testid={`satellite-ribbon-${route.activityId}`}>
              {genome.environmentalSamples.map((sample, index) => (
                <div
                  className="min-w-0 flex-1 border-r border-white/35 last:border-r-0"
                  key={`${sample.distance_km}-${index}`}
                  style={environmentalSampleStyle(sample)}
                  title={`${sample.distance_km} km · built ${sample.built} · living ${sample.green} · water ${sample.water} · exposure ${sample.exposure}`}
                />
              ))}
            </div>
          </>
        ) : null}
        <div className="mt-5 grid gap-px border border-[var(--line)] bg-[var(--line)] sm:grid-cols-2 xl:grid-cols-4">
          {genome.chapters.map((chapter, index) => (
            <div className="bg-[var(--surface)] p-4" key={chapter.title}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-editorial text-lg font-semibold">{chapter.title}</span>
                <span className="text-micro tabular-nums text-[var(--ink-muted)]">
                  {chapter.startKm}-{chapter.endKm} km
                </span>
              </div>
              <p className="mt-2 text-caption leading-relaxed text-[var(--ink-secondary)]">{chapter.character}</p>
              <div className="mt-3 h-px bg-[var(--line)]">
                <div className="h-px bg-[var(--coral)]" style={{ width: `${25 + index * 18}%` }} />
              </div>
            </div>
          ))}
        </div>
      </section>
    </article>
  );
}

export function RouteIntelligenceLabPage() {
  const [routes, setRoutes] = useState<LabRoute[]>([]);
  const [activeId, setActiveId] = useState<(typeof ROUTE_IDS)[number]>(ROUTE_IDS[0]);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    Promise.all(ROUTE_IDS.map(async (id) => ({ detail: await loadRouteDetail(id), enrichment: await loadEnrichment(id) }))).then((results) => {
      if (cancelled) return;
      const ready = results.flatMap(({ detail, enrichment }) =>
        detail.status === "ready"
          ? [{
              route: detail.route,
              genome: enrichment
                ? applyRouteGenomeEnrichment(buildRouteGenome(detail.route), enrichment)
                : buildRouteGenome(detail.route),
            }]
          : [],
      );
      if (ready.length !== ROUTE_IDS.length) setError("One or more field-test routes could not be loaded.");
      setRoutes(ready);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const activeRoute = useMemo(() => routes.find((entry) => entry.route.activityId === activeId), [activeId, routes]);
  const hasMeasuredSignals = routes.length > 0 && routes.every((entry) =>
    entry.genome.environmental.every((signal) => signal.status === "earth-engine-ready"),
  );

  if (error && routes.length === 0) return <div role="alert" className="p-8">{error}</div>;
  if (routes.length === 0) return <div role="status" className="p-8">Reading both landscapes.</div>;

  return (
    <div className="min-h-full overflow-y-auto bg-[var(--canvas)] text-[var(--ink)]" data-testid="route-intelligence-lab">
      <header className="sticky top-0 z-20 border-b border-[var(--line)] bg-[var(--surface-map-glass)] backdrop-blur-xl">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-4 px-5 py-4 sm:px-8">
          <div className="flex min-w-0 items-center gap-4">
            <Button asChild aria-label="Back to Atlas" size="icon" variant="ghost">
              <Link to="/atlas"><ArrowLeft aria-hidden="true" /></Link>
            </Button>
            <div>
              <div className="flex items-center gap-2 text-micro font-semibold uppercase text-[var(--forest)]">
                <Satellite className="size-3.5" aria-hidden="true" />
                Route intelligence lab
              </div>
              <h1 className="mt-1 font-editorial text-title font-semibold">Two worlds, one route language</h1>
            </div>
          </div>
          <div aria-label="Choose field test" className="flex border border-[var(--line)] bg-[var(--surface)] p-1" role="group">
            {routes.map(({ route }) => (
              <button
                aria-pressed={activeId === route.activityId}
                className={cn(
                  "min-h-10 px-4 text-control font-medium transition-colors",
                  activeId === route.activityId ? "bg-[var(--forest)] text-white" : "text-[var(--ink-secondary)] hover:bg-[var(--surface-muted)]",
                )}
                key={route.activityId}
                onClick={() => setActiveId(route.activityId as (typeof ROUTE_IDS)[number])}
                type="button"
              >
                {route.activityId === "14736711660" ? "San Francisco" : "Crete"}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="grid gap-5 p-4 sm:p-6 lg:p-8">
        <section className="grid gap-4 border-y border-[var(--line)] py-5 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.42fr)]">
          <div>
            <p className="max-w-4xl font-editorial text-place-lg leading-tight sm:text-[2.35rem]">
              Not a score. A readable model of what the day asks from you and what the world gives back.
            </p>
          </div>
          <div className="flex items-start gap-3 border-l-2 border-[var(--coral)] pl-4 text-caption leading-relaxed text-[var(--ink-secondary)]">
            <CircleDashed className="mt-0.5 size-4 shrink-0 text-[var(--coral)]" aria-hidden="true" />
            {hasMeasuredSignals
              ? "Satellite signals are measured from the route corridors. Recorded geometry remains source truth; narrative chapters remain editable interpretations."
              : "Gold environmental bars are hypotheses until Earth Engine replaces them with sourced observations. Recorded and derived track facts are already live."}
          </div>
        </section>

        <div className="grid gap-5 xl:grid-cols-2">
          {routes.map((entry) => (
            <RoutePortrait active={activeRoute?.route.activityId === entry.route.activityId} entry={entry} key={entry.route.activityId} />
          ))}
        </div>
      </main>
    </div>
  );
}
