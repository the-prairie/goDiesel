import * as Dialog from "@radix-ui/react-dialog";
import { ArrowLeft, Box, Pause, Play, RotateCcw, Volume2, VolumeX } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";

import {
  beatDuration,
  filmDuration,
  filmPosition,
  formatClock,
  type AdventureClip,
  type PlacedScene,
  type RouteAdventure,
} from "@/domain/adventure";
import { adventureMediaUrl } from "@/data/adventure-repository";
import { footageKind, kilometres } from "@/surfaces/replay/adventure/adventure-format";
import { SketchfabFrame, type SceneFrameState } from "@/surfaces/replay/adventure/sketchfab-frame";
import { cn } from "@/ui/utils";

/** Captions settle for this long at the start of each beat, then recede. */
const CAPTION_S = 2.5;

/**
 * The authored short film. Footage, the recorded route and a captured scene
 * are three different things and each beat says which one is on screen.
 * The route pass moves the real Replay camera; closing returns it exactly.
 */
export function AdventureFilm({
  adventure,
  container,
  returnM,
  reducedMotion,
  sound,
  onSound,
  onRoutePass,
  onScene,
  onClose,
}: {
  adventure: RouteAdventure;
  container: HTMLElement | null;
  returnM: number;
  reducedMotion: boolean;
  sound: boolean;
  onSound: (enabled: boolean) => void;
  /** Called with 0..1 along this recording while the route beat plays. */
  onRoutePass: (fraction: number) => void;
  onScene: (scene: PlacedScene) => void;
  onClose: () => void;
}) {
  const film = adventure.film!;
  const duration = filmDuration(film);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(!reducedMotion);
  const [seekVersion, setSeekVersion] = useState(0);
  const [mediaError, setMediaError] = useState(false);
  const [sceneFrame, setSceneFrame] = useState<SceneFrameState>({ state: "loading", progress: 0 });
  const [sceneChoices, setSceneChoices] = useState<Record<number, boolean>>({});
  const video = useRef<HTMLVideoElement>(null);
  const clock = useRef(0);
  const finished = time >= duration;
  const position = filmPosition(film, time);
  const { beat, index, start, elapsed } = position;

  const sceneBeat = film.beats.find((item) => item.kind === "scene");
  const scene = sceneBeat?.kind === "scene" ? adventure.scenes.find((item) => item.id === sceneBeat.sceneId) : undefined;
  const sceneFailed = sceneFrame.state === "failed";
  // A scene that becomes ready late never interrupts a fallback already playing.
  const showScene = beat.kind === "scene" && !!scene && (sceneChoices[index] ?? sceneFrame.state === "ready") && !sceneFailed;
  const clip: AdventureClip | undefined =
    beat.kind === "footage" ? beat : beat.kind === "scene" && !showScene ? beat.fallback : undefined;
  const media = clip ? adventure.footage.get(clip.footageId) : undefined;

  const live = useRef({ playing, position, clip, finished, onRoutePass });
  live.current = { playing, position, clip, finished, onRoutePass };

  useEffect(() => {
    if (beat.kind === "scene" && sceneChoices[index] === undefined) {
      setSceneChoices((choices) => ({ ...choices, [index]: sceneFrame.state === "ready" }));
    }
  }, [beat.kind, index, sceneFrame.state, sceneChoices]);

  useEffect(() => {
    if (reducedMotion) setPlaying(false);
  }, [reducedMotion]);

  useEffect(() => {
    const pause = () => { if (document.hidden) setPlaying(false); };
    document.addEventListener("visibilitychange", pause);
    return () => document.removeEventListener("visibilitychange", pause);
  }, []);

  // Cue the clip for this beat at the film clock's offset into it.
  useEffect(() => {
    const element = video.current;
    if (!element || !media || !clip) return;
    let disposed = false;
    setMediaError(false);
    const cue = () => {
      if (disposed || !Number.isFinite(element.duration)) return;
      element.currentTime = Math.min(clip.inS + (clock.current - start), element.duration - 0.05);
      if (live.current.playing && !live.current.finished) void element.play().catch(() => !disposed && setPlaying(false));
    };
    if (element.readyState >= 1) cue();
    else element.addEventListener("loadedmetadata", cue, { once: true });
    return () => {
      disposed = true;
      element.removeEventListener("loadedmetadata", cue);
    };
  }, [media?.src, clip?.inS, clip?.outS, start, seekVersion]);

  useEffect(() => {
    const element = video.current;
    if (!element) return;
    if (!playing || finished || !media) element.pause();
    else if (element.readyState >= 2) void element.play().catch(() => setPlaying(false));
  }, [playing, finished, media?.src]);

  // The film clock follows the video while a clip plays, and real time otherwise.
  useEffect(() => {
    if (!playing || finished || mediaError) return;
    let raf = 0;
    let last = performance.now();
    let painted = last;
    const tick = (now: number) => {
      const state = live.current;
      const delta = Math.min(0.1, (now - last) / 1_000);
      last = now;
      let next = clock.current;
      if (state.clip) {
        const element = video.current;
        if (element && !element.seeking && element.readyState >= 2) {
          next = state.position.start + Math.max(0, element.currentTime - state.clip.inS);
        }
      } else next += delta;
      const end = state.position.start + state.position.duration;
      if (next >= end - 0.035) next = end;
      clock.current = Math.min(duration, next);
      if (state.position.beat.kind === "route" && !reducedMotion) {
        state.onRoutePass(Math.min(1, (clock.current - state.position.start) / state.position.duration));
      }
      if (now - painted >= 32 || next >= end) {
        painted = now;
        setTime(clock.current);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, finished, mediaError, duration, reducedMotion]);

  const jump = (seconds: number, resume = playing) => {
    const next = Math.max(0, Math.min(duration, seconds));
    clock.current = next;
    setTime(next);
    setPlaying(resume);
    setMediaError(false);
    setSeekVersion((version) => version + 1);
  };
  const toggle = () => {
    if (finished) {
      setSceneChoices({});
      jump(0, true);
    } else setPlaying((current) => !current);
  };

  const kind =
    beat.kind === "route"
      ? `The recorded route · ${adventure.leg.label}`
      : showScene && scene
        ? `Captured scene by ${scene.attribution.author} on Sketchfab`
        : beat.kind === "scene"
          ? `${footageKind(media, beat.title)}, in place of the captured scene`
          : footageKind(media, beat.title);
  const captionVisible = !playing || finished || elapsed < CAPTION_S;

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal container={container}>
        <Dialog.Content
          data-testid="adventure-film"
          data-beat-index={index}
          data-beat-kind={beat.kind}
          data-scene-shown={showScene}
          data-playing={playing && !finished}
          data-finished={finished}
          className={cn("adv-film", beat.kind === "route" && !finished && "adv-film-route")}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            (event.currentTarget as HTMLElement).querySelector<HTMLElement>("[data-autofocus]")?.focus();
          }}
          onKeyDown={(event) => {
            const target = event.target as HTMLElement;
            if (event.key === " " && !target.closest("button, input, a")) {
              event.preventDefault();
              toggle();
            }
          }}
        >
          <Dialog.Title className="sr-only">{film.title}</Dialog.Title>
          <Dialog.Description className="sr-only">
            A short film of the adventure. Pause, seek, or go back to the route at any time.
          </Dialog.Description>

          <div className="adv-film-picture" aria-hidden={beat.kind === "route"}>
            {scene && !sceneFailed ? (
              <div className="adv-film-scene" style={{ opacity: showScene ? 1 : 0 }} aria-hidden={!showScene}>
                <SketchfabFrame
                  scene={scene}
                  seconds={beat.kind === "scene" ? beat.inS + (reducedMotion ? 0 : (elapsed / beat.durationS) * (beat.outS - beat.inS)) : sceneBeat?.kind === "scene" ? sceneBeat.inS : 0}
                  interactive={false}
                  onState={setSceneFrame}
                  className="adv-scene-frame"
                />
              </div>
            ) : null}
            {media ? (
              <video
                ref={video}
                className="adv-film-video"
                src={adventureMediaUrl(adventure.adventure, media.src)}
                poster={media.poster ? adventureMediaUrl(adventure.adventure, media.poster) : undefined}
                playsInline
                muted={!sound}
                preload="auto"
                aria-label={media.title}
                onError={() => { setMediaError(true); setPlaying(false); }}
              />
            ) : null}
          </div>

          <div className="adv-film-top">
            <Dialog.Close asChild>
              <button type="button" className="adv-button adv-button-light">
                <ArrowLeft aria-hidden="true" />
                Back to the route at {kilometres(returnM)}
              </button>
            </Dialog.Close>
            {media && !finished ? (
              <button type="button" className="adv-button adv-button-quiet" aria-pressed={sound} onClick={() => onSound(!sound)}>
                {sound ? <Volume2 aria-hidden="true" /> : <VolumeX aria-hidden="true" />}
                {sound ? "Field audio on" : "Field audio off"}
              </button>
            ) : null}
          </div>

          <div className="adv-film-story" data-visible={captionVisible} aria-live="polite" aria-atomic="true">
            {finished ? (
              <>
                <h2 className="adv-film-title">{film.title}</h2>
                <div className="adv-transport">
                  <Dialog.Close asChild>
                    <button type="button" className="adv-button adv-button-light" data-autofocus>
                      <ArrowLeft aria-hidden="true" />
                      Back to the route
                    </button>
                  </Dialog.Close>
                  {scene ? (
                    <button type="button" className="adv-button adv-button-quiet" onClick={() => onScene(scene)}>
                      <Box aria-hidden="true" />
                      Step inside the scene
                    </button>
                  ) : null}
                </div>
              </>
            ) : (
              <>
                <h2 key={index} className="adv-film-title">{beat.title}</h2>
                <p className="adv-film-kind">{kind}</p>
              </>
            )}
          </div>

          {mediaError ? (
            <div className="adv-media-error adv-film-error" role="alert">
              <p>This clip could not play.</p>
              <button type="button" className="adv-button adv-button-light" onClick={() => jump(start, true)}>Try again</button>
              <button type="button" className="adv-button adv-button-quiet" onClick={() => jump(start + beatDuration(beat), true)}>Next shot</button>
            </div>
          ) : null}

          <div className="adv-film-bottom">
            <button
              type="button"
              className="adv-icon-button adv-icon-button-light"
              data-autofocus={!finished || undefined}
              onClick={toggle}
              aria-label={finished ? "Play the film again" : playing ? "Pause the film" : "Play the film"}
            >
              {finished ? <RotateCcw aria-hidden="true" /> : playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
            </button>
            <label className="adv-film-timeline">
              <span className="sr-only">Film position</span>
              <input
                type="range"
                min={0}
                max={duration}
                step={0.1}
                value={time}
                onChange={(event) => jump(Number(event.target.value))}
                aria-valuetext={`${formatClock(time)} of ${formatClock(duration)}, ${beat.title}`}
                style={{ "--film-progress": `${(100 * time) / duration}%` } as CSSProperties}
              />
            </label>
            <span className="adv-clock">
              {formatClock(time)} / {formatClock(duration)}
            </span>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
