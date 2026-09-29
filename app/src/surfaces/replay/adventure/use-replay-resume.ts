import { useCallback, useEffect, useRef, useState } from "react";

import type { AdventureHold } from "@/surfaces/replay/playback/replay-hold";

/**
 * Inspecting another chapter mid-playback pauses and offers the way back to
 * where the reader was. Pressing play yourself answers that question. Shared
 * by every Replay stage so they interrupt and resume the same way.
 */
export function useReplayResume<H extends AdventureHold>({
  playing,
  isPlaying,
  hold,
  release,
  seek,
}: {
  playing: boolean;
  /** Read at call time, not render time: playback advances between renders. */
  isPlaying: () => boolean;
  hold: () => H;
  release: (held: H) => void;
  seek: (distanceM: number) => void;
}) {
  const resumeRef = useRef<H | undefined>(undefined);
  const [resume, setResumeState] = useState<H>();
  const releasing = useRef(false);
  const setResume = useCallback((held: H | undefined) => {
    resumeRef.current = held;
    setResumeState(held);
  }, []);

  const inspect = useCallback((distanceM: number) => {
    if (isPlaying() && !resumeRef.current) setResume(hold());
    seek(distanceM);
  }, [hold, isPlaying, seek, setResume]);

  const resumeHeld = useCallback(() => {
    const held = resumeRef.current;
    if (!held) return;
    setResume(undefined);
    releasing.current = held.playing;
    release(held);
  }, [release, setResume]);

  useEffect(() => {
    if (!playing) return;
    if (releasing.current) releasing.current = false;
    else setResume(undefined);
  }, [playing, setResume]);

  return { resume, inspect, resumeHeld, dismiss: () => setResume(undefined) };
}
