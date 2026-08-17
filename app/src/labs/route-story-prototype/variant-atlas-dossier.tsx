import { BookOpen, CircleDot, MapPinned, Mountain, Route as RouteIcon } from "lucide-react";
import { useMemo, useState } from "react";

import {
  distanceLabel,
  routeStoryChapters,
} from "@/surfaces/routes/route-story";
import {
  EVIDENCE_LABEL,
  PrototypeHeader,
  PrototypeMetrics,
  PrototypeTerrain,
  RouteChapterNodes,
  RouteIdentity,
  type RouteStoryPrototypeProps,
} from "@/labs/route-story-prototype/prototype-shared";
import { cn } from "@/ui/utils";

export function AtlasDossierPrototype({ route, routesPath }: RouteStoryPrototypeProps) {
  const chapters = useMemo(() => routeStoryChapters(route), [route]);
  const [activeIndex, setActiveIndex] = useState(0);
  const activeChapter = chapters[activeIndex] ?? chapters[0];
  const totalDistanceM = Math.max(
    route.distanceKm * 1_000,
    route.route.at(-1)?.d ?? 0,
    1,
  );
  const progress = activeChapter
    ? Math.min(1, Math.max(0, activeChapter.distanceM / totalDistanceM))
    : 0;
  const geographyLabel =
    route.lifecycle === "completed"
      ? "Recorded geography"
      : route.lifecycle === "discovered"
        ? "Imported geometry"
        : "Planning-source geometry";

  return (
    <article className="flex h-full min-h-0 flex-col overflow-y-auto bg-canvas text-ink">
      <PrototypeHeader
        route={route}
        routesPath={routesPath}
        concept="Atlas dossier"
        quiet
      />

      <section className="relative grid min-h-[calc(100dvh-3.5rem)] border-b border-line lg:grid-cols-[minmax(23rem,0.42fr)_minmax(0,0.58fr)]">
        <div className="relative z-10 flex flex-col justify-between bg-canvas px-5 pb-9 pt-10 sm:px-10 sm:pb-12 sm:pt-14 lg:min-h-0 lg:px-[max(3rem,calc((100vw-76rem)/2))] lg:py-16">
          <div>
            <div className="mb-10 flex items-center gap-3 text-micro font-semibold uppercase text-forest">
              <RouteIcon aria-hidden="true" className="size-4" />
              <span>Evidence-rich geographic record</span>
              <span className="h-px flex-1 bg-line" aria-hidden="true" />
              <span className="tabular-nums">{route.slug}</span>
            </div>
            <RouteIdentity route={route} />
          </div>

          <div className="mt-10 max-w-xl">
            <PrototypeMetrics route={route} />
            <div className="mt-7 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => document.getElementById("dossier-evidence-index")?.scrollIntoView({ block: "start" })}
                className="inline-flex min-h-11 items-center gap-2 bg-forest px-4 text-control font-semibold text-white outline-none hover:bg-[#143f39] focus-visible:ring-2 focus-visible:ring-route focus-visible:ring-offset-2"
              >
                <BookOpen aria-hidden="true" className="size-4" />
                Begin dossier
              </button>
              <p className="flex min-h-11 items-center border-l border-line pl-4 text-caption leading-5 text-ink-muted">
                Source-backed line, evidence-labelled chapters, and Replay in one continuous leaf.
              </p>
            </div>
          </div>
        </div>

        <PrototypeTerrain
          route={route}
          progress={progress}
          className="min-h-[52dvh] border-t border-line lg:min-h-0 lg:border-l lg:border-t-0"
          routeClassName="drop-shadow-[0_2px_4px_rgb(9_33_30_/_45%)]"
        >
          <div className="absolute inset-0 z-[3] bg-[linear-gradient(90deg,rgb(10_35_32_/_28%),transparent_48%)]" aria-hidden="true" />
          <RouteChapterNodes
            route={route}
            activeIndex={activeIndex}
            onSelect={setActiveIndex}
          />

          <div className="absolute left-4 top-4 z-20 border border-white/35 bg-[#123b35] px-3 py-2 text-white sm:left-6 sm:top-6">
            <p className="text-micro font-semibold uppercase text-white/60">Spatial route plate</p>
            <p className="mt-1 text-caption font-semibold">{geographyLabel}</p>
          </div>

          {activeChapter ? (
            <div className="absolute bottom-5 left-4 right-4 z-20 max-w-md bg-[#123b35] p-4 text-white sm:bottom-6 sm:left-6 sm:right-auto">
              <div className="flex items-center justify-between gap-4">
                <p className="text-micro font-semibold uppercase text-[#ffd0e3]">
                  {String(activeIndex + 1).padStart(2, "0")} · {EVIDENCE_LABEL[activeChapter.evidence]}
                </p>
                <p className="text-micro tabular-nums text-white/65">
                  {distanceLabel(activeChapter.distanceM)}
                </p>
              </div>
              <p className="mt-2 font-editorial text-2xl leading-none">{activeChapter.title}</p>
            </div>
          ) : null}
        </PrototypeTerrain>

        <aside className="absolute bottom-0 left-0 z-30 hidden -translate-x-[calc(100%-1px)] border border-line bg-surface px-2 py-3 text-center lg:left-[42%] lg:block">
          <p className="[writing-mode:vertical-rl] text-micro font-semibold uppercase text-ink-muted">
            Geometry {route.replay.geometryStatus} · {route.lifecycle}
          </p>
        </aside>
      </section>

      <section
        id="dossier-evidence-index"
        aria-labelledby="dossier-index-heading"
        className="scroll-mt-14 border-b border-line bg-surface"
      >
        <div className="grid border-b border-line px-5 py-7 sm:px-10 lg:grid-cols-[minmax(16rem,0.32fr)_minmax(0,0.68fr)] lg:gap-12 lg:px-[max(3rem,calc((100vw-76rem)/2))]">
          <div>
            <p className="text-micro font-semibold uppercase text-coral">Evidence index</p>
            <h2 id="dossier-index-heading" className="mt-2 font-editorial text-4xl leading-none">
              Read the route by position.
            </h2>
          </div>
          <p className="mt-4 max-w-2xl self-end text-body leading-7 text-ink-secondary lg:mt-0">
            Every entry is anchored to the source-backed line. Select a coordinate to inspect its evidence on the spatial plate.
          </p>
        </div>

        {chapters.length ? (
          <nav aria-label="Dossier evidence" className="overflow-x-auto">
            <div className="flex min-w-max px-5 sm:px-10 lg:min-w-0 lg:px-[max(3rem,calc((100vw-76rem)/2))]">
              {chapters.map((chapter, index) => (
                <button
                  key={chapter.id}
                  type="button"
                  aria-current={activeIndex === index ? "step" : undefined}
                  onClick={() => setActiveIndex(index)}
                  className={cn(
                    "group relative min-h-28 w-52 border-l border-line px-4 py-5 text-left outline-none transition-colors first:border-l-0 lg:min-w-0 lg:flex-1",
                    activeIndex === index ? "bg-[#e5eee9]" : "hover:bg-surface-muted",
                  )}
                >
                  <span className="flex items-center justify-between gap-3">
                    <span className={cn(
                      "text-micro font-semibold uppercase",
                      activeIndex === index ? "text-coral" : "text-ink-muted",
                    )}>
                      {String(index + 1).padStart(2, "0")} · {EVIDENCE_LABEL[chapter.evidence]}
                    </span>
                    <span className="text-micro tabular-nums text-ink-muted">
                      {distanceLabel(chapter.distanceM)}
                    </span>
                  </span>
                  <span className="mt-4 block font-editorial text-xl leading-5 text-ink">
                    {chapter.title}
                  </span>
                  <span
                    className={cn(
                      "absolute inset-x-0 bottom-0 h-0.5 bg-coral transition-opacity",
                      activeIndex === index ? "opacity-100" : "opacity-0 group-focus-visible:opacity-100",
                    )}
                    aria-hidden="true"
                  />
                </button>
              ))}
            </div>
          </nav>
        ) : (
          <p role="status" className="px-5 py-8 text-body text-ink-muted sm:px-10">
            Evidence chapters need recorded GPS geometry.
          </p>
        )}
      </section>

      {activeChapter ? (
        <section className="grid min-h-[34rem] border-b border-line lg:grid-cols-[minmax(0,0.42fr)_minmax(0,0.58fr)]">
          <div className="flex items-center px-5 py-14 sm:px-10 lg:px-[max(3rem,calc((100vw-76rem)/2))] lg:py-20">
            <div className="max-w-xl">
              <p className="text-micro font-semibold uppercase text-coral">
                Entry {String(activeIndex + 1).padStart(2, "0")} · {EVIDENCE_LABEL[activeChapter.evidence]}
              </p>
              <h2 className="mt-3 font-editorial text-4xl leading-none sm:text-5xl">
                {activeChapter.title}
              </h2>
              <p className="mt-6 font-editorial text-2xl leading-8 text-ink-secondary">
                {activeChapter.body}
              </p>
              <dl className="mt-8 flex gap-7 border-t border-line pt-5 text-control font-semibold">
                <div>
                  <dt className="flex items-center gap-2 text-micro uppercase text-ink-muted">
                    <MapPinned aria-hidden="true" className="size-4 text-cobalt" /> Position
                  </dt>
                  <dd className="mt-2 tabular-nums">{distanceLabel(activeChapter.distanceM)}</dd>
                </div>
                <div>
                  <dt className="flex items-center gap-2 text-micro uppercase text-ink-muted">
                    <Mountain aria-hidden="true" className="size-4 text-cobalt" /> Elevation
                  </dt>
                  <dd className="mt-2 tabular-nums">
                    {activeChapter.elevationM === undefined
                      ? "Unavailable"
                      : `${Math.round(activeChapter.elevationM).toLocaleString()} m`}
                  </dd>
                </div>
              </dl>
            </div>
          </div>
          <div className="flex items-center border-t border-line bg-[#dfe9e4] px-5 py-14 sm:px-10 lg:border-l lg:border-t-0 lg:px-14 lg:py-20">
            <div className="w-full border-y border-line-strong py-7">
              <p className="text-micro font-semibold uppercase text-forest">Source ledger</p>
              <dl className="mt-6 grid gap-px bg-line sm:grid-cols-3">
                <LedgerDatum
                  label="Geometry"
                  value={`${geographyLabel} ${route.replay.geometryStatus}`}
                />
                <LedgerDatum
                  label="Time"
                  value={route.provenance.temporal.status === "recorded" ? "Recorded time" : "Time unavailable"}
                />
                <LedgerDatum
                  label="Track"
                  value={`${route.provenance.track.segmentCount} source ${route.provenance.track.segmentCount === 1 ? "segment" : "segments"}`}
                />
              </dl>
              <p className="mt-5 flex items-start gap-2 text-caption leading-5 text-ink-secondary">
                <CircleDot aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-coral" />
                Editorial text is labelled separately from recorded and track-derived evidence.
              </p>
            </div>
          </div>
        </section>
      ) : null}
    </article>
  );
}

function LedgerDatum({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 bg-[#dfe9e4] py-3 pr-4">
      <dt className="text-micro uppercase text-ink-muted">{label}</dt>
      <dd className="mt-1 text-control font-semibold text-ink">{value}</dd>
    </div>
  );
}
