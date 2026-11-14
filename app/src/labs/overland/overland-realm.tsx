import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { QuestRoute, RouteAnnotation } from "@/domain/route";
import {
  initialOverlandMomentsState,
  momentTimeScale,
  reduceOverlandMoments,
  type OverlandMomentsEvent,
} from "@/labs/overland/overland-moments-state";
import { PhotoViewer, photoLabel } from "@/labs/overland/overland-photo";
import { context2d, makeCanvas } from "@/labs/overland/engine/canvas";
import { C } from "@/labs/overland/engine/palette";
import { wrapForBox } from "@/labs/overland/engine/screens";
import { runnerFrame } from "@/labs/overland/engine/runner";
import { sprites } from "@/labs/overland/engine/sprites";
import { realmSpriteScale } from "@/labs/overland/model/town-camera";
import { clipText, drawFrame, drawText } from "@/labs/overland/engine/text-draw";
import { measureText } from "@/labs/overland/engine/font";
import type { OverlandEntry } from "@/labs/overland/model/overland-entries";
import { realmLayout, sketchRealmLayout, type RealmViewport } from "@/labs/overland/model/realm-layout";
import { realmBoxContent } from "@/labs/overland/model/text-box";
import { walkFrame } from "@/labs/overland/model/walk-cycle";
import type { JumpPresentation, OverlandJumpState } from "@/labs/overland/overland-jump-state";
import { Key, SkinLabel } from "@/labs/overland/overland-ui";
import { bearingAt, markerRotation, markerSize, positionMarkerImage, progressReadout, scrubKeyTarget } from "@/labs/sketch/sketch-replay-controls";
import { useGoogleReplayDriver } from "@/surfaces/replay/playback/use-google-replay-driver";
import type { GoogleRendererUnavailableReason, GoogleRouteNavigatorStatus } from "@/surfaces/replay/renderers/google-renderer-state";

const SPRITE_SCALE = 3;
const LINE = 11;

/**
 * The runner or rider from behind, as the chase camera sees them, scaled
 * whole-pixel for the marker. The runner is the town's runner, so she is
 * the same sprite on both sides of the jump.
 */
function spriteFrames(kind: OverlandEntry["kind"], viewportHeight: number) {
  if (kind === "run") {
    const scale = realmSpriteScale(viewportHeight);
    return { width: 16 * scale, height: 24 * scale, urls: [0, 1, 2, 3].map((index) => runnerFrame("up", index, scale).toDataURL()) };
  }
  const urls = sprites().ride.up.map((frame) => {
    const canvas = makeCanvas(frame.width * SPRITE_SCALE, frame.height * SPRITE_SCALE);
    const context = context2d(canvas);
    context.drawImage(frame, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL();
  });
  return { width: 16 * SPRITE_SCALE, height: 16 * SPRITE_SCALE, urls };
}

function isControl(target: EventTarget | null) {
  return target instanceof HTMLElement && target.closest("button, input, select, textarea, a") !== null;
}

interface TextBoxLines {
  heading: string;
  progress: string;
  title: string[];
  body: string[];
}

function textBoxLines(entry: OverlandEntry, progressKm: number, width: number): TextBoxLines {
  const content = realmBoxContent(entry, progressKm);
  const inner = width - 16;
  const title = wrapForBox(content.title, inner, true);
  const body = wrapForBox(content.body, inner);
  return {
    heading: content.heading,
    progress: content.progress,
    title: title.length > 2 ? [title[0], clipText(title.slice(1).join(" "), inner, true)] : title,
    body: body.length > 3 ? [...body.slice(0, 2), clipText(body.slice(2).join(" "), inner)] : body,
  };
}

function textBoxHeight(lines: Pick<TextBoxLines, "title" | "body">) {
  return 6 + LINE + 3 + lines.title.length * LINE + (lines.body.length ? 4 + lines.body.length * LINE : 0) + 4;
}

function drawTextBox(canvas: HTMLCanvasElement, lines: TextBoxLines) {
  const context = context2d(canvas);
  const { width, height } = canvas;
  context.clearRect(0, 0, width, height);
  drawFrame(context, 0, 0, width, height);
  drawText(context, lines.heading, 8, 6, C.acc2, true);
  drawText(context, lines.progress, width - 8 - measureText(lines.progress), 6, C.ink2);
  let y = 6 + LINE + 3;
  for (const line of lines.title) {
    drawText(context, line, 8, y, C.ink, true);
    y += LINE;
  }
  if (lines.body.length) {
    y += 1;
    context.fillStyle = C.paper3;
    context.fillRect(8, y, width - 16, 1);
    y += 3;
  }
  for (const line of lines.body) {
    drawText(context, line, 8, y, C.ink2);
    y += LINE;
  }
}

const KIND_LABEL: Record<RouteAnnotation["kind"], string> = { note: "Note", landmark: "Landmark", warning: "Take care", image: "Photo" };

function distanceLabel(metres: number) {
  return metres < 1000 ? `${Math.round(metres)} m` : `${(metres / 1000).toFixed(1)} km`;
}

/**
 * One of her moments, met on the route: her title and words in the game's
 * text box, marked Editorial when it is interpretation, with its photo
 * beside it. Nothing here is written by us but the kind and the distance.
 */
function MomentBox({
  annotation,
  width,
  top,
  left,
  onOpenPhoto,
  onClose,
  skin,
}: {
  annotation: RouteAnnotation;
  width: number;
  top: number;
  left: number;
  onOpenPhoto: () => void;
  onClose: () => void;
  skin: "pixel" | "sketch";
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const scale = width < 420 ? 2 : 3;
  const photoWidth = annotation.media ? 76 : 0;
  const inner = Math.floor(Math.min(width - photoWidth - 8, 420) / scale);
  const heading = `${KIND_LABEL[annotation.kind]} · ${distanceLabel(annotation.atDistanceM)}`;
  const editorial = annotation.evidence === "hypothesis";
  const title = annotation.title ? wrapForBox(annotation.title, inner - 16, true) : [];
  const body = wrapForBox(annotation.body, inner - 16);
  const height = 6 + LINE + 3 + title.length * LINE + body.length * LINE + 6;
  useLayoutEffect(() => {
    const canvas = ref.current;
    if (!canvas || skin === "sketch") return;
    const context = context2d(canvas);
    context.clearRect(0, 0, inner, height);
    drawFrame(context, 0, 0, inner, height);
    drawText(context, heading, 8, 6, C.acc2, true);
    if (editorial) {
      const tag = "Editorial";
      const tw = measureText(tag) + 6;
      context.fillStyle = C.ink2;
      context.fillRect(inner - 8 - tw, 4, tw, 11);
      drawText(context, tag, inner - 5 - tw, 6, C.paper);
    }
    let y = 6 + LINE + 3;
    for (const line of title) {
      drawText(context, line, 8, y, C.ink, true);
      y += LINE;
    }
    for (const line of body) {
      drawText(context, line, 8, y, C.ink2);
      y += LINE;
    }
  }, [body, editorial, heading, height, inner, skin, title]);
  return (
    <div className="overland-moment" data-moment-id={annotation.id} data-skin={skin} data-testid="overland-moment" style={{ top, left }}>
      {skin === "sketch" ? (
        <div aria-hidden="true" className="sketch-moment-card" style={{ maxWidth: Math.min(width - photoWidth - 8, 420) }}>
          <p className="sketch-box-heading">
            <span>{heading}</span>
            {editorial ? <span className="sketch-box-tag">Editorial</span> : null}
          </p>
          {annotation.title ? <p className="sketch-box-title">{annotation.title}</p> : null}
          <p className="sketch-box-body">{annotation.body}</p>
        </div>
      ) : (
        <canvas aria-hidden="true" className="overland-pixels" height={height} ref={ref} style={{ width: inner * scale, height: height * scale }} width={inner} />
      )}
      <div className="overland-moment-side">
        {annotation.media ? (
          <button aria-label={`Open photo: ${photoLabel(annotation)}`} className="overland-moment-photo" onClick={onOpenPhoto} type="button">
            <img alt="" height={annotation.media.height} src={annotation.media.thumbUrl} width={annotation.media.width} />
          </button>
        ) : null}
        <Key className="overland-moment-close" label="Put this moment away" onClick={onClose}>
          <SkinLabel skin={skin} text="OK" />
        </Key>
      </div>
    </div>
  );
}

export interface OverlandRealmProps {
  route: QuestRoute;
  entry: OverlandEntry;
  jumpId: number;
  phase: OverlandJumpState["phase"];
  presentation: JumpPresentation;
  reducedMotion: boolean;
  viewport: RealmViewport;
  onStatus: (jumpId: number, status: GoogleRouteNavigatorStatus, reason?: GoogleRendererUnavailableReason) => void;
  onLeave: () => void;
  /** Overland's pixels, or the sketch's ink and paper. */
  skin?: "pixel" | "sketch";
}

/**
 * The route's photorealistic world: Google's 3D map at full resolution,
 * the runner as the engine's in-scene marker, a pixel text box at the top
 * and the handheld's controls above the attribution band.
 */
export default function OverlandRealm({ route, entry, jumpId, phase, presentation, reducedMotion, viewport, onStatus, onLeave, skin = "pixel" }: OverlandRealmProps) {
  const sketch = skin === "sketch";
  // The pixel skin's runner sprite; the sketch skin draws a position marker instead.
  const sprite = useMemo(() => (sketch ? { width: 24, height: 24, urls: [positionMarkerImage(24, 0).url] } : spriteFrames(entry.kind, viewport.height)), [entry.kind, sketch, viewport.height]);
  const frames = sprite.urls;
  const spriteRef = useRef<HTMLImageElement | null>(null);
  const positionMarker = useCallback(
    (marker: HTMLElement) => {
      const image = document.createElement("img");
      image.alt = "";
      image.src = frames[0];
      image.dataset.frame = "0";
      image.width = sprite.width;
      image.height = sprite.height;
      image.style.cssText = `display:block;width:${sprite.width}px;height:${sprite.height}px;${sketch ? "" : "image-rendering:pixelated;"}pointer-events:none`;
      if (sketch) image.dataset.markerHeading = "0";
      marker.append(image);
      marker.dataset.markerKind = sketch ? "sketch-position" : "overland-sprite";
      spriteRef.current = image;
      return () => {
        image.remove();
        if (spriteRef.current === image) spriteRef.current = null;
      };
    },
    [frames, sketch, sprite.height, sprite.width],
  );
  // Her moments along the route. The ref mirrors the reducer; sendMoment is its one writer.
  const anchors = useMemo(() => route.annotations.map((annotation) => ({ id: annotation.id, atDistanceM: annotation.atDistanceM, hasMedia: Boolean(annotation.media) })), [route.annotations]);
  const momentsRef = useRef(initialOverlandMomentsState(anchors));
  const [moments, setMoments] = useState(momentsRef.current);
  const sendMoment = useCallback((event: OverlandMomentsEvent) => {
    const next = reduceOverlandMoments(momentsRef.current, event);
    if (next === momentsRef.current) return;
    momentsRef.current = next;
    setMoments(next);
  }, []);
  const realmRef = useRef(phase === "realm");
  realmRef.current = phase === "realm";
  const timeScale = useCallback(() => (realmRef.current ? momentTimeScale(momentsRef.current) : 1), []);
  const driver = useGoogleReplayDriver({ route, camera: "sustained", palette: "immersive", positionMarker, timeScale });
  const { session, sessionRef, commitControl, totalDistanceM } = driver;
  const { status, statusReason } = session;
  const realm = phase === "realm";

  useEffect(() => {
    onStatus(jumpId, status, statusReason);
  }, [jumpId, onStatus, status, statusReason]);

  // Stepping in starts the replay, unless motion is reduced.
  const started = useRef(false);
  useEffect(() => {
    if (!realm || started.current) return;
    started.current = true;
    if (!reducedMotion && !sessionRef.current.control.playing) commitControl({ type: "playbackToggled" });
  }, [commitControl, realm, reducedMotion, sessionRef]);

  // The walk cycle follows playback: the frame is read from progress.
  useEffect(() => {
    if (status.state !== "ready") return;
    let animationFrame = 0;
    const tick = () => {
      const image = spriteRef.current;
      if (image && sketch) {
        // Sized for the camera's distance, pointing along the route as seen on screen.
        const map = image.closest("gmp-map-3d") as (HTMLElement & { heading?: number; range?: number }) | null;
        const size = markerSize(map?.range);
        const { url, turn } = positionMarkerImage(size, markerRotation(bearingAt(route.route, sessionRef.current.control.progressM), map?.heading ?? 0));
        if (image.dataset.markerHeading !== String(turn) || image.width !== size) {
          image.src = url;
          image.width = size;
          image.height = size;
          image.style.width = image.style.height = `${size}px`;
          image.dataset.markerHeading = String(turn);
        }
      } else if (image) {
        const frame = walkFrame({ progressM: sessionRef.current.control.progressM, totalDistanceM, frames: frames.length, reducedMotion });
        if (image.dataset.frame !== String(frame)) {
          image.src = frames[frame];
          image.dataset.frame = String(frame);
        }
      }
      animationFrame = requestAnimationFrame(tick);
    };
    animationFrame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationFrame);
  }, [frames, reducedMotion, route.route, sessionRef, sketch, status.state, totalDistanceM]);

  const seek = useCallback(
    (progressM: number) => {
      const to = Math.min(totalDistanceM, Math.max(0, progressM));
      sendMoment({ type: "seeked", progressM: to });
      commitControl({ type: "progressSelected", progressM: to, totalDistanceM });
    },
    [commitControl, sendMoment, totalDistanceM],
  );

  // Progress from the replay's throttled snapshots meets the moments.
  useEffect(() => {
    if (!realm) return;
    sendMoment({ type: "progressed", progressM: session.control.progressM, playing: session.control.playing, nowMs: performance.now() });
  }, [realm, sendMoment, session.control.playing, session.control.progressM]);
  const momentId = moments.phase === "showing" || moments.phase === "mediaOpen" ? moments.id : null;
  const moment = momentId ? route.annotations.find((annotation) => annotation.id === momentId) : undefined;
  const toggle = useCallback(() => commitControl({ type: "playbackToggled" }), [commitControl]);

  useEffect(() => {
    if (!realm) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === " " && !isControl(event.target)) toggle();
      else if ((event.key === "ArrowRight" || event.key === "ArrowLeft") && !(event.target instanceof HTMLInputElement)) {
        const step = (event.shiftKey ? 0.05 : 0.01) * totalDistanceM * (event.key === "ArrowRight" ? 1 : -1);
        seek(sessionRef.current.control.progressM + step);
      } else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [realm, seek, sessionRef, toggle, totalDistanceM]);

  // ---------------------------------------------------------------- text box

  const textScale = viewport.width < 560 ? 2 : 3;
  const boxWidth = Math.floor(realmLayout(viewport, 0).textBox.width / textScale);
  const progressKm = Math.round(session.control.progressM / 100) / 10;
  const lines = useMemo(() => textBoxLines(entry, progressKm, boxWidth), [boxWidth, entry, progressKm]);
  // The sketch's box is ordinary text: its height is measured, not counted in pixel lines.
  const [sketchBoxHeight, setSketchBoxHeight] = useState(96);
  const sketchBoxRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = sketchBoxRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setSketchBoxHeight(element.getBoundingClientRect().height));
    observer.observe(element);
    return () => observer.disconnect();
  });
  const boxHeight = sketch ? sketchBoxHeight / textScale : textBoxHeight(lines);
  const layout = realmLayout(viewport, boxHeight * textScale);
  const boxRef = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    if (boxRef.current && !sketch) drawTextBox(boxRef.current, lines);
  }, [lines, boxWidth, boxHeight, sketch]);

  const sketchLayout = sketch ? sketchRealmLayout(viewport) : null;
  const readout = progressReadout(session.control.progressM, totalDistanceM);
  const playRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (realm) playRef.current?.focus({ preventScroll: true });
  }, [realm]);

  const { pixelLevel } = presentation;
  const pixelated = pixelLevel > 1;
  const percent = totalDistanceM > 0 ? (session.control.progressM / totalDistanceM) * 100 : 0;
  const playing = session.control.playing;
  const content = realmBoxContent(entry, progressKm);

  return (
    <>
      <section
        aria-label={`3D replay of ${entry.title}`}
        className="overland-realm-map"
        ref={driver.stageRef}
        style={{ opacity: presentation.liveMap ? 1 : 0, pointerEvents: realm ? "auto" : "none" }}
      >
        <div
          className="overland-realm-host"
          ref={driver.containerRef}
          style={
            pixelated
              ? {
                  width: Math.ceil(viewport.width / pixelLevel),
                  height: Math.ceil(viewport.height / pixelLevel),
                  transform: `scale(${pixelLevel})`,
                  transformOrigin: "0 0",
                  imageRendering: "pixelated",
                }
              : undefined
          }
        />
      </section>
      {realm ? (
        <>
          <div
            className="overland-realm-text-box"
            data-skin={skin}
            data-testid="overland-realm-text-box"
            ref={sketch ? sketchBoxRef : undefined}
            style={
              sketchLayout
                ? { left: sketchLayout.card.left, top: sketchLayout.card.top, width: sketchLayout.card.width }
                : { left: layout.textBox.left, top: layout.textBox.top, width: boxWidth * textScale, height: boxHeight * textScale }
            }
          >
            {sketch ? (
              <div aria-hidden="true" className="sketch-story-card">
                {/* Distance lives at the bar now; the card names the route. */}
                <p className="sketch-box-heading">
                  <span>{content.heading}</span>
                </p>
                <p className="sketch-box-title">{content.title}</p>
                {content.body ? <p className="sketch-box-body">{content.body}</p> : null}
              </div>
            ) : (
              <canvas aria-hidden="true" className="overland-pixels" height={boxHeight} ref={boxRef} style={{ width: "100%", height: "100%" }} width={boxWidth} />
            )}
            <div className="sr-only" data-testid="overland-realm-text">
              <p>{content.heading}</p>
              <p>{content.title}</p>
              <p>{content.progress}</p>
              <p>{content.body}</p>
            </div>
          </div>
          {sketchLayout ? (
            <>
              <button aria-label="Back" className="sketch-replay-leave" onClick={onLeave} style={{ left: sketchLayout.leave.left, top: sketchLayout.leave.top }} type="button">
                <svg aria-hidden="true" height="20" viewBox="0 0 20 20" width="20">
                  <path d="M12.5 4 6.5 10l6 6" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.4" />
                </svg>
              </button>
              <div
                aria-label="Replay"
                className="sketch-replay-bar"
                data-skin={skin}
                data-testid="overland-realm-controls"
                role="group"
                style={{ left: sketchLayout.transport.left, top: sketchLayout.transport.top, width: sketchLayout.transport.width, height: sketchLayout.transport.height }}
              >
                <button aria-label={playing ? "Pause" : "Play"} className="sketch-replay-play" onClick={toggle} ref={playRef} type="button">
                  <svg aria-hidden="true" height="22" viewBox="0 0 22 22" width="22">
                    {playing ? <path d="M6 4h3.5v14H6zM12.5 4H16v14h-3.5z" fill="currentColor" /> : <path d="M7 3.8v14.4a.8.8 0 0 0 1.2.7l11.3-7.2a.8.8 0 0 0 0-1.4L8.2 3.1A.8.8 0 0 0 7 3.8Z" fill="currentColor" />}
                  </svg>
                </button>
                <div className="sketch-replay-track">
                  <input
                    aria-label="Route progress"
                    aria-valuetext={readout.valueText}
                    className="sketch-replay-scrub"
                    data-moment-phase={moments.phase}
                    max={100}
                    min={0}
                    onChange={(event) => seek((Number(event.currentTarget.value) / 100) * totalDistanceM)}
                    onKeyDown={(event) => {
                      const to = scrubKeyTarget(event, sessionRef.current.control.progressM, totalDistanceM);
                      if (to === null) return;
                      event.preventDefault();
                      seek(to);
                    }}
                    step={0.1}
                    style={{ "--ov-progress": `${percent}%` } as React.CSSProperties}
                    type="range"
                    value={Math.round(percent * 10) / 10}
                  />
                  <p aria-hidden="true" className="sketch-replay-times">
                    <span>{readout.elapsed}</span>
                    <span>{readout.total}</span>
                  </p>
                </div>
              </div>
            </>
          ) : (
            <div
              className="overland-realm-controls"
              data-skin={skin}
              data-testid="overland-realm-controls"
              role="group"
              aria-label="Replay"
              style={{ left: layout.controls.left, top: layout.controls.top, width: layout.controls.width, height: layout.controls.height }}
            >
              <Key label="Back" onClick={onLeave}>
                <SkinLabel skin={skin} text="Back" />
              </Key>
              <Key className="overland-key-play" label={playing ? "Pause" : "Play"} onClick={toggle} ref={playRef}>
                <SkinLabel bold colour="#ffffff" skin={skin} text={playing ? "Pause" : "Play"} />
              </Key>
              <input
                aria-label="Route progress"
                data-moment-phase={moments.phase}
                aria-valuetext={content.progress}
                className="overland-scrub"
                max={100}
                min={0}
                onChange={(event) => seek((Number(event.currentTarget.value) / 100) * totalDistanceM)}
                step={0.1}
                style={{ "--ov-progress": `${percent}%` } as React.CSSProperties}
                type="range"
                value={Math.round(percent * 10) / 10}
              />
            </div>
          )}
          {moment ? (
            <MomentBox
              annotation={moment}
              key={moment.id}
              left={sketchLayout ? sketchLayout.card.left : layout.textBox.left}
              onClose={() => sendMoment({ type: "dismissRequested", id: moment.id, nowMs: performance.now() })}
              onOpenPhoto={() => sendMoment({ type: "mediaOpened", id: moment.id })}
              skin={skin}
              top={(sketchLayout ? sketchLayout.card.top : layout.textBox.top) + boxHeight * textScale + 10}
              width={sketchLayout ? sketchLayout.card.width : layout.textBox.width}
            />
          ) : null}
          <p aria-live="polite" className="sr-only" data-testid="overland-moment-text">
            {moment ? `${KIND_LABEL[moment.kind]} at ${distanceLabel(moment.atDistanceM)}${moment.evidence === "hypothesis" ? ", editorial" : ""}. ${moment.title ? `${moment.title}. ` : ""}${moment.body}` : ""}
          </p>
          {moment && moments.phase === "mediaOpen" && moment.media ? (
            <PhotoViewer annotation={moment} onClose={() => sendMoment({ type: "mediaClosed", id: moment.id, nowMs: performance.now() })} />
          ) : null}
        </>
      ) : null}
    </>
  );
}
