import * as Dialog from "@radix-ui/react-dialog";
import { ArrowLeft, ArrowRight, ExternalLink, Hand, Pause, Play, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  clampTourTime,
  formatClock,
  shotAt,
  tourDuration,
  type PlacedChapter,
  type PlacedScene,
} from "@/domain/adventure";
import { kilometres } from "@/surfaces/replay/adventure/adventure-format";
import { SketchfabFrame, type SceneFrameState } from "@/surfaces/replay/adventure/sketchfab-frame";

type Mode = "paused" | "playing" | "exploring" | "finished";

/**
 * Another author's captured scene near a chapter. It is presented as a
 * capture, never as the recorded route or its terrain, with its credit
 * visible throughout.
 */
export function AdventureSceneDialog({
  scene,
  chapterWithFootage,
  container,
  returnM,
  reducedMotion,
  onWatch,
  onClose,
}: {
  scene: PlacedScene;
  chapterWithFootage?: PlacedChapter;
  container: HTMLElement | null;
  returnM: number;
  reducedMotion: boolean;
  onWatch: (chapter: PlacedChapter) => void;
  onClose: () => void;
}) {
  const shots = scene.tour.shots;
  const duration = tourDuration(shots);
  const [frame, setFrame] = useState<SceneFrameState>({ state: "loading", progress: 0 });
  const [mode, setMode] = useState<Mode>("paused");
  const [seconds, setSeconds] = useState(0);
  const clock = useRef(0);
  const ready = frame.state === "ready";
  const shot = shotAt(shots, seconds);

  const moveTo = useCallback((time: number) => {
    const next = clampTourTime(time, shots);
    clock.current = next;
    setSeconds(next);
  }, [shots]);

  useEffect(() => {
    if (ready && !reducedMotion) setMode((current) => (current === "paused" && clock.current === 0 ? "playing" : current));
  }, [ready, reducedMotion]);

  useEffect(() => {
    if (mode !== "playing" || !ready || reducedMotion) return;
    let raf = 0;
    let last = performance.now();
    let painted = last;
    const tick = (now: number) => {
      clock.current = Math.min(duration, clock.current + Math.min(0.1, (now - last) / 1_000));
      last = now;
      if (now - painted >= 32 || clock.current >= duration) {
        painted = now;
        setSeconds(clock.current);
      }
      if (clock.current >= duration) {
        setMode("finished");
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [mode, ready, reducedMotion, duration]);

  const jump = (at: number) => {
    setMode(at >= duration ? "finished" : "paused");
    moveTo(at);
  };
  const play = () => {
    if (mode === "playing") return setMode("paused");
    if (mode === "finished" || mode === "exploring") moveTo(0);
    setMode("playing");
  };

  const caption =
    mode === "exploring"
      ? "Drag to look around. Scroll or pinch to move closer."
      : mode === "finished"
        ? "Take another pass, or look around on your own."
        : shots[shot].title;

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal container={container}>
        <Dialog.Overlay className="adv-scrim" />
        <Dialog.Content
          data-testid="adventure-scene"
          data-scene-state={frame.state}
          data-tour-mode={mode}
          className="adv-stage adv-scene"
          // Escape closes this overlay and stops there: a Replay stage that leaves on
          // Escape (Google 3D) must not also receive it.
          onEscapeKeyDown={(event) => event.stopPropagation()}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            (event.currentTarget as HTMLElement).querySelector<HTMLElement>("[data-autofocus]")?.focus();
          }}
        >
          <div className="adv-scene-view">
            {frame.state !== "failed" ? (
              <SketchfabFrame
                scene={scene}
                seconds={seconds}
                interactive={mode === "exploring"}
                onState={setFrame}
                className="adv-scene-frame"
              />
            ) : null}
            {frame.state !== "ready" ? (
              <div className="adv-scene-wait" role={frame.state === "failed" ? "alert" : "status"}>
                {scene.poster ? <img src={scene.poster} alt={scene.posterAlt} /> : null}
                <p>
                  {frame.state === "failed"
                    ? "The captured scene could not load from Sketchfab. Nothing on the route has changed."
                    : `Opening the captured scene${frame.progress > 0 ? ` · ${Math.round(frame.progress * 100)}%` : ""}`}
                </p>
              </div>
            ) : null}
            {ready ? <p className="adv-scene-caption" aria-live="polite">{caption}</p> : null}
          </div>

          <div className="adv-scene-text">
            <Dialog.Title className="adv-stage-title">{scene.title}</Dialog.Title>
            <p className="adv-stage-kind">
              Captured scene by{" "}
              <a href={scene.attribution.url} target="_blank" rel="noreferrer">
                {scene.attribution.author} on Sketchfab
                <ExternalLink aria-hidden="true" />
              </a>
            </p>
            {scene.description ? <Dialog.Description className="adv-stage-note">{scene.description}</Dialog.Description> : (
              <Dialog.Description className="sr-only">A captured 3D scene near the route.</Dialog.Description>
            )}
            <p className="adv-provenance adv-provenance-dark">
              Another author's 3D capture, placed near {kilometres(scene.atDistanceM)}. It is not the recorded route or
              its terrain.
            </p>

            {frame.state === "failed" ? (
              chapterWithFootage ? (
                <button type="button" className="adv-button adv-button-light" data-autofocus onClick={() => onWatch(chapterWithFootage)}>
                  <Play aria-hidden="true" />
                  Watch this chapter's footage instead
                </button>
              ) : null
            ) : (
              <>
                <div className="adv-transport">
                  {reducedMotion ? (
                    <button
                      type="button"
                      className="adv-button adv-button-light"
                      data-autofocus
                      disabled={!ready}
                      onClick={() => jump(shots[(shot + 1) % shots.length].atS)}
                    >
                      <ArrowRight aria-hidden="true" />
                      Next viewpoint
                    </button>
                  ) : (
                    <button type="button" className="adv-button adv-button-light" data-autofocus disabled={!ready} onClick={play}>
                      {mode === "playing" ? <Pause aria-hidden="true" /> : mode === "finished" ? <RotateCcw aria-hidden="true" /> : <Play aria-hidden="true" />}
                      {mode === "playing" ? "Pause tour" : mode === "finished" ? "Tour again" : seconds > 0 && mode !== "exploring" ? "Continue tour" : "Start the tour"}
                    </button>
                  )}
                  <button
                    type="button"
                    className="adv-button adv-button-quiet"
                    disabled={!ready}
                    aria-pressed={mode === "exploring"}
                    onClick={() => (mode === "exploring" ? jump(seconds) : setMode("exploring"))}
                  >
                    <Hand aria-hidden="true" />
                    {mode === "exploring" ? "Back to the tour" : "Look around"}
                  </button>
                  <span className="adv-clock" aria-hidden="true">
                    {formatClock(seconds)} / {formatClock(duration)}
                  </span>
                </div>
                <div className="adv-viewpoints" role="group" aria-label={`Viewpoints: ${scene.tour.title}`}>
                  {shots.map((item, index) => (
                    <button
                      key={item.atS}
                      type="button"
                      disabled={!ready}
                      aria-pressed={shot === index && mode !== "exploring"}
                      aria-label={`Viewpoint ${index + 1}: ${item.title}`}
                      onClick={() => jump(item.atS)}
                    >
                      {index + 1}
                    </button>
                  ))}
                </div>
              </>
            )}

            <Dialog.Close asChild>
              <button type="button" className="adv-button adv-button-return">
                <ArrowLeft aria-hidden="true" />
                Back to the route at {kilometres(returnM)}
              </button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
