import { ChevronDown, ChevronUp, Gauge, Pause, Play } from "lucide-react";
import { useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";

import type { QuestRoute } from "@/domain/route";
import {
  buildReplayChapterModel,
  replayChapterAt,
  replayElevationAt,
  replayProfileInSpan,
  type ReplayChapterModel,
  type ReplaySpan,
} from "@/surfaces/replay/playback/replay-chapter-model";
import {
  replayPreviewSpan,
  type ReplayChapterControlsEvent,
  type ReplayChapterControlsState,
} from "@/surfaces/replay/playback/replay-chapter-controls-state";
import "./replay-chapter-controls.css";

export interface ReplayChapterControlsProps {
  route: QuestRoute;
  state: ReplayChapterControlsState;
  progressM: number;
  playing: boolean;
  speed: number;
  disabled: boolean;
  expanded: boolean;
  cameraControls: ReactNode;
  metrics: ReactNode;
  onExpandedChange: (expanded: boolean) => void;
  onEvent: (event: ReplayChapterControlsEvent) => void;
  onPlayFromPreview: () => void;
  onTogglePlayback: () => void;
  onSeek: (progressM: number) => void;
  onCycleSpeed: () => void;
}

export function ReplayChapterControls({
  route, state, progressM, playing, speed, disabled, expanded, cameraControls, metrics,
  onExpandedChange, onEvent, onPlayFromPreview, onTogglePlayback, onSeek, onCycleSpeed,
}: ReplayChapterControlsProps) {
  const model = useMemo(() => buildReplayChapterModel(route), [route]);
  const [presentation, setPresentation] = useState<"relief" | "profile">("relief");
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [whyOpen, setWhyOpen] = useState(false);
  const browserId = useId();
  const explanationId = useId();
  const metricsId = useId();
  const browserRef = useRef<HTMLDivElement>(null);
  const lensInputRef = useRef<HTMLInputElement>(null);
  const preview = state.mode === "preview" ? state : undefined;
  const currentChapter = replayChapterAt(model, progressM);
  const selectedMoment = preview?.target.kind === "moment" ? preview.target.moment : undefined;
  const selectedChapter = preview?.target.kind === "chapter" ? preview.target.chapter : replayChapterAt(model, preview?.progressM ?? progressM);
  const wholeSpan = { startM: 0, endM: model.totalDistanceM };
  const selectedSpan = preview ? replayPreviewSpan(preview) : currentChapter ?? wholeSpan;
  const lensSpan = state.scope === "whole" ? wholeSpan : selectedSpan;
  const lensProgressM = preview?.progressM ?? progressM;
  const lensElevationM = replayElevationAt(model, lensProgressM);
  const selectedLabel = selectedMoment?.label ?? selectedChapter?.label ?? "Route";
  const storyChapter = selectedMoment ? undefined : selectedChapter;
  const featureM = selectedMoment?.valueM ?? Math.max(selectedChapter?.ascentM ?? 0, selectedChapter?.descentM ?? 0);
  const featureLabel = selectedMoment ? selectedMoment.kind === "descent" ? "descending" : "elevation" :
    (selectedChapter?.descentM ?? 0) > (selectedChapter?.ascentM ?? 0) ? "descending" : "climbing";

  useLayoutEffect(() => {
    if (!preview) return;
    lensInputRef.current?.focus({ preventScroll: true });
    const browser = browserRef.current;
    const lens = lensInputRef.current?.parentElement;
    if (!browser || !lens) return;
    browser.scrollTop = browser.clientHeight < 300
      ? browser.scrollTop + lens.getBoundingClientRect().top - browser.getBoundingClientRect().top
      : 0;
  }, [preview?.target]);

  const selectPreview = (event: ReplayChapterControlsEvent) => {
    setWhyOpen(false);
    onEvent(event);
  };

  const movePreview = (nextM: number) => {
    if (!preview && currentChapter) {
      onEvent({ type: "chapterSelected", chapter: currentChapter });
      if (state.scope === "whole") onEvent({ type: "scopeChanged", scope: "whole", totalDistanceM: model.totalDistanceM });
    }
    onEvent({ type: "previewMoved", progressM: nextM, totalDistanceM: model.totalDistanceM });
  };

  const lens = <>
    <div className="replay-chapter-lens" data-testid="replay-chapter-lens" data-presentation={presentation}>
      <Profile model={model} span={lensSpan} progressM={progressM} previewM={preview?.progressM} relief={presentation === "relief"} />
      <input ref={lensInputRef} style={profileRangeStyle(presentation === "relief", false)} type="range" aria-label="Chapter preview position" aria-valuetext={`${distance(lensProgressM)} kilometers, ${lensElevationM === undefined ? "recording gap" : `${Math.round(lensElevationM)} meters elevation`}. Adjusting previews without moving replay.`} min={lensSpan.startM} max={lensSpan.endM} step="any" value={Math.max(lensSpan.startM, Math.min(lensSpan.endM, lensProgressM))} disabled={disabled || lensSpan.endM <= lensSpan.startM} onChange={event => movePreview(Number(event.target.value))} />
    </div>
    <div className="replay-chapter-axis"><span>{distance(lensSpan.startM)} km</span><span>{presentation === "relief" ? "Exaggerated elevation relief" : `${Math.round(model.minimumElevationM)} to ${Math.round(model.maximumElevationM)} m elevation`}</span><span>{distance(lensSpan.endM)} km</span></div>
  </>;

  return (
    <div className="replay-chapter-controls pointer-events-auto" data-testid="google-route-controls" data-preview-mode={state.mode} data-expanded={expanded}>
      <div className="replay-chapter-heading" data-testid="replay-chapter-controls">
        <div className="replay-chapter-summary">
          <span className="replay-chapter-kicker">{preview ? "Preview" : `Chapter ${String((currentChapter?.index ?? 0) + 1).padStart(2, "0")}`}</span>
          <span className="replay-chapter-current">{preview ? selectedLabel : currentChapter?.label ?? "Route"}</span>
        </div>
        <button type="button" className="replay-chapter-button replay-chapter-browse" aria-label={expanded ? "Collapse chapter browser" : "Browse chapters and moments"} aria-expanded={expanded} aria-controls={browserId} onClick={() => onExpandedChange(!expanded)}>
          {expanded ? "Close" : "Browse"}{expanded ? <ChevronDown aria-hidden="true" /> : <ChevronUp aria-hidden="true" />}
        </button>
      </div>

      {!expanded ? <div className="replay-chapter-compact-lens">{lens}</div> : null}

      {expanded ? (
        <div ref={browserRef} className="replay-chapter-scroll" id={browserId} data-testid="replay-chapter-browser" role="region" aria-label="Chapter lens and moment finder" tabIndex={0}>
          <div className="replay-chapter-title-row">
            <div>
              <p className="replay-chapter-kicker">{selectedMoment ? "Moment finder" : `Chapter ${String((selectedChapter?.index ?? 0) + 1).padStart(2, "0")} / ${String(model.chapters.length).padStart(2, "0")}`}</p>
              <h2>{selectedLabel}</h2>
              <p className="replay-chapter-span">{distance(selectedSpan.startM)} to {distance(selectedSpan.endM)} km</p>
            </div>
            <button type="button" className="replay-chapter-button" aria-label={presentation === "relief" ? "Inspect elevation profile" : "Show elevation relief"} aria-pressed={presentation === "profile"} onClick={() => setPresentation(presentation === "relief" ? "profile" : "relief")}>
              {presentation === "relief" ? "Inspect" : "Relief"}
            </button>
          </div>

          {storyChapter?.story ? <div className="replay-chapter-story" data-testid="replay-chapter-story">
            <p>{storyChapter.story.summary}</p>
            <details key={storyChapter.id}>
              <summary>Places along this chapter</summary>
              <ul>
                {storyChapter.story.places.map(place => <li key={place.sourceUrl}>
                  <button type="button" disabled={disabled} aria-label={`Preview near ${place.name}`} onClick={event => {
                    event.currentTarget.closest("details")?.removeAttribute("open");
                    selectPreview({ type: "chapterSelected", chapter: storyChapter });
                    onEvent({ type: "previewMoved", progressM: place.atDistanceM, totalDistanceM: model.totalDistanceM });
                  }}><span>{place.name}</span><small>Near {distance(place.atDistanceM)} km</small></button>
                  <a href={place.sourceUrl} target="_blank" rel="noreferrer" aria-label={`Map source for ${place.name}`}>Map ↗</a>
                </li>)}
              </ul>
              <p className="replay-chapter-provenance">Nearby places matched to the recorded path. This does not imply a visit inside. Place data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>, ODbL.</p>
            </details>
          </div> : null}

          <div className="replay-chapter-context">
            <div><span>Whole route · {distance(model.totalDistanceM)} km</span><Profile model={model} span={wholeSpan} progressM={progressM} previewM={preview?.progressM} selectedSpan={selectedSpan} miniature testId="replay-context-profile" /></div>
            <button type="button" className="replay-chapter-button" aria-pressed={state.scope === "whole"} onClick={() => onEvent({ type: "scopeChanged", scope: state.scope === "lens" ? "whole" : "lens", totalDistanceM: model.totalDistanceM })}>
              {state.scope === "lens" ? "Zoom out" : "Focus lens"}
            </button>
          </div>

          {lens}
          <div className="replay-chapter-stat-row">
            <div className="replay-chapter-feature">{Math.round(featureM)} m <span>{featureLabel}</span></div>
            {selectedMoment ? <button type="button" className="replay-chapter-button replay-chapter-quiet" aria-expanded={whyOpen} aria-controls={explanationId} onClick={() => setWhyOpen(!whyOpen)}>Why this moment?</button> : <span className="replay-chapter-caption">Across {distance(selectedSpan.endM - selectedSpan.startM)} km</span>}
          </div>
          {selectedMoment && whyOpen ? <p className="replay-chapter-explanation" id={explanationId}>{selectedMoment.explanation}</p> : null}

          <div className="replay-chapter-list" role="group" aria-label="Preview a chapter">
            {model.chapters.map(chapter => (
              <button type="button" key={chapter.id} disabled={disabled} data-testid={`replay-${chapter.id}`} aria-label={`Preview chapter ${chapter.index + 1}, ${chapter.label}`} aria-pressed={!selectedMoment && chapter.id === selectedChapter?.id} onClick={() => selectPreview({ type: "chapterSelected", chapter })}>
                <span className="replay-chapter-bar"><span style={{ width: `${Math.max(0, Math.min(1, (progressM - chapter.startM) / Math.max(1, chapter.endM - chapter.startM))) * 100}%` }} /></span>
                <small>{String(chapter.index + 1).padStart(2, "0")} · {distance(chapter.startM)} km</small><strong>{chapter.label}</strong>
              </button>
            ))}
          </div>
          <p className="replay-chapter-moment-label">Moments across your route</p>
          <div className="replay-chapter-moments" role="group" aria-label="Preview a moment">
            {model.moments.map(moment => (
              <button type="button" key={moment.id} disabled={disabled} data-testid={`replay-moment-${moment.kind}`} aria-label={`Preview ${moment.label.toLowerCase()}`} aria-pressed={selectedMoment?.id === moment.id} onClick={() => selectPreview({ type: "momentSelected", moment })}>
                <span>{moment.label}</span><small>{Math.round(moment.valueM)} m{moment.kind === "descent" ? " fall" : " elevation"}</small>
              </button>
            ))}
          </div>
          {model.moments.length === 0 ? <p className="replay-chapter-explanation">No distinct elevation moments in the recorded samples.</p> : null}
          <p className="replay-chapter-provenance">{model.chapters.some(chapter => chapter.story) ? <>Map-based route story. Place data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>, ODbL. </> : "Chapters divide route distance. "}Moments and climb are derived from recorded elevation. Gaps remain visible.</p>
        </div>
      ) : null}

      {preview ? <div className="replay-chapter-preview" data-testid="replay-preview-position">
        <p><strong>Preview {distance(preview.progressM)} km</strong><span>Replay paused at {distance(progressM)} km</span></p>
        <div className="replay-chapter-preview-actions">
          <button type="button" className="replay-chapter-button" onClick={() => onEvent({ type: "replayReturned" })}>Back to replay</button>
          <button type="button" className="replay-chapter-button replay-chapter-primary" disabled={disabled} onClick={onPlayFromPreview}>Play from here <Play aria-hidden="true" /></button>
        </div>
      </div> : null}

      <div className="replay-chapter-transport">
        <button type="button" className="replay-chapter-play" aria-label={playing ? "Pause route" : "Play route"} disabled={disabled} onClick={onTogglePlayback}>{playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}</button>
        <div className="replay-chapter-progress"><strong data-testid="google-route-progress">{distance(progressM)} / {(model.totalDistanceM / 1_000).toFixed(1)} km</strong><small>{playing ? "Playing" : "Paused"}</small></div>
        <div className="replay-chapter-camera">{cameraControls}</div>
        <button type="button" className="replay-chapter-button replay-chapter-speed" aria-label={`Playback speed ${speed}x`} disabled={disabled} onClick={onCycleSpeed} title="Change playback speed"><Gauge aria-hidden="true" />{speed}x</button>
        <button type="button" className="replay-chapter-button replay-chapter-quiet" aria-expanded={detailsOpen} aria-controls={metricsId} onClick={() => setDetailsOpen(!detailsOpen)}>Data</button>
      </div>
      <div className="replay-chapter-route-progress" data-testid="replay-elevation-scrubber" data-distance-axis="route-metres">
        <Profile model={model} span={wholeSpan} progressM={progressM} previewM={preview?.progressM} miniature />
      <input style={profileRangeStyle(false, true)} type="range" aria-label="Route progress" aria-valuetext={`${distance(progressM)} of ${distance(model.totalDistanceM)} kilometers`} min={0} max={model.totalDistanceM} step="any" value={progressM} disabled={disabled} onChange={event => onSeek(Number(event.target.value))} />
      </div>
      {detailsOpen ? <div id={metricsId} className="replay-chapter-data">{metrics}</div> : null}
      <span className="sr-only" role="status" aria-live="polite">{preview ? `Preview selected. Replay paused at ${distance(progressM)} kilometers. Choose Play from here to move replay.` : "Following replay."}</span>
    </div>
  );
}

function distance(meters: number) {
  return (meters / 1_000).toFixed(2);
}

const PROFILE_WIDTH = 640;

function profileDomain(relief: boolean, miniature: boolean) {
  return { left: miniature ? 8 : 34, right: PROFILE_WIDTH - 12 - (relief ? 34 : 0) };
}

function profileRangeStyle(relief: boolean, miniature: boolean) {
  const { left, right } = profileDomain(relief, miniature);
  return { left: `${left / PROFILE_WIDTH * 100}%`, width: `${(right - left) / PROFILE_WIDTH * 100}%` };
}

function Profile({ model, span, progressM, previewM, selectedSpan, relief = false, miniature = false, testId }: {
  model: ReplayChapterModel;
  span: ReplaySpan;
  progressM: number;
  previewM?: number;
  selectedSpan?: ReplaySpan;
  relief?: boolean;
  miniature?: boolean;
  testId?: string;
}) {
  const segments = useMemo(() => replayProfileInSpan(model, span), [model, span.startM, span.endM]);
  const width = PROFILE_WIDTH;
  const height = miniature ? 44 : 146;
  const depth = relief ? 34 : 0;
  const rise = relief ? -18 : 0;
  const { left, right } = profileDomain(relief, miniature);
  const bottom = height - 8;
  const top = miniature ? 7 : 26;
  const x = (meters: number) => left + (right - left) * (meters - span.startM) / Math.max(1, span.endM - span.startM);
  const y = (elevationM: number) => bottom - (elevationM - model.minimumElevationM) / Math.max(1, model.maximumElevationM - model.minimumElevationM) * (bottom - top);
  const line = (points: Array<[number, number]>) => points.map(([px, py], index) => `${index === 0 ? "M" : "L"}${px.toFixed(2)} ${py.toFixed(2)}`).join(" ");
  const marker = (meters: number, isPreview: boolean) => {
    if (meters < span.startM || meters > span.endM) return null;
    const elevationM = replayElevationAt(model, meters);
    if (elevationM === undefined) return null;
    const px = x(meters);
    const py = y(elevationM);
    return isPreview ? <path className="replay-chapter-preview-pin" data-testid={miniature ? undefined : "replay-preview-playhead"} d={`M ${px} ${py - 6} l 6 6 -6 6 -6 -6 Z`} /> :
      <circle className="replay-chapter-pin" data-testid={miniature ? "replay-progress-playhead" : undefined} cx={px} cy={py} r={miniature ? 4 : 5} />;
  };
  return <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${miniature ? "Whole-route elevation context" : relief ? "Chapter elevation relief, vertically exaggerated" : "Chapter elevation profile in meters"}. A filled dot marks replay and a diamond marks preview. Recorded gaps are unconnected.`} data-testid={testId} preserveAspectRatio="none">
    {!miniature && !relief ? [model.minimumElevationM, model.maximumElevationM].map((value, index) => <line key={index} className="replay-chapter-grid" x1={left} x2={right} y1={y(value)} y2={y(value)} />) : null}
    {selectedSpan ? <rect className="replay-chapter-highlight" x={x(selectedSpan.startM)} y={1} width={Math.max(0, x(selectedSpan.endM) - x(selectedSpan.startM))} height={height - 2} rx={3} /> : null}
    {segments.map((segment, index) => {
      const points = [...segment];
      for (const distanceM of [progressM, previewM]) {
        if (distanceM === undefined || distanceM < segment[0].distanceM || distanceM > segment.at(-1)!.distanceM || points.some(point => point.distanceM === distanceM)) continue;
        const elevationM = replayElevationAt(model, distanceM);
        if (elevationM !== undefined) points.push({ distanceM, elevationM });
      }
      points.sort((a, b) => a.distanceM - b.distanceM);
      const front = points.map(point => [x(point.distanceM), y(point.elevationM)] as [number, number]);
      const back = front.map(([px, py]) => [px + depth, py + rise] as [number, number]);
      const first = front[0];
      const last = front.at(-1)!;
      return <g key={index} data-profile-segment="true">
        {!miniature ? <path className="replay-chapter-base" d={`${line(front)} L ${last[0]} ${bottom} L ${first[0]} ${bottom} Z`} /> : null}
        {relief ? <path className="replay-chapter-top" d={`${line(front)} ${line([...back].reverse()).replace(/^M/, "L")} Z`} /> : null}
        {relief ? front.filter((_, i) => i % Math.max(1, Math.ceil(front.length / 20)) === 0).map(([px, py], i) => <line key={i} className="replay-chapter-rib" x1={px} y1={py} x2={px + depth} y2={py + rise} />) : null}
        <path className="replay-chapter-edge" d={line(front)} />
        {segment.length === 1 ? <circle className="replay-chapter-sample" cx={first[0]} cy={first[1]} r={2} /> : null}
        {relief ? <path className="replay-chapter-edge" d={line(back)} /> : null}
      </g>;
    })}
    {marker(progressM, false)}{previewM === undefined ? null : marker(previewM, true)}
  </svg>;
}
