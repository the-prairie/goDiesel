import { useEffect, useRef, type ReactNode, type Ref } from "react";

import { context2d } from "@/labs/overland/engine/canvas";
import { C } from "@/labs/overland/engine/palette";
import { sprites } from "@/labs/overland/engine/sprites";
import { drawLabel } from "@/labs/overland/engine/screens";

// The handheld's keys and labels, shared by the world, the entry and the realm.

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

export function Device({ children, keys }: { children: ReactNode; keys: ReactNode }) {
  return (
    <div className="overland-device">
      <div className="overland-glass">
        <div className="overland-screen">{children}</div>
      </div>
      <div className="overland-keys">{keys}</div>
    </div>
  );
}
