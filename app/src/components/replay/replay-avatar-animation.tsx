import {
  DotLottieReact,
  setWasmUrl,
  type DotLottie,
} from "@lottiefiles/dotlottie-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import { loadReplayAvatarData } from "@/replay/replay-avatar-assets";

setWasmUrl("/dotlottieStatic/dotlottie-player.wasm");

export interface ReplayAvatarAnimationHandle {
  sync(progressM: number, reducedMotion: boolean): void;
}

const representativeFrameRatio = 0.18;
const strideDistanceM = 2.8;

export function ReplayAvatarAnimation({
  src,
  label,
  className,
  preview = false,
  onHandle,
}: {
  src: string;
  label: string;
  className?: string;
  preview?: boolean;
  onHandle?: (handle: ReplayAvatarAnimationHandle | undefined) => void;
}) {
  const [data, setData] = useState<ArrayBuffer>();
  const [loadFailed, setLoadFailed] = useState(false);
  const [instance, setInstance] = useState<DotLottie | null>(null);
  const hostRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let active = true;
    setData(undefined);
    setLoadFailed(false);
    void loadReplayAvatarData(src)
      .then((nextData) => {
        if (active) setData(nextData);
      })
      .catch(() => {
        if (active) setLoadFailed(true);
      });
    return () => {
      active = false;
    };
  }, [src]);

  useEffect(() => {
    if (!instance) return;
    const sync = (progressM: number, reducedMotion: boolean) => {
      const totalFrames = Math.max(1, instance.totalFrames);
      const phase = reducedMotion
        ? representativeFrameRatio
        : (progressM / strideDistanceM) % 1;
      const frame = Math.min(
        totalFrames - 1,
        Math.floor(phase * totalFrames),
      );
      instance.pause();
      instance.setFrame(frame);
      if (hostRef.current) {
        hostRef.current.dataset.avatarFrame = String(frame);
      }
    };
    const handle = { sync };
    const applyInitialPose = () => {
      onHandle?.(handle);
      if (preview) handle.sync(0, true);
    };
    instance.addEventListener("load", applyInitialPose);
    applyInitialPose();
    return () => {
      instance.removeEventListener("load", applyInitialPose);
      onHandle?.(undefined);
    };
  }, [instance, onHandle, preview]);

  if (!data) {
    return (
      <span
        aria-hidden="true"
        data-avatar-animation={loadFailed ? "error" : "loading"}
        className={cn(
          "block size-full rounded-full",
          loadFailed ? "bg-destructive/25" : "bg-primary/20",
          className,
        )}
      />
    );
  }

  return (
    <span
      ref={hostRef}
      data-avatar-animation="ready"
      className={cn("block size-full", className)}
    >
      <DotLottieReact
        data={data}
        autoplay={false}
        loop
        layout={{ fit: "contain", align: [0.5, 0.5] }}
        renderConfig={{
          autoResize: true,
          devicePixelRatio: Math.min(window.devicePixelRatio, 2),
          freezeOnOffscreen: true,
        }}
        dotLottieRefCallback={setInstance}
        aria-label={label}
        className="size-full"
      />
    </span>
  );
}
