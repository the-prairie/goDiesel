export function completeFrameInterval(
  previousFrameMs: number,
  currentFrameMs: number,
  measurementStartedAtMs: number,
  measurementDeadlineMs: number,
) {
  if (
    previousFrameMs < measurementStartedAtMs ||
    currentFrameMs > measurementDeadlineMs
  ) {
    return undefined;
  }
  const interval = currentFrameMs - previousFrameMs;
  return interval > 0 && interval < 1_000 ? interval : undefined;
}
