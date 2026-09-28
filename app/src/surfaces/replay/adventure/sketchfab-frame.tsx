import { useEffect, useRef, useState } from "react";

import { tourPose, type AdventureScene } from "@/domain/adventure";

const CHANNEL = "godiesel-sketchfab";
/**
 * A capture can be large and slow; that is not failure. Only a load that
 * reports no progress for this long is treated as stalled.
 */
const STALL_TIMEOUT_MS = 20_000;

export type SceneFrameState =
  | { state: "loading"; progress: number }
  | { state: "ready" }
  | { state: "failed" };

function sceneViewerUrl(modelId: string) {
  const base = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;
  return `${base}scene-viewer.html?model=${modelId}`;
}

/**
 * A hosted captured scene behind goDiesel's same-origin bridge. The parent
 * only sends validated camera poses; `seconds` places the authored tour.
 */
export function SketchfabFrame({
  scene,
  seconds,
  interactive,
  onState,
  className,
}: {
  scene: AdventureScene;
  seconds: number;
  interactive: boolean;
  onState: (state: SceneFrameState) => void;
  className?: string;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const secondsRef = useRef(seconds);
  secondsRef.current = seconds;
  const onStateRef = useRef(onState);
  onStateRef.current = onState;

  const send = (type: string, value: unknown) =>
    frame.current?.contentWindow?.postMessage({ channel: CHANNEL, type, value }, location.origin);

  useEffect(() => {
    let settled = false;
    const fail = () => {
      if (settled) return;
      settled = true;
      onStateRef.current({ state: "failed" });
    };
    let stall = window.setTimeout(fail, STALL_TIMEOUT_MS);
    const listen = (event: MessageEvent) => {
      if (event.origin !== location.origin || event.source !== frame.current?.contentWindow) return;
      const data = event.data as { channel?: string; type?: string; value?: unknown } | undefined;
      if (data?.channel !== CHANNEL || settled) return;
      if (data.type === "progress" && typeof data.value === "number" && Number.isFinite(data.value)) {
        window.clearTimeout(stall);
        stall = window.setTimeout(fail, STALL_TIMEOUT_MS);
        onStateRef.current({ state: "loading", progress: Math.max(0, Math.min(1, data.value)) });
      } else if (data.type === "ready") {
        settled = true;
        window.clearTimeout(stall);
        if (scene.tour.fovDeg) send("fov", scene.tour.fovDeg);
        send("camera", tourPose(scene.tour.shots, secondsRef.current));
        setReady(true);
        onStateRef.current({ state: "ready" });
      } else if (data.type === "error") {
        fail();
      }
    };
    onStateRef.current({ state: "loading", progress: 0 });
    window.addEventListener("message", listen);
    return () => {
      settled = true;
      window.clearTimeout(stall);
      window.removeEventListener("message", listen);
    };
  }, [scene]);

  useEffect(() => {
    if (ready && !interactive) send("camera", tourPose(scene.tour.shots, seconds));
  }, [ready, interactive, scene, seconds]);

  useEffect(() => {
    if (ready) send("interaction", interactive);
  }, [ready, interactive]);

  return (
    <iframe
      ref={frame}
      src={sceneViewerUrl(scene.modelId)}
      title={`Captured 3D scene: ${scene.title}`}
      allow="autoplay; fullscreen; xr-spatial-tracking"
      tabIndex={interactive ? 0 : -1}
      className={className}
    />
  );
}
