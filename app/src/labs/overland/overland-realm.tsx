import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";

import type { QuestRoute } from "@/domain/route";
import { context2d, makeCanvas } from "@/labs/overland/engine/canvas";
import { C } from "@/labs/overland/engine/palette";
import { wrapForBox } from "@/labs/overland/engine/screens";
import { runnerFrame } from "@/labs/overland/engine/runner";
import { sprites } from "@/labs/overland/engine/sprites";
import { realmSpriteScale } from "@/labs/overland/model/town-camera";
import { clipText, drawFrame, drawText } from "@/labs/overland/engine/text-draw";
import { measureText } from "@/labs/overland/engine/font";
import type { OverlandEntry } from "@/labs/overland/model/overland-entries";
import { realmLayout, type RealmViewport } from "@/labs/overland/model/realm-layout";
import { realmBoxContent } from "@/labs/overland/model/text-box";
import { walkFrame } from "@/labs/overland/model/walk-cycle";
import type { JumpPresentation, OverlandJumpState } from "@/labs/overland/overland-jump-state";
import { Key, PixelLabel } from "@/labs/overland/overland-ui";
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
}

/**
 * The route's photorealistic world: Google's 3D map at full resolution,
 * the runner as the engine's in-scene marker, a pixel text box at the top
 * and the handheld's controls above the attribution band.
 */
export default function OverlandRealm({ route, entry, jumpId, phase, presentation, reducedMotion, viewport, onStatus, onLeave }: OverlandRealmProps) {
  const sprite = useMemo(() => spriteFrames(entry.kind, viewport.height), [entry.kind, viewport.height]);
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
      image.style.cssText = `display:block;width:${sprite.width}px;height:${sprite.height}px;image-rendering:pixelated;pointer-events:none`;
      marker.append(image);
      marker.dataset.markerKind = "overland-sprite";
      spriteRef.current = image;
      return () => {
        image.remove();
        if (spriteRef.current === image) spriteRef.current = null;
      };
    },
    [frames, sprite.height, sprite.width],
  );
  const driver = useGoogleReplayDriver({ route, camera: "sustained", palette: "immersive", positionMarker });
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
      if (image) {
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
  }, [frames, reducedMotion, sessionRef, status.state, totalDistanceM]);

  const seek = useCallback(
    (progressM: number) => commitControl({ type: "progressSelected", progressM: Math.min(totalDistanceM, Math.max(0, progressM)), totalDistanceM }),
    [commitControl, totalDistanceM],
  );
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
  const boxHeight = textBoxHeight(lines);
  const layout = realmLayout(viewport, boxHeight * textScale);
  const boxRef = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    if (boxRef.current) drawTextBox(boxRef.current, lines);
  }, [lines, boxWidth, boxHeight]);

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
            data-testid="overland-realm-text-box"
            style={{ left: layout.textBox.left, top: layout.textBox.top, width: boxWidth * textScale, height: boxHeight * textScale }}
          >
            <canvas aria-hidden="true" className="overland-pixels" height={boxHeight} ref={boxRef} style={{ width: "100%", height: "100%" }} width={boxWidth} />
            <div className="sr-only" data-testid="overland-realm-text">
              <p>{content.heading}</p>
              <p>{content.title}</p>
              <p>{content.progress}</p>
              <p>{content.body}</p>
            </div>
          </div>
          <div
            className="overland-realm-controls"
            data-testid="overland-realm-controls"
            role="group"
            aria-label="Replay"
            style={{ left: layout.controls.left, top: layout.controls.top, width: layout.controls.width, height: layout.controls.height }}
          >
            <Key label="Back" onClick={onLeave}>
              <PixelLabel scale={2} text="Back" />
            </Key>
            <Key className="overland-key-play" label={playing ? "Pause" : "Play"} onClick={toggle} ref={playRef}>
              <PixelLabel bold colour="#ffffff" scale={2} text={playing ? "Pause" : "Play"} />
            </Key>
            <input
              aria-label="Route progress"
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
        </>
      ) : null}
    </>
  );
}
