import "@fontsource-variable/figtree";
import "@fontsource-variable/newsreader";

import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  Check,
  CloudSun,
  Compass,
  Eye,
  EyeOff,
  Film,
  Focus,
  Gauge,
  Layers3,
  ListFilter,
  LocateFixed,
  Map,
  MapPin,
  Mountain,
  Pause,
  Play,
  RefreshCw,
  Route,
  Search,
  SlidersHorizontal,
  Sparkles,
  WandSparkles,
  X,
} from "lucide-react";
import {
  type ComponentPropsWithoutRef,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { useSearchParams } from "react-router-dom";

import "./daydream-atlas-prototype.css";
import { AtlasJourneyPrototype } from "./reviewable-atlas-prototype";

const concepts = [
  ["review-flow", "Atlas journey"],
  ["living-thread", "Living route thread"],
  ["route-lens", "Route Lens"],
  ["constraint-negotiator", "Constraint negotiator"],
  ["spatial-command", "Spatial command"],
  ["map-sheet", "Map-aware sheet"],
  ["continuity", "Spatial continuity"],
  ["intent-chrome", "Intent-revealing chrome"],
  ["evidence-lens", "Evidence Lens"],
  ["provider-fallback", "Provider fallback"],
  ["director-chapters", "Director chapters"],
] as const;

type ConceptId = (typeof concepts)[number][0];

const chapters = [
  { name: "Sea light", distance: 0.8, elevation: 120, color: "sky" },
  { name: "First climb", distance: 4.6, elevation: 420, color: "grass" },
  { name: "Cloud break", distance: 9.2, elevation: 820, color: "petal" },
  { name: "High traverse", distance: 14.8, elevation: 1245, color: "lavender" },
  { name: "Return glow", distance: 20.4, elevation: 680, color: "apricot" },
] as const;

const routes = [
  { name: "White Mountains Traverse", place: "Crete", km: 21.3, climb: 680, match: 96, color: "apricot", image: 1 },
  { name: "High Raise Loop", place: "Lake District", km: 16.8, climb: 420, match: 92, color: "sky", image: 2 },
  { name: "Alpine Sunset Circuit", place: "Dolomites", km: 18.4, climb: 910, match: 87, color: "lavender", image: 3 },
  { name: "Cascade Canyon Out & Back", place: "Grand Teton", km: 15.2, climb: 560, match: 82, color: "petal", image: 4 },
] as const;

function conceptFrom(value: string | null): ConceptId {
  return concepts.some(([id]) => id === value) ? (value as ConceptId) : "review-flow";
}

export function DaydreamAtlasPrototypePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const concept = conceptFrom(searchParams.get("concept"));
  const conceptIndex = concepts.findIndex(([id]) => id === concept);

  function selectConcept(next: ConceptId) {
    setSearchParams({ concept: next }, { replace: true });
  }

  function stepConcept(delta: number) {
    const next = concepts[(conceptIndex + delta + concepts.length) % concepts.length][0];
    selectConcept(next);
  }

  return (
    <div className="daydream-prototype" data-concept={concept}>
      <a className="daydream-skip" href="#daydream-scene">Skip to prototype</a>
      {concept !== "review-flow" ? <PrototypeTopbar concept={concept} /> : null}
      <main id="daydream-scene" className="daydream-scene" tabIndex={-1}>
        <ConceptScene concept={concept} />
      </main>
      {concept !== "review-flow" ? <nav className="daydream-switcher" aria-label="Prototype concepts">
        <button type="button" className="daydream-switcher-step" onClick={() => stepConcept(-1)} aria-label="Previous concept">
          <ArrowLeft aria-hidden="true" />
        </button>
        <div className="daydream-switcher-track">
          {concepts.map(([id, label], index) => (
            <button
              type="button"
              key={id}
              aria-current={id === concept ? "page" : undefined}
              className="daydream-switcher-item"
              onClick={() => selectConcept(id)}
              title={label}
            >
              <span>{String(index + 1).padStart(2, "0")}</span>
              <span className="daydream-switcher-label">{label}</span>
            </button>
          ))}
        </div>
        <button type="button" className="daydream-switcher-step" onClick={() => stepConcept(1)} aria-label="Next concept">
          <ArrowRight aria-hidden="true" />
        </button>
      </nav> : null}
    </div>
  );
}

function PrototypeTopbar({ concept }: { concept: ConceptId }) {
  const label = concepts.find(([id]) => id === concept)?.[1] ?? "Prototype";
  return (
    <header className="daydream-topbar">
      <div className="daydream-wordmark">goDiesel</div>
      <div className="daydream-prototype-title">
        <span>Daydream Atlas prototype</span>
        <strong>{label}</strong>
      </div>
      <div className="daydream-topbar-status"><span /> Throwaway lab</div>
    </header>
  );
}

function ConceptScene({ concept }: { concept: ConceptId }) {
  switch (concept) {
    case "review-flow": return <AtlasJourneyPrototype />;
    case "living-thread": return <LivingThreadScene />;
    case "route-lens": return <RouteLensScene />;
    case "constraint-negotiator": return <ConstraintScene />;
    case "spatial-command": return <CommandScene />;
    case "map-sheet": return <MapSheetScene />;
    case "continuity": return <ContinuityScene />;
    case "intent-chrome": return <IntentChromeScene />;
    case "evidence-lens": return <EvidenceScene />;
    case "provider-fallback": return <FallbackScene />;
    case "director-chapters": return <DirectorScene />;
  }
}

function Stage({ children, tone = "world", className = "", ...sectionProps }: ComponentPropsWithoutRef<"section"> & { children: ReactNode; tone?: "world" | "desk" | "story" }) {
  return <section className={`daydream-stage daydream-stage--${tone} ${className}`} {...sectionProps}>{children}</section>;
}

function PlaceIdentity({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`daydream-place ${compact ? "daydream-place--compact" : ""}`}>
      <div className="daydream-place-kicker">Recorded memory</div>
      <h1>Crete</h1>
      <p>White Mountains Traverse</p>
      <div className="daydream-metrics">
        <span><Route aria-hidden="true" />21.3 km</span>
        <span><Mountain aria-hidden="true" />680 m</span>
        <span className="daydream-recorded"><i />Recorded</span>
      </div>
    </div>
  );
}

function MapControls({ mode = "3D" }: { mode?: string }) {
  return (
    <div className="daydream-map-controls" aria-label="Map controls">
      <button type="button" aria-label="Locate route"><LocateFixed aria-hidden="true" /></button>
      <button type="button" aria-label="Map layers"><Layers3 aria-hidden="true" /></button>
      <button type="button" aria-label={`Current map mode ${mode}`}><span>{mode}</span></button>
    </div>
  );
}

function RouteRibbon({ progress = 48, compare = false, evidence = false }: { progress?: number; compare?: boolean; evidence?: boolean }) {
  const markerX = 122 + progress * 7.8;
  return (
    <svg className="daydream-route-ribbon" viewBox="0 0 1000 620" role="img" aria-label={`Route preview, ${progress}% complete`}>
      <path className="daydream-route-halo" d="M90 540 C170 500 210 470 280 482 S390 430 420 360 S520 312 580 335 S680 278 720 208 S830 175 910 82" />
      <path className="daydream-route-future" d="M90 540 C170 500 210 470 280 482 S390 430 420 360 S520 312 580 335 S680 278 720 208 S830 175 910 82" />
      <path className="daydream-route-travelled" pathLength="100" strokeDasharray={`${progress} ${100 - progress}`} d="M90 540 C170 500 210 470 280 482 S390 430 420 360 S520 312 580 335 S680 278 720 208 S830 175 910 82" />
      {compare ? <path className="daydream-route-compare" d="M125 555 C225 510 250 412 340 450 S470 402 508 295 S655 310 690 242 S806 182 880 108" /> : null}
      {chapters.map((chapter, index) => (
        <circle key={chapter.name} className={`daydream-chapter-dot daydream-chapter-dot--${chapter.color}`} cx={170 + index * 165} cy={508 - index * 95} r="9" />
      ))}
      {evidence ? Array.from({ length: 16 }, (_, index) => (
        <circle key={index} className="daydream-evidence-sample" cx={110 + index * 51} cy={528 - Math.sin(index * 0.8) * 80 - index * 24} r="3" />
      )) : null}
      <circle className="daydream-current-halo" cx={Math.min(markerX, 900)} cy={Math.max(95, 540 - progress * 4.3)} r="19" />
      <circle className="daydream-current" cx={Math.min(markerX, 900)} cy={Math.max(95, 540 - progress * 4.3)} r="9" />
    </svg>
  );
}

function LivingThreadScene() {
  const [progress, setProgress] = useState(46);
  const active = chapters[Math.min(chapters.length - 1, Math.floor(progress / 20))];
  return (
    <Stage tone="story">
      <div className="daydream-world-shade" />
      <PlaceIdentity />
      <MapControls />
      <RouteRibbon progress={progress} />
      <div className="daydream-active-chapter" aria-live="polite">
        <Sparkles aria-hidden="true" />
        <span>Now crossing</span>
        <strong>{active.name}</strong>
        <small>{active.distance} km · {active.elevation} m</small>
      </div>
      <LivingThread progress={progress} onProgress={setProgress} />
      <StateReadout>distance {(21.3 * progress / 100).toFixed(1)} km · chapter {active.name} · map, photos, elevation synchronized</StateReadout>
    </Stage>
  );
}

function LivingThread({ progress, onProgress, playing = false, onPlaying }: { progress: number; onProgress: (value: number) => void; playing?: boolean; onPlaying?: () => void }) {
  return (
    <div className="daydream-living-thread">
      <button type="button" className="daydream-play" aria-label={playing ? "Pause replay" : "Play replay"} onClick={onPlaying}>
        {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
      </button>
      <div className="daydream-thread-time">{formatTime(progress)}</div>
      <div className="daydream-thread-track">
        <div className="daydream-thread-images" aria-hidden="true">
          {[1, 2, 3, 4, 5].map((image, index) => <span key={image} className={`daydream-memory-thumb daydream-memory-thumb--${image}`} style={{ left: `${12 + index * 19}%` }} />)}
        </div>
        <svg viewBox="0 0 1000 80" preserveAspectRatio="none" aria-hidden="true">
          <path className="daydream-elevation-area" d="M0 72 L0 64 C85 58 120 35 180 44 S285 62 330 30 S430 12 500 38 S600 70 660 42 S740 15 815 52 S920 66 1000 45 L1000 72 Z" />
          <path className="daydream-elevation-line" d="M0 64 C85 58 120 35 180 44 S285 62 330 30 S430 12 500 38 S600 70 660 42 S740 15 815 52 S920 66 1000 45" />
        </svg>
        <input aria-label="Route progress" type="range" min="0" max="100" value={progress} onChange={(event) => onProgress(Number(event.target.value))} />
      </div>
      <div className="daydream-thread-distance">{(21.3 * progress / 100).toFixed(1)} km</div>
    </div>
  );
}

function RouteLensScene() {
  const [preview, setPreview] = useState(0);
  const [pinned, setPinned] = useState<number[]>([]);
  const selected = routes[preview];

  function togglePin(index: number) {
    setPinned((current) => current.includes(index) ? current.filter((value) => value !== index) : [...current, index].slice(-2));
  }

  return (
    <Stage tone="world" className="daydream-lens-scene">
      <div className="daydream-world-shade" />
      <RouteRibbon progress={42} compare={pinned.length > 1} />
      <div className="daydream-route-browser" aria-label="Routes">
        <div className="daydream-browser-heading"><span>Route Lens</span><small>Focus or hover to preview</small></div>
        {routes.map((route, index) => (
          <button
            type="button"
            key={route.name}
            className="daydream-route-row"
            data-active={preview === index}
            onMouseEnter={() => setPreview(index)}
            onFocus={() => setPreview(index)}
          >
            <span className={`daydream-memory-thumb daydream-memory-thumb--${route.image}`} />
            <span><strong>{route.place}</strong><small>{route.name}</small></span>
            <span><strong>{route.km} km</strong><small>{route.climb} m</small></span>
          </button>
        ))}
      </div>
      <aside className="daydream-lens-card" aria-live="polite">
        <div className="daydream-lens-label"><Focus aria-hidden="true" /> Live preview</div>
        <h1>{selected.place}</h1>
        <p>{selected.name}</p>
        <div className="daydream-lens-facts"><span>{selected.km} km</span><span>{selected.climb} m</span><span>{selected.match}% match</span></div>
        <div className="daydream-lens-actions">
          <button type="button"><Play aria-hidden="true" />Preview</button>
          <button type="button" data-active={pinned.includes(preview)} onClick={() => togglePin(preview)}><Bookmark aria-hidden="true" />{pinned.includes(preview) ? "Pinned" : "Pin"}</button>
        </div>
      </aside>
      {pinned.length ? <div className="daydream-compare-float"><strong>Compare {pinned.length}</strong>{pinned.map((index) => <span key={index}>{routes[index].place}</span>)}</div> : null}
      <StateReadout>preview {selected.place} · {pinned.length} pinned · release focus returns without navigation</StateReadout>
    </Stage>
  );
}

function ConstraintScene() {
  const [distance, setDistance] = useState(18);
  const [climb, setClimb] = useState(600);
  const matching = routes.filter((route) => route.km <= distance && route.climb <= climb);
  const unlockCount = routes.filter((route) => route.km <= distance + 4 && route.climb <= climb + 200).length - matching.length;
  return (
    <Stage tone="desk" className="daydream-constraint-scene">
      <DeskNav active="Find" />
      <section className="daydream-constraint-copy">
        <span className="daydream-eyebrow"><WandSparkles aria-hidden="true" /> Find a day that fits</span>
        <h1>What kind of outside<br />do you have time for?</h1>
        <p>Set the edges. We will show the trade-offs, not hide them.</p>
        <label>Maximum distance <strong>{distance} km</strong><input type="range" min="10" max="28" value={distance} onChange={(event) => setDistance(Number(event.target.value))} /></label>
        <label>Maximum climb <strong>{climb} m</strong><input type="range" min="300" max="1200" step="50" value={climb} onChange={(event) => setClimb(Number(event.target.value))} /></label>
        <div className="daydream-filter-tokens"><span>Recorded</span><span>Gentle terrain</span><span>Morning light</span></div>
      </section>
      <section className="daydream-constraint-results" aria-live="polite">
        <header><div><small>Best fit</small><h2>{matching.length} routes match</h2></div><SlidersHorizontal aria-hidden="true" /></header>
        {matching.length ? matching.map((route) => <ConstraintResult key={route.name} route={route} />) : <div className="daydream-no-match"><CloudSun aria-hidden="true" /><h3>No exact match yet</h3><p>The closest day is just beyond one edge.</p></div>}
        <div className="daydream-relaxation">
          <Sparkles aria-hidden="true" />
          <div><strong>Allow 4 km or 200 m more</strong><span>Reveal {Math.max(unlockCount, 2)} routes with similar light and terrain.</span></div>
          <button type="button" onClick={() => { setDistance((value) => value + 4); setClimb((value) => value + 200); }}>Relax both</button>
        </div>
      </section>
      <StateReadout>constraints {distance} km / {climb} m · {matching.length} exact matches · smallest relaxation calculated locally</StateReadout>
    </Stage>
  );
}

function ConstraintResult({ route }: { route: (typeof routes)[number] }) {
  return <article className="daydream-constraint-result"><span className={`daydream-memory-thumb daydream-memory-thumb--${route.image}`} /><div><small>{route.place}</small><strong>{route.name}</strong><span>Why: under both limits · {route.match}% terrain fit</span></div><div><strong>{route.km} km</strong><span>{route.climb} m</span></div></article>;
}

const commandOptions = [
  { group: "Places", label: "Crete", detail: "7 recorded memories", icon: MapPin },
  { group: "Routes", label: "White Mountains Traverse", detail: "21.3 km · 680 m", icon: Route },
  { group: "Actions", label: "Replay the cloud break", detail: "Jump to chapter 3", icon: Film },
  { group: "Actions", label: "Find a gentle morning route", detail: "Open negotiated search", icon: WandSparkles },
] as const;

function CommandScene() {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [executed, setExecuted] = useState<string>();
  const filtered = commandOptions.filter((option) => `${option.group} ${option.label} ${option.detail}`.toLowerCase().includes(query.toLowerCase()));

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") { event.preventDefault(); setActive((value) => Math.min(value + 1, filtered.length - 1)); }
    if (event.key === "ArrowUp") { event.preventDefault(); setActive((value) => Math.max(value - 1, 0)); }
    if (event.key === "Enter" && filtered[active]) { setExecuted(filtered[active].label); }
  }

  return (
    <Stage tone="world" className="daydream-command-scene">
      <div className="daydream-world-shade" />
      <RouteRibbon progress={executed ? 64 : 28} />
      <PlaceIdentity compact />
      <div className="daydream-command" role="dialog" aria-label="Spatial command">
        <label><Search aria-hidden="true" /><input autoFocus value={query} onChange={(event) => { setQuery(event.target.value); setActive(0); }} onKeyDown={handleKeyDown} placeholder="Search places, routes, and actions" /><kbd>ESC</kbd></label>
        <div role="listbox" aria-label="Command results">
          {filtered.map((option, index) => {
            const Icon = option.icon;
            return <button type="button" role="option" aria-selected={index === active} key={option.label} onMouseEnter={() => setActive(index)} onClick={() => setExecuted(option.label)}><Icon aria-hidden="true" /><span><small>{option.group}</small><strong>{option.label}</strong><em>{option.detail}</em></span><ArrowRight aria-hidden="true" /></button>;
          })}
        </div>
        <footer><span><kbd>↑</kbd><kbd>↓</kbd> Preview</span><span><kbd>↵</kbd> Open</span><span>Map preview updates behind results</span></footer>
      </div>
      {executed ? <div className="daydream-command-success" aria-live="polite"><Check aria-hidden="true" />Opened {executed}</div> : null}
      <StateReadout>query “{query || "all"}” · highlight {filtered[active]?.label ?? "none"} · action {executed ?? "not committed"}</StateReadout>
    </Stage>
  );
}

type SheetSnap = "peek" | "half" | "full";
function MapSheetScene() {
  const [snap, setSnap] = useState<SheetSnap>("peek");
  const [route, setRoute] = useState(0);
  return (
    <Stage tone="world" className={`daydream-sheet-scene daydream-sheet-scene--${snap}`}>
      <RouteRibbon progress={37 + route * 8} />
      <div className="daydream-sheet-map-label">Camera inset <strong>{snap === "peek" ? "180 px" : snap === "half" ? "52 vh" : "82 vh"}</strong></div>
      <MapControls />
      <aside className="daydream-mobile-sheet" data-snap={snap}>
        <div className="daydream-sheet-handle" aria-hidden="true" />
        <div className="daydream-sheet-snap-controls" aria-label="Sheet position">
          {(["peek", "half", "full"] as const).map((value) => <button type="button" key={value} aria-pressed={snap === value} onClick={() => setSnap(value)}>{value}</button>)}
        </div>
        <div className="daydream-sheet-route-nav"><button type="button" onClick={() => setRoute((value) => (value + routes.length - 1) % routes.length)} aria-label="Previous route"><ArrowLeft /></button><span>{route + 1} / {routes.length}</span><button type="button" onClick={() => setRoute((value) => (value + 1) % routes.length)} aria-label="Next route"><ArrowRight /></button></div>
        <h1>{routes[route].place}</h1><p>{routes[route].name}</p>
        <div className="daydream-sheet-metrics"><span>{routes[route].km} km<small>Distance</small></span><span>{routes[route].climb} m<small>Climb</small></span><span>{routes[route].match}%<small>Match</small></span></div>
        <div className="daydream-sheet-body"><div className={`daydream-sheet-photo daydream-memory-thumb--${routes[route].image}`} /><h2>Follow the light through the high country.</h2><p>The map remains interactive at peek and half. Camera framing changes with the occupied sheet height, preserving the selected route above the fold.</p><button type="button"><Play />Replay this memory</button></div>
      </aside>
      <StateReadout>sheet {snap} · camera reserves matching inset · horizontal route {route + 1} · map remains interactive</StateReadout>
    </Stage>
  );
}

function ContinuityScene() {
  const [mode, setMode] = useState<"library" | "detail">("library");
  const [selected, setSelected] = useState(0);
  const [filter, setFilter] = useState("All memories");
  const [returnMessage, setReturnMessage] = useState(false);

  function transition(next: "library" | "detail") {
    const documentWithTransition = document as Document & { startViewTransition?: (callback: () => void) => void };
    if (documentWithTransition.startViewTransition) documentWithTransition.startViewTransition(() => setMode(next));
    else setMode(next);
    if (next === "library") { setReturnMessage(true); window.setTimeout(() => setReturnMessage(false), 1800); }
  }

  return (
    <Stage tone="desk" className="daydream-continuity-scene">
      <DeskNav active="Routes" />
      {mode === "library" ? <section className="daydream-continuity-library">
        <header><div><small>Your route memory</small><h1>Routes</h1></div><label><ListFilter /><select value={filter} onChange={(event) => setFilter(event.target.value)}><option>All memories</option><option>Mountain days</option><option>Morning light</option></select></label></header>
        {returnMessage ? <div className="daydream-return-toast"><Check />Returned to {filter} at the same position</div> : null}
        <div className="daydream-continuity-grid">{routes.map((route, index) => <button type="button" key={route.name} data-active={selected === index} onFocus={() => setSelected(index)} onMouseEnter={() => setSelected(index)} onClick={() => { setSelected(index); transition("detail"); }}><span className={`daydream-continuity-image daydream-memory-thumb--${route.image}`} style={{ viewTransitionName: selected === index ? "route-memory" : undefined }} /><small>{route.place}</small><strong>{route.name}</strong><span>{route.km} km · {route.climb} m</span></button>)}</div>
      </section> : <section className="daydream-continuity-detail">
        <div className={`daydream-continuity-hero daydream-memory-thumb--${routes[selected].image}`} style={{ viewTransitionName: "route-memory" }}><RouteRibbon progress={54} /></div>
        <aside><button type="button" onClick={() => transition("library")}><ArrowLeft />Back to {filter}</button><small>{routes[selected].place}</small><h1>{routes[selected].name}</h1><p>Navigation preserves the route, filter, scroll position, camera framing, and inspection state.</p><div className="daydream-sheet-metrics"><span>{routes[selected].km} km<small>Distance</small></span><span>{routes[selected].climb} m<small>Climb</small></span></div></aside>
      </section>}
      <StateReadout>view {mode} · selected {routes[selected].place} · filter {filter} · return state preserved</StateReadout>
    </Stage>
  );
}

type MapIntent = "explore" | "zoom" | "select" | "scrub";
function IntentChromeScene() {
  const [intent, setIntent] = useState<MapIntent>("explore");
  return (
    <Stage tone="world" className={`daydream-intent-scene daydream-intent-scene--${intent}`}>
      <RouteRibbon progress={intent === "scrub" ? 72 : intent === "select" ? 48 : 20} />
      <div className="daydream-intent-picker" role="group" aria-label="Simulate interaction intent">{(["explore", "zoom", "select", "scrub"] as const).map((value) => <button type="button" key={value} aria-pressed={intent === value} onClick={() => setIntent(value)}>{value}</button>)}</div>
      <div className="daydream-intent-message"><small>Interface response</small><strong>{intent === "explore" ? "Terrain gets the room" : intent === "zoom" ? "Orientation tools arrive" : intent === "select" ? "Route actions arrive" : "Timeline and telemetry arrive"}</strong></div>
      <div className="daydream-context-chrome" aria-live="polite">
        {intent !== "explore" ? <button type="button"><Compass />Reset north</button> : null}
        {intent === "zoom" ? <><button type="button">+</button><button type="button">−</button></> : null}
        {intent === "select" ? <><button type="button"><Play />Preview</button><button type="button"><Bookmark />Pin</button></> : null}
        {intent === "scrub" ? <><span>14.8 km</span><span>1,245 m</span><button type="button"><Focus />Follow</button></> : null}
      </div>
      {intent === "scrub" ? <LivingThread progress={72} onProgress={() => undefined} /> : null}
      <StateReadout>intent {intent} · chrome set {intent === "explore" ? "minimal" : "contextual"} · keyboard focus always overrides hiding</StateReadout>
    </Stage>
  );
}

function EvidenceScene() {
  const [layers, setLayers] = useState({ recorded: true, derived: true, editorial: false, repairs: false });
  const toggle = (key: keyof typeof layers) => setLayers((current) => ({ ...current, [key]: !current[key] }));
  return (
    <Stage tone="desk" className="daydream-evidence-scene">
      <DeskNav active="Evidence" />
      <div className="daydream-evidence-map"><RouteRibbon progress={58} evidence={layers.recorded} /><div className="daydream-evidence-legend">{Object.entries(layers).map(([key, enabled]) => <button type="button" key={key} aria-pressed={enabled} onClick={() => toggle(key as keyof typeof layers)}>{enabled ? <Eye /> : <EyeOff />}<span>{key}<small>{evidenceCopy[key as keyof typeof layers]}</small></span></button>)}</div></div>
      <aside className="daydream-evidence-inspector"><span className="daydream-eyebrow"><Eye /> Evidence Lens</span><h1>Know what the route knows.</h1><p>Recorded truth, measured facts, repair work, and editorial interpretation remain visibly distinct.</p><div className="daydream-evidence-events"><article><i className="recorded" /><small>Recorded · 4.6 km</small><strong>GPS sample density changed</strong><p>Original Garmin track, 1-second samples.</p></article>{layers.repairs ? <article><i className="repair" /><small>Repaired · 8.9 km</small><strong>26 m gap reconstructed</strong><p>Connected between adjacent recorded points. Original geometry remains available.</p></article> : null}{layers.derived ? <article><i className="derived" /><small>Derived · 14.8 km</small><strong>High traverse chapter</strong><p>Detected from elevation and terrain exposure.</p></article> : null}{layers.editorial ? <article><i className="editorial" /><small>Editorial · 18.3 km</small><strong>Return glow</strong><p>A human-authored name for the final chapter.</p></article> : null}</div></aside>
      <StateReadout>{Object.entries(layers).filter(([, value]) => value).map(([key]) => key).join(" + ")} visible · original route never hidden</StateReadout>
    </Stage>
  );
}

const evidenceCopy = { recorded: "Original GPS and photos", derived: "Calculated from route data", editorial: "Human interpretation", repairs: "Transparent geometry fixes" } as const;

type ProviderState = "3d" | "failing" | "2d";
function FallbackScene() {
  const [provider, setProvider] = useState<ProviderState>("3d");
  const [progress, setProgress] = useState(44);
  const timeout = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timeout.current), []);
  function fail() { setProvider("failing"); timeout.current = window.setTimeout(() => setProvider("2d"), 900); }
  function retry() { setProvider("failing"); timeout.current = window.setTimeout(() => setProvider("3d"), 900); }
  return (
    <Stage tone={provider === "2d" ? "desk" : "story"} className={`daydream-fallback-scene daydream-fallback-scene--${provider}`}>
      <RouteRibbon progress={progress} />
      <PlaceIdentity compact />
      <div className="daydream-provider-debug"><Gauge /><span>Renderer simulation</span><button type="button" onClick={fail} disabled={provider !== "3d"}>Simulate 3D interruption</button></div>
      {provider === "failing" ? <div className="daydream-provider-loading" role="status"><RefreshCw />Transferring camera, route, and playback…</div> : null}
      {provider === "2d" ? <div className="daydream-provider-banner" role="status"><Map /> <span><strong>3D paused. Continuing in map mode.</strong><small>Your position and route context were preserved.</small></span><button type="button" onClick={retry}>Retry 3D</button><button type="button" aria-label="Dismiss"><X /></button></div> : null}
      <LivingThread progress={progress} onProgress={setProgress} />
      <StateReadout>renderer {provider} · playback {progress}% · selection Crete · camera bounds preserved</StateReadout>
    </Stage>
  );
}

function DirectorScene() {
  const [progress, setProgress] = useState(48);
  const [playing, setPlaying] = useState(false);
  const [steering, setSteering] = useState(false);
  const activeIndex = Math.min(chapters.length - 1, Math.floor(progress / 20));
  useEffect(() => {
    if (!playing || steering) return;
    const interval = window.setInterval(() => setProgress((value) => value >= 100 ? 0 : value + 0.4), 50);
    return () => window.clearInterval(interval);
  }, [playing, steering]);
  return (
    <Stage tone="story" className="daydream-director-scene" onPointerDownCapture={(event) => { if ((event.target as HTMLElement).closest("button,input,.daydream-chapter-rail")) return; setSteering(true); }}>
      <div className="daydream-world-shade" />
      <RouteRibbon progress={progress} />
      <PlaceIdentity compact />
      <div className="daydream-director-tools"><button type="button" aria-pressed={!steering}><LocateFixed />Follow</button><button type="button" aria-pressed={steering} onClick={() => setSteering(true)}><Compass />Free camera</button><button type="button"><Eye />Evidence</button></div>
      {steering ? <div className="daydream-steering"><span>You are steering</span><button type="button" onClick={() => setSteering(false)}>Resume story <ArrowRight /></button></div> : null}
      <div className="daydream-chapter-rail" aria-label="Replay chapters">{chapters.map((chapter, index) => <button type="button" key={chapter.name} aria-current={activeIndex === index ? "step" : undefined} onClick={() => { setProgress(index * 20 + 8); setSteering(false); }}><span className={`daydream-memory-thumb daydream-memory-thumb--${index + 1}`} /><i /><span><strong>{chapter.name}</strong><small>{chapter.distance} km · {chapter.elevation} m</small></span></button>)}</div>
      <LivingThread progress={progress} onProgress={(value) => { setProgress(value); setSteering(false); }} playing={playing} onPlaying={() => setPlaying((value) => !value)} />
      <StateReadout>chapter {chapters[activeIndex].name} · director {steering ? "paused for manual camera" : playing ? "playing" : "ready"} · {progress.toFixed(0)}%</StateReadout>
    </Stage>
  );
}

function DeskNav({ active }: { active: string }) {
  return <nav className="daydream-desk-nav" aria-label="Prototype navigation"><div className="daydream-wordmark">goDiesel</div>{[[Map, "Atlas"], [Search, "Find"], [Route, "Routes"], [Film, "Replay"], [Eye, "Evidence"]].map(([Icon, label]) => { const NavIcon = Icon as typeof Map; return <button type="button" key={label as string} aria-current={label === active ? "page" : undefined}><NavIcon aria-hidden="true" /><span>{label as string}</span></button>; })}</nav>;
}

function StateReadout({ children }: { children: ReactNode }) {
  return <div className="daydream-state" aria-live="polite"><span>State</span>{children}</div>;
}

function formatTime(progress: number) {
  const seconds = Math.round(progress * 117.8);
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
