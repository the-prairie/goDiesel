import { useEffect, useRef, useSyncExternalStore, type ReactNode, type Ref } from "react";

import { context2d } from "@/labs/overland/engine/canvas";
import { C } from "@/labs/overland/engine/palette";
import { sprites } from "@/labs/overland/engine/sprites";
import { drawLabel } from "@/labs/overland/engine/screens";
import { PHONE_QUERY } from "@/labs/overland/model/world-screen";

function subscribePhone(onChange: () => void) {
  const query = window.matchMedia(PHONE_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** A phone, or any short screen; read during render, so a phone never paints the desktop layout first. */
export function usePhone() {
  return useSyncExternalStore(subscribePhone, () => window.matchMedia(PHONE_QUERY).matches, () => false);
}

// The handheld's keys and labels, shared by the world, the entry and the realm.

/** A key's label in the given skin: Overland's pixel font, or the sketch's plain ink text. */
export function SkinLabel({ text, skin, bold = false, colour }: { text: string; skin: "pixel" | "sketch"; bold?: boolean; colour?: string }) {
  if (skin === "sketch") return <span className={bold ? "sketch-label sketch-label-bold" : "sketch-label"}>{text}</span>;
  return <PixelLabel bold={bold} colour={colour} scale={2} text={text} />;
}

/** A label drawn in the Overland font; the button around it carries the name. */
export function PixelLabel({ text, colour = C.ink, bold = false, scale }: { text: string; colour?: string; bold?: boolean; scale: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const target = ref.current;
    if (!target) return;
    const label = drawLabel(text, colour, bold);
    target.width = label.width;
    target.height = label.height;
    context2d(target).drawImage(label, 0, 0);
  }, [bold, colour, text]);
  return <canvas aria-hidden="true" className="overland-pixels" ref={ref} style={{ height: 9 * scale, width: "auto" }} />;
}

export function ArrowIcon({ direction, scale }: { direction: "left" | "right"; scale: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const target = ref.current;
    if (target) context2d(target).drawImage(sprites().icons[direction], 0, 0);
  }, [direction]);
  return <canvas aria-hidden="true" className="overland-pixels" height={7} ref={ref} style={{ width: 5 * scale, height: 7 * scale }} width={5} />;
}

export function Key({
  label,
  children,
  onClick,
  pressed,
  className = "",
  ref,
}: {
  label: string;
  children: ReactNode;
  onClick: () => void;
  pressed?: boolean;
  className?: string;
  ref?: Ref<HTMLButtonElement>;
}) {
  return (
    <button aria-label={label} aria-pressed={pressed} className={`overland-key ${className}`} onClick={onClick} ref={ref} type="button">
      {children}
    </button>
  );
}

/**
 * The handheld: a screen in its glass with the keys below. `bare` drops the
 * shell for a phone, where the screen fills the display and the keys sit in
 * a bar at the bottom; `corner` is a key laid over the screen's top right.
 */
export function Device({ children, keys, bare = false, corner }: { children: ReactNode; keys: ReactNode; bare?: boolean; corner?: ReactNode }) {
  if (bare) {
    return (
      <div className="overland-phone">
        <div className="overland-screen overland-phone-screen">
          {children}
          {corner ? <div className="overland-phone-corner">{corner}</div> : null}
        </div>
        <div className="overland-keys overland-phone-keys">{keys}</div>
      </div>
    );
  }
  return (
    <div className="overland-device">
      <div className="overland-glass">
        <div className="overland-screen">{children}</div>
      </div>
      <div className="overland-keys">{keys}</div>
    </div>
  );
}

/** The pixel down-arrow, scaled whole-pixel. */
export function DownArrow({ scale }: { scale: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const target = ref.current;
    if (target) context2d(target).drawImage(sprites().icons.down, 0, 0);
  }, []);
  return <canvas aria-hidden="true" className="overland-pixels" height={4} ref={ref} style={{ width: 7 * scale, height: 4 * scale }} width={7} />;
}
