import * as Dialog from "@radix-ui/react-dialog";
import { ArrowLeft, Pause, Play, RotateCcw, Volume2, VolumeX } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { Adventure, PlacedChapter } from "@/domain/adventure";
import { formatClock } from "@/domain/adventure";
import { adventureMediaUrl } from "@/data/adventure-repository";
import { footageKind, kilometres } from "@/surfaces/replay/adventure/adventure-format";

/**
 * One clip at the chapter it belongs to. The route is paused beneath it and
 * the way back names the exact distance it returns to.
 */
export function AdventureFootageDialog({
  adventure,
  chapter,
  container,
  returnM,
  reducedMotion,
  sound,
  onSound,
  onClose,
}: {
  adventure: Adventure;
  chapter: PlacedChapter;
  container: HTMLElement | null;
  returnM: number;
  reducedMotion: boolean;
  sound: boolean;
  onSound: (enabled: boolean) => void;
  onClose: () => void;
}) {
  const footage = chapter.footage!;
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [ended, setEnded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [time, setTime] = useState({ current: 0, duration: 0 });

  useEffect(() => {
    const element = video.current;
    if (!element || reducedMotion) return;
    void element.play().catch(() => setPlaying(false));
  }, [reducedMotion, footage.id]);

  const toggle = () => {
    const element = video.current;
    if (!element) return;
    if (ended) element.currentTime = 0;
    if (element.paused) void element.play().catch(() => setFailed(true));
    else element.pause();
  };

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal container={container}>
        <Dialog.Overlay className="adv-scrim" />
        <Dialog.Content
          data-testid="adventure-footage"
          data-footage-id={footage.id}
          className="adv-stage adv-footage"
          // Escape closes this overlay and stops there: a Replay stage that leaves on
          // Escape (Google 3D) must not also receive it.
          onEscapeKeyDown={(event) => event.stopPropagation()}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            (event.currentTarget as HTMLElement).querySelector<HTMLElement>("[data-autofocus]")?.focus();
          }}
        >
          <figure className="adv-footage-plate">
            <video
              ref={video}
              src={adventureMediaUrl(adventure, footage.src)}
              poster={footage.poster ? adventureMediaUrl(adventure, footage.poster) : undefined}
              playsInline
              muted={!sound}
              preload="metadata"
              aria-label={footage.title}
              onPlay={() => { setPlaying(true); setEnded(false); }}
              onPause={() => setPlaying(false)}
              onEnded={() => { setPlaying(false); setEnded(true); }}
              onError={() => setFailed(true)}
              onTimeUpdate={(event) => setTime({ current: event.currentTarget.currentTime, duration: event.currentTarget.duration || 0 })}
              onLoadedMetadata={(event) => setTime({ current: 0, duration: event.currentTarget.duration || 0 })}
              onClick={toggle}
            />
            {failed ? (
              <p className="adv-media-error" role="alert">
                This clip could not play. The route is waiting where you left it.
              </p>
            ) : null}
          </figure>

          <div className="adv-footage-text">
            <Dialog.Title className="adv-stage-title">{chapter.title}</Dialog.Title>
            <p className="adv-stage-kind">{footageKind(footage, chapter.title)}</p>
            {chapter.note ? <Dialog.Description className="adv-stage-note">{chapter.note}</Dialog.Description> : (
              <Dialog.Description className="sr-only">Footage placed with this chapter of the route.</Dialog.Description>
            )}
            <p className="adv-provenance adv-provenance-dark">
              {footage.origin === "rendered"
                ? `A flyover rendered from ${footage.credit} imagery, placed with chapter ${chapter.ordinal} at ${kilometres(chapter.atDistanceM)}. It is not the owner's footage or a recording of the route.`
                : `Placed with chapter ${chapter.ordinal} at ${kilometres(chapter.atDistanceM)}. The clip carries no position of its own.`}
            </p>

            <div className="adv-transport">
              <button type="button" className="adv-button adv-button-light" data-autofocus onClick={toggle} disabled={failed}>
                {ended ? <RotateCcw aria-hidden="true" /> : playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
                {ended ? "Watch again" : playing ? "Pause clip" : "Play clip"}
              </button>
              <button
                type="button"
                className="adv-button adv-button-quiet"
                aria-pressed={sound}
                onClick={() => onSound(!sound)}
              >
                {sound ? <Volume2 aria-hidden="true" /> : <VolumeX aria-hidden="true" />}
                {sound ? "Field audio on" : "Field audio off"}
              </button>
              <span className="adv-clock" aria-hidden="true">
                {formatClock(time.current)} / {formatClock(time.duration)}
              </span>
            </div>

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
