import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";

import { chapterAt, type PlacedChapter, type PlacedScene, type RouteAdventure } from "@/domain/adventure";
import { AdventureChapterCard } from "@/surfaces/replay/adventure/adventure-chapter-card";
import { AdventureFilm } from "@/surfaces/replay/adventure/adventure-film";
import { AdventureFootageDialog } from "@/surfaces/replay/adventure/adventure-footage-dialog";
import { adventureLegPath } from "@/surfaces/replay/adventure/adventure-paths";
import { AdventureSceneDialog } from "@/surfaces/replay/adventure/adventure-scene-dialog";
import type { ReplayHold } from "@/surfaces/replay/playback/replay-hold";

/** The chapter a scene sits in, when that chapter has footage to fall back to. */
function footageChapterFor(adventure: RouteAdventure, scene: PlacedScene) {
  const chapter = chapterAt(adventure.chapters, scene.atDistanceM);
  return chapter?.footage ? chapter : undefined;
}

const NOTE_HOLD_MS = 6_000;

type Overlay =
  | { kind: "footage"; chapter: PlacedChapter }
  | { kind: "scene"; scene: PlacedScene }
  | { kind: "film" };

export interface ReplayAdventureControls {
  /** Pause and remember exactly where and how the route was playing. */
  hold: (reason: ReplayHold["reason"]) => ReplayHold;
  release: (hold: ReplayHold) => void;
  seek: (distanceM: number) => void;
  /** The film's route beat: a fraction of this recording, seen from above. */
  routePass: (fraction: number) => void;
}

export function ReplayAdventureLayer({
  adventure,
  progressM,
  playing,
  reducedMotion,
  container,
  controls,
  resume,
  onInspect,
  onResume,
  onDismissResume,
  onPresenting,
}: {
  adventure: RouteAdventure;
  progressM: number;
  playing: boolean;
  reducedMotion: boolean;
  container: HTMLElement | null;
  controls: ReplayAdventureControls;
  resume?: ReplayHold;
  onInspect: (distanceM: number) => void;
  onResume: () => void;
  onDismissResume: () => void;
  /** Which representation owns the stage, so Replay can step its chrome back. */
  onPresenting: (kind: "footage" | "scene" | "film" | undefined) => void;
}) {
  const location = useLocation();
  const [overlay, setOverlay] = useState<Overlay>();
  const [listOpen, setListOpen] = useState(false);
  const [sound, setSound] = useState(false);
  const overlayHold = useRef<ReplayHold | undefined>(undefined);

  // While the route plays, a chapter's note is read as it arrives and then
  // recedes to its title, so the geography keeps the screen. Paused, it stays.
  const currentId = chapterAt(adventure.chapters, progressM)?.id;
  const [freshChapter, setFreshChapter] = useState<string | undefined>(currentId);
  useEffect(() => {
    setFreshChapter(currentId);
    const timer = window.setTimeout(() => setFreshChapter(undefined), NOTE_HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [currentId]);
  const compact = playing && freshChapter !== currentId;

  const open = useCallback((next: Overlay, reason: ReplayHold["reason"]) => {
    // Moving between overlays keeps the first hold: the way back stays the
    // distance the reader left the route at, not wherever the film moved it.
    overlayHold.current ??= controls.hold(reason);
    setOverlay(next);
  }, [controls]);

  const close = useCallback(() => {
    const hold = overlayHold.current;
    overlayHold.current = undefined;
    setOverlay(undefined);
    if (hold) controls.release(hold);
  }, [controls]);

  useEffect(() => onPresenting(overlay?.kind), [overlay?.kind, onPresenting]);
  useEffect(() => () => onPresenting(undefined), [onPresenting]);

  const legPath = useCallback(
    (slug: string, atM?: number) => adventureLegPath(location.search, adventure.leg.slug, slug, atM),
    [location.search, adventure.leg.slug],
  );

  const returnM = overlayHold.current?.control.progressM ?? progressM;

  return (
    <>
      <AdventureChapterCard
        adventure={adventure}
        progressM={progressM}
        compact={compact && !listOpen}
        listOpen={listOpen}
        resume={resume}
        legPath={legPath}
        onToggleList={() => setListOpen((value) => !value)}
        onSeek={onInspect}
        onResume={onResume}
        onDismissResume={onDismissResume}
        onWatch={(chapter) => open({ kind: "footage", chapter }, "footage")}
        onScene={(scene) => open({ kind: "scene", scene }, "scene")}
        onFilm={() => open({ kind: "film" }, "film")}
      />

      {overlay?.kind === "footage" ? (
        <AdventureFootageDialog
          adventure={adventure.adventure}
          chapter={overlay.chapter}
          container={container}
          returnM={returnM}
          reducedMotion={reducedMotion}
          sound={sound}
          onSound={setSound}
          onClose={close}
        />
      ) : null}
      {overlay?.kind === "scene" ? (
        <AdventureSceneDialog
          scene={overlay.scene}
          chapterWithFootage={footageChapterFor(adventure, overlay.scene)}
          container={container}
          returnM={returnM}
          reducedMotion={reducedMotion}
          onWatch={(chapter) => setOverlay({ kind: "footage", chapter })}
          onClose={close}
        />
      ) : null}
      {overlay?.kind === "film" ? (
        <AdventureFilm
          adventure={adventure}
          container={container}
          returnM={returnM}
          reducedMotion={reducedMotion}
          sound={sound}
          onSound={setSound}
          onRoutePass={controls.routePass}
          onScene={(scene) => setOverlay({ kind: "scene", scene })}
          onClose={close}
        />
      ) : null}
    </>
  );
}
