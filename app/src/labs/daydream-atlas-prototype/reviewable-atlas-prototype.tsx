// Throwaway prototype: a regional lens, route collection, and directed route story.
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  ChevronDown,
  Compass,
  Eye,
  ExternalLink,
  Layers3,
  Map,
  Mountain,
  Pause,
  Play,
} from "lucide-react";
import { useEffect, useState } from "react";

import { routeRegions, type RouteRegion } from "@/data/route-regions";
import type { RouteSummary } from "@/domain/route";
import { AtlasGlobe } from "@/surfaces/atlas/components/atlas-globe";

import "./reviewable-atlas-prototype.css";

type JourneyScreen = "world" | "routes" | "editorial" | "story";

type RouteStory = {
  name: string;
  label: string;
  blurb: string;
  km: number;
  climb: number;
  highPoint: number;
  avgSpeed: number;
  time: string;
  image: number;
  chapters: number;
};

type RegionView = {
  atlas: RouteRegion;
  shortName: string;
  country: string;
  note: string;
  image: number;
};

const regionDetails = [
  { name: "Crete, Greece", shortName: "Crete", country: "Greece", note: "White stone, high wind", image: 1 },
  { name: "Canary Islands", shortName: "Canary Islands", country: "Spain", note: "Volcanic lines in Atlantic light", image: 2 },
  { name: "Tokyo, Japan", shortName: "Tokyo", country: "Japan", note: "Crosswalks, parks, river paths", image: 4 },
  { name: "Bali, Indonesia", shortName: "Bali", country: "Indonesia", note: "Volcano roads to the sea", image: 5 },
] as const;

const regions: RegionView[] = regionDetails.flatMap((details) => {
  const atlas = routeRegions.find((region) => region.name === details.name);
  return atlas ? [{ atlas, ...details }] : [];
});
const atlasRegions = regions.map((region) => region.atlas);

function routeStory(route: RouteSummary, index = 0): RouteStory {
  const hours = Math.max(1, route.distanceKm / (route.type === "ride" ? 18 : 6.2));
  const minutes = Math.round(hours * 60);
  return {
    name: route.activityName || route.subtitle || route.name,
    label: route.difficulty,
    blurb: route.description || `${route.distanceKm.toFixed(1)} kilometres remembered across ${route.region}.`,
    km: route.distanceKm,
    climb: route.elevationGainM,
    highPoint: Math.round(Math.max(...route.trace.map((point) => point.elev ?? 0), 0)),
    avgSpeed: route.type === "ride" ? 18 : 6.2,
    time: `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`,
    image: index % 6 + 1,
    chapters: 4 + index % 4,
  };
}

const storyChapters = [
  { name: "First light", fraction: 0.08, elevation: 0.2, grade: 1.8, image: 4 },
  { name: "First climb", fraction: 0.28, elevation: 0.48, grade: 6.4, image: 1 },
  { name: "Cloud break", fraction: 0.48, elevation: 0.72, grade: 3.2, image: 2 },
  { name: "High traverse", fraction: 0.7, elevation: 1, grade: 0.8, image: 3 },
  { name: "Return glow", fraction: 0.92, elevation: 0.56, grade: -4.6, image: 5 },
] as const;

export function AtlasJourneyPrototype() {
  const [screen, setScreen] = useState<JourneyScreen>("world");
  const [regionIndex, setRegionIndex] = useState(0);
  const [routeIndex, setRouteIndex] = useState(0);
  const region = regions[regionIndex];
  const route = region.atlas.routes[routeIndex] ?? region.atlas.routes[0];

  function moveRegion(delta: number) {
    setRegionIndex((current) => (current + delta + regions.length) % regions.length);
    setRouteIndex(0);
  }

  return (
    <div className="atlas-journey-prototype">
      {screen === "world" || screen === "routes" ? (
        <SpatialAtlas
          screen={screen}
          region={region}
          regionIndex={regionIndex}
          selectedRoute={route}
          routeIndex={routeIndex}
          onMove={moveRegion}
          onSelectRoute={(nextRoute) => setRouteIndex(region.atlas.routes.findIndex((item) => item.slug === nextRoute.slug))}
          onOpenRegion={() => setScreen("routes")}
          onBack={() => setScreen("world")}
          onOpenStory={() => setScreen("editorial")}
        />
      ) : null}
      {screen === "editorial" ? <EditorialRouteStory route={route} story={routeStory(route, routeIndex)} onBack={() => setScreen("routes")} onReplay={() => setScreen("story")} /> : null}
      {screen === "story" ? <DirectorStory route={routeStory(route, routeIndex)} routeSlug={route.slug} onBack={() => setScreen("editorial")} /> : null}
    </div>
  );
}

function SpatialAtlas({
  screen,
  region,
  regionIndex,
  selectedRoute,
  routeIndex,
  onMove,
  onSelectRoute,
  onOpenRegion,
  onBack,
  onOpenStory,
}: {
  screen: "world" | "routes";
  region: RegionView;
  regionIndex: number;
  selectedRoute: RouteSummary;
  routeIndex: number;
  onMove: (delta: number) => void;
  onSelectRoute: (route: RouteSummary) => void;
  onOpenRegion: () => void;
  onBack: () => void;
  onOpenStory: () => void;
}) {
  const [lens, setLens] = useState<"routes" | "terrain">("routes");
  const [previewOpen, setPreviewOpen] = useState(false);
  const featured = routeStory(region.atlas.routes[0], 0);
  const selectedStory = routeStory(selectedRoute, routeIndex);
  const selectedForMap = screen === "routes" || lens === "terrain" ? selectedRoute : undefined;

  function selectAndPreview(route: RouteSummary) {
    onSelectRoute(route);
    if (screen === "routes") setPreviewOpen(true);
  }

  return (
    <section className={`atlas-world atlas-world--spatial ${screen === "routes" ? "atlas-world--route-selection" : ""}`}>
      <AtlasGlobe
        regions={atlasRegions}
        selectedRegion={region.atlas}
        selectedRoute={selectedForMap}
        routeDisplayMode={screen === "routes" || lens === "routes" ? "standard" : "terrain"}
        onSelectRegion={(nextRegion) => {
          const nextIndex = regions.findIndex((item) => item.atlas.name === nextRegion.name);
          if (nextIndex >= 0) onMove(nextIndex - regionIndex);
        }}
        onSelectRoute={selectAndPreview}
        className="atlas-spatial-globe"
      />
      <div className="atlas-spatial-vignette" />
      <header className="atlas-world-header">
        <div className="atlas-world-brand"><span>goDiesel</span><small>Personal atlas</small></div>
        {screen === "routes" ? <button type="button" className="atlas-overview-button" onClick={onBack}><Map aria-hidden="true" /> Region overview</button> : <span className="atlas-overview-button"><Map aria-hidden="true" /> Regional globe</span>}
      </header>
      {screen === "world" ? (
        <>
          <button type="button" className="atlas-region-arrow atlas-region-arrow--previous" onClick={() => onMove(-1)} aria-label="Previous region"><ArrowLeft /></button>
          <button type="button" className="atlas-region-arrow atlas-region-arrow--next" onClick={() => onMove(1)} aria-label="Next region"><ArrowRight /></button>
          <div className="atlas-region-copy atlas-region-copy--spatial">
            <div className="atlas-region-count">{String(regionIndex + 1).padStart(2, "0")} / {String(regions.length).padStart(2, "0")}</div>
            <small>{region.country} · {region.atlas.routes.length} recorded routes</small>
            <h1>{region.shortName}</h1>
            <p>{region.note}</p>
          </div>
          <div className="atlas-lens-switcher" role="group" aria-label="Regional lens">
            <span><Eye /> Lens</span>
            {(["routes", "terrain"] as const).map((value) => <button type="button" key={value} aria-pressed={lens === value} onClick={() => setLens(value)}>{value}</button>)}
          </div>
          {lens === "terrain" ? <TerrainLens region={region} selectedRoute={selectedRoute} onSelectRoute={onSelectRoute} /> : null}
          {lens === "routes" ? <article className="atlas-feature-card" aria-live="polite">
            <span className={`atlas-feature-image atlas-memory--${region.image}`} />
            <div><small>Featured route</small><strong>{featured.name}</strong><span>{featured.km} km · {featured.climb} m · {featured.chapters} chapters</span></div>
            <button type="button" onClick={onOpenRegion}>Open region <ArrowRight /></button>
          </article> : null}
          <nav className="atlas-neighbor-strip" aria-label="Regions">
            {regions.map((item, index) => <button type="button" key={item.atlas.name} aria-current={index === regionIndex ? "page" : undefined} onClick={() => onMove(index - regionIndex)}><i className={`atlas-memory--${item.image}`} /><span><strong>{item.shortName}</strong><small>{index === regionIndex ? "Here now" : item.note}</small></span></button>)}
          </nav>
        </>
      ) : (
        <>
          <header className="atlas-routes-header atlas-routes-header--overlay">
            <button type="button" onClick={onBack}><ArrowLeft /> Regions</button>
            <div><small>{region.country}</small><strong>{region.shortName}</strong></div>
            <button type="button"><Layers3 /> Routes</button>
          </header>
          <div className="atlas-map-stats atlas-map-stats--overlay"><span><strong>{selectedStory.km}</strong> km</span><span><strong>{selectedStory.climb}</strong> m</span><span><strong>{selectedStory.time}</strong> moving</span></div>
          <aside className="atlas-route-collection atlas-route-collection--overlay">
            {previewOpen ? (
              <RoutePreview route={selectedRoute} story={selectedStory} onBack={() => setPreviewOpen(false)} onReadStory={onOpenStory} />
            ) : (
              <>
                <div className="atlas-collection-heading"><span><small>Your route memory</small><h1>Choose a story</h1></span><strong>{region.atlas.routes.length} routes</strong></div>
                <p className="atlas-collection-instruction">Choose a route to see its terrain, chapters, and field notes.</p>
                <div className="atlas-route-cards">
                  {region.atlas.routes.slice(0, 5).map((item, index) => {
                    const story = routeStory(item, index);
                    return <button type="button" key={item.slug} onClick={() => selectAndPreview(item)}><span className={`atlas-card-image atlas-memory--${story.image}`}><i>{story.chapters} chapters</i></span><span><small>{story.label}</small><strong>{story.name}</strong><em>{story.km} km · {story.climb} m</em></span><ArrowRight /></button>;
                  })}
                </div>
              </>
            )}
          </aside>
        </>
      )}
    </section>
  );
}

function TerrainLens({ region, selectedRoute, onSelectRoute }: { region: RegionView; selectedRoute: RouteSummary; onSelectRoute: (route: RouteSummary) => void }) {
  const vertical = [...region.atlas.routes].sort((a, b) => b.elevationGainM - a.elevationGainM)[0];
  const highest = [...region.atlas.routes].sort((a, b) => routeStory(b).highPoint - routeStory(a).highPoint)[0];
  const gentlest = [...region.atlas.routes].sort((a, b) => a.elevationGainM / a.distanceKm - b.elevationGainM / b.distanceKm)[0];
  const readings = [
    { label: "Most vertical", route: vertical, value: `+${vertical.elevationGainM.toLocaleString()} m`, note: "The region's strongest climb" },
    { label: "Highest trace", route: highest, value: `${routeStory(highest).highPoint.toLocaleString()} m`, note: "Where the route meets the sky" },
    { label: "Softest line", route: gentlest, value: `${Math.round(gentlest.elevationGainM / gentlest.distanceKm)} m/km`, note: "The easiest terrain rhythm" },
  ];

  return (
    <aside className="atlas-terrain-lens" aria-label="Terrain readings">
      <div className="atlas-terrain-lens-heading"><Mountain /><span><small>Terrain reading</small><strong>{region.atlas.totalClimbM.toLocaleString()} vertical metres remembered</strong></span></div>
      <div className="atlas-terrain-readings">
        {readings.map((reading) => (
          <button type="button" key={reading.label} aria-pressed={selectedRoute.slug === reading.route.slug} onClick={() => onSelectRoute(reading.route)}>
            <span><small>{reading.label}</small><strong>{reading.value}</strong></span>
            <em>{reading.note}</em>
            <ArrowRight />
          </button>
        ))}
      </div>
      <p>Choose a terrain story to illuminate its line on the globe.</p>
    </aside>
  );
}

function RoutePreview({ route, story, onBack, onReadStory }: { route: RouteSummary; story: RouteStory; onBack: () => void; onReadStory: () => void }) {
  return (
    <div className="atlas-route-preview">
      <button type="button" className="atlas-preview-back" onClick={onBack}><ArrowLeft /> All routes</button>
      <div className={`atlas-preview-hero atlas-memory--${story.image}`}><span>{route.date}</span></div>
      <div className="atlas-preview-title"><small>{story.label} · {route.type}</small><h1>{story.name}</h1><p>{story.blurb}</p></div>
      <dl className="atlas-preview-stats">
        <div><dt>Distance</dt><dd>{story.km} km</dd></div>
        <div><dt>Climb</dt><dd>+{story.climb} m</dd></div>
        <div><dt>High point</dt><dd>{story.highPoint.toLocaleString()} m</dd></div>
        <div><dt>Moving</dt><dd>{story.time}</dd></div>
      </dl>
      <div className="atlas-preview-profile">
        <span><small>Terrain profile</small><strong>{Math.round(story.climb / story.km)} m climbed per km</strong></span>
        <svg viewBox="0 0 320 72" role="img" aria-label="Illustrative elevation profile"><path d="M0 62 C28 60 42 45 68 48 S106 54 126 34 S164 12 184 24 S218 48 244 35 S276 7 320 16 L320 72 L0 72 Z" /><path d="M0 62 C28 60 42 45 68 48 S106 54 126 34 S164 12 184 24 S218 48 244 35 S276 7 320 16" /></svg>
      </div>
      <div className="atlas-preview-chapters"><small>Story chapters</small><div>{storyChapters.slice(0, 4).map((chapter) => <span key={chapter.name} className={`atlas-memory--${chapter.image}`} title={chapter.name} />)}</div></div>
      <button type="button" className="atlas-story-button atlas-story-button--primary" onClick={onReadStory}><BookOpen /> Read the route story <ArrowRight /></button>
      <a className="atlas-preview-replay-link" href={`#/replay/${route.slug}`}><Play /> Open live replay <ExternalLink /></a>
    </div>
  );
}

function EditorialRouteStory({ route, story, onBack, onReplay }: { route: RouteSummary; story: RouteStory; onBack: () => void; onReplay: () => void }) {
  const chapterCopy = [
    { kicker: "01 · Arrival", title: "The line begins quietly", body: `The first kilometres settle into ${route.region} before the terrain reveals its intent. The route is still a possibility here: light, weather, and one thin line leading outward.`, image: story.image },
    { kicker: "02 · The turning point", title: "Where effort becomes landscape", body: `The central climb carries most of the day's ${story.climb.toLocaleString()} vertical metres. Small decisions become visible in the terrain: where to hold the ridge, where to slow down, and where the horizon finally opens.`, image: story.image % 6 + 1 },
    { kicker: "03 · Return", title: "The route remembers differently", body: `On the way back, the same ground reads as evidence rather than uncertainty. ${story.km.toFixed(1)} kilometres become a sequence of places, each one attached to a feeling instead of a coordinate.`, image: (story.image + 2) % 6 + 1 },
  ];

  return (
    <article className="atlas-editorial-story">
      <header className="atlas-editorial-nav"><button type="button" onClick={onBack}><ArrowLeft /> Route collection</button><span>goDiesel · Field story</span><button type="button" onClick={onReplay}><Play /> Cinematic replay</button></header>
      <section className={`atlas-editorial-hero atlas-memory--${story.image}`}>
        <div className="atlas-editorial-hero-scrim" />
        <div className="atlas-editorial-hero-copy"><small>{route.region} · {route.date}</small><h1>{story.name}</h1><p>{story.blurb}</p><div><span>{story.km} km</span><span>+{story.climb} m</span><span>{story.chapters} chapters</span></div></div>
        <button type="button" className="atlas-editorial-scroll" onClick={() => document.getElementById("atlas-story-body")?.scrollIntoView({ behavior: "smooth" })}><ChevronDown /> Begin the story</button>
      </section>
      <section id="atlas-story-body" className="atlas-editorial-intro">
        <div><small>Field note</small><blockquote>“A route is not the line on the map. It is what the line lets you remember.”</blockquote></div>
        <dl><div><dt>High point</dt><dd>{story.highPoint.toLocaleString()} m</dd></div><div><dt>Moving time</dt><dd>{story.time}</dd></div><div><dt>Terrain</dt><dd>{route.difficulty}</dd></div></dl>
      </section>
      <section className="atlas-editorial-chapters">
        {chapterCopy.map((chapter, index) => (
          <section key={chapter.title} className={index % 2 ? "atlas-editorial-chapter atlas-editorial-chapter--reverse" : "atlas-editorial-chapter"}>
            <div className={`atlas-editorial-image atlas-memory--${chapter.image}`}><span>{String(index + 1).padStart(2, "0")}</span></div>
            <div><small>{chapter.kicker}</small><h2>{chapter.title}</h2><p>{chapter.body}</p><span className="atlas-editorial-measure">{(story.km * storyChapters[index + 1].fraction).toFixed(1)} km · {Math.round(story.climb * storyChapters[index + 1].elevation)} m gained</span></div>
          </section>
        ))}
      </section>
      <section className="atlas-editorial-replay">
        <div><small>Leave the page behind</small><h2>Fly the route as it happened.</h2><p>Follow the recorded line through terrain, time, elevation, and every chapter of the day.</p></div>
        <button type="button" onClick={onReplay}><Play /> Enter cinematic replay <ArrowRight /></button>
        <a href={`#/replay/${route.slug}`}>Open the live Google Maps replay <ExternalLink /></a>
      </section>
    </article>
  );
}

function DirectorStory({ route, routeSlug, onBack }: { route: RouteStory; routeSlug: string; onBack: () => void }) {
  const [progress, setProgress] = useState(46);
  const [playing, setPlaying] = useState(false);
  const activeIndex = Math.min(storyChapters.length - 1, Math.floor(progress / 20));
  const active = storyChapters[activeIndex];
  const distance = route.km * progress / 100;
  const elevation = Math.round(110 + (route.highPoint - 110) * active.elevation);
  const climb = Math.min(route.climb, Math.round(route.climb * Math.min(progress / 76, 1)));
  const speed = Math.max(3.2, route.avgSpeed + Math.cos(progress / 8) * 1.2);
  const grade = active.grade + Math.sin(progress / 6) * 0.8;
  const elapsed = formatElapsed(route.time, progress);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => setProgress((current) => current >= 100 ? 0 : current + 0.35), 60);
    return () => window.clearInterval(timer);
  }, [playing]);

  return (
    <section className="atlas-story-screen">
      <div className="atlas-story-scrim" />
      <header className="atlas-story-header">
        <button type="button" onClick={onBack}><ArrowLeft /> Route story</button>
        <div><small>Now replaying</small><strong>{route.name}</strong></div>
        <a href={`#/replay/${routeSlug}`}><Compass /> Open live replay</a>
      </header>
      <WorldRouteRibbon progress={progress} />
      <div className="atlas-story-place"><small>Chapter {activeIndex + 1}</small><h1>{active.name}</h1><p>{distance.toFixed(1)} km · {elevation.toLocaleString()} m</p></div>
      <div className="atlas-story-live-metrics" aria-live="polite">
        <span><small>Distance</small><strong>{distance.toFixed(1)} km</strong></span>
        <span><small>Elevation</small><strong>{elevation.toLocaleString()} m</strong></span>
        <span><small>Climb</small><strong>+{climb} m</strong></span>
        <span><small>Grade</small><strong>{grade > 0 ? "+" : ""}{grade.toFixed(1)}%</strong></span>
        <span><small>Speed</small><strong>{speed.toFixed(1)} km/h</strong></span>
        <span><small>Elapsed</small><strong>{elapsed}</strong></span>
      </div>
      <div className="atlas-story-timeline">
        <button type="button" className="atlas-story-play" onClick={() => setPlaying((current) => !current)} aria-label={playing ? "Pause" : "Play"}>{playing ? <Pause /> : <Play />}</button>
        <div className="atlas-story-track">
          <div className="atlas-story-progress" style={{ width: `${progress}%` }} />
          {storyChapters.map((chapter, index) => <button type="button" key={chapter.name} style={{ left: `${chapter.fraction * 100}%` }} aria-current={activeIndex === index ? "step" : undefined} onClick={() => setProgress(chapter.fraction * 100)}><span className={`atlas-memory atlas-memory--${chapter.image}`} /><i /><strong>{chapter.name}</strong></button>)}
          <input type="range" min="0" max="100" value={progress} onChange={(event) => setProgress(Number(event.target.value))} aria-label="Story progress" />
        </div>
        <span className="atlas-story-distance">{elapsed}</span>
      </div>
    </section>
  );
}

function formatElapsed(totalTime: string, progress: number) {
  const match = totalTime.match(/(?:(\d+)h)?\s*(\d+)m/);
  const totalMinutes = match ? Number(match[1] ?? 0) * 60 + Number(match[2]) : 0;
  const elapsedMinutes = Math.round(totalMinutes * progress / 100);
  return `${Math.floor(elapsedMinutes / 60)}:${String(elapsedMinutes % 60).padStart(2, "0")}`;
}

function WorldRouteRibbon({ progress = 62 }: { progress?: number }) {
  return <svg className="atlas-world-route" viewBox="0 0 1000 620" aria-label="Selected route"><path className="atlas-world-route-halo" d="M80 535 C190 500 240 445 330 470 S470 390 515 325 S640 300 710 212 S835 180 930 70" /><path className="atlas-world-route-line" pathLength="100" strokeDasharray={`${progress} ${100 - progress}`} d="M80 535 C190 500 240 445 330 470 S470 390 515 325 S640 300 710 212 S835 180 930 70" />{[18, 38, 58, 78, 94].map((point, index) => <circle key={point} cx={155 + index * 178} cy={500 - index * 100} r="9" />)}</svg>;
}
