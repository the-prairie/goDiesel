import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import "@/labs/sketch/moment-tv-wall.css";
import type { CatalogEntry } from "@/labs/sketch/moment-catalog";
import type { MomentMedia } from "@/labs/sketch/sketch-moment-state";

// A planted moment of the "tv-wall" kind: a shop front drawn in ink, its
// window a wall of nine old television sets all showing her clip, each a
// little differently. Loaded only when the moment is opened. The clip is
// fetched only now (never with the world), muted, inline and looping, and
// released on leaving. Without a clip, or when it fails, the sets show no
// signal; with Save-Data it waits for a tap.

const INK = "#1b1a17";
const PAPER = "#f6f5ef";
const WASH = "#dcdbd3";
const WASH2 = "#c4c3ba";
type Treatment = "mono" | "green" | "warm" | "blue" | "color" | "roll";
/** The sets in the window, on a 360 × 640 drawing: x, y, width, height, treatment. */
const SETS: [number, number, number, number, Treatment][] = [
  [84, 346, 52, 42, "mono"], [140, 350, 44, 38, "green"], [188, 346, 46, 42, "warm"],
  [84, 392, 46, 44, "blue"], [134, 392, 58, 46, "color"], [196, 392, 38, 44, "roll"],
  [84, 442, 50, 52, "color"], [138, 444, 46, 50, "mono"], [188, 442, 46, 52, "warm"],
];
const TINT: Record<Treatment, string | null> = { mono: "#d8d8d8", green: "#9fe6a8", warm: "#ffd9a6", blue: "#a9cfff", color: null, roll: "#e2e2e2" };

/** The street in ink: neighbours, the shop with its sign, window, door and lamp. */
function drawing() {
  const L = (x1: number, y1: number, x2: number, y2: number, w = 1.6) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${INK}" stroke-width="${w}" stroke-linecap="round"/>`;
  const R = (x: number, y: number, w: number, h: number, f = "none", sw = 1.6, rx = 0) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${f}" stroke="${INK}" stroke-width="${sw}" stroke-linejoin="round"/>`;
  let s = `<defs><filter id="mtv-rough" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency=".035" numOctaves="2" seed="7"/><feDisplacementMap in="SourceGraphic" scale="2.4"/></filter><pattern id="mtv-hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(38)"><line x1="0" y1="0" x2="0" y2="5" stroke="${INK}" stroke-opacity=".3" stroke-width="1"/></pattern></defs><g filter="url(#mtv-rough)">`;
  s += R(-6, 170, 66, 350, PAPER) + [196, 250, 304].map((y) => R(8, y, 18, 30, WASH) + R(34, y, 18, 30, WASH)).join("") + R(6, 400, 46, 120, "url(#mtv-hatch)") + L(-6, 170, 60, 170, 2.2);
  s += R(300, 236, 66, 284, PAPER) + [262, 316].map((y) => R(312, y, 16, 26, WASH) + R(336, y, 16, 26, WASH)).join("") + R(310, 410, 44, 110, "url(#mtv-hatch)") + L(300, 236, 366, 236, 2.2);
  s += R(60, 200, 240, 320, PAPER, 2) + `<path d="M54 200h252l-6-12H60z" fill="${WASH2}" stroke="${INK}" stroke-width="1.8" stroke-linejoin="round"/>`;
  for (const x of [84, 158, 232]) s += R(x, 226, 44, 58, WASH) + L(x + 22, 226, x + 22, 284, 1) + L(x, 255, x + 44, 255, 1) + R(x - 4, 284, 52, 5, PAPER, 1.2);
  s += R(60, 300, 240, 30, INK) + `<text x="180" y="321" text-anchor="middle" font-family="ui-sans-serif,system-ui,sans-serif" font-weight="700" font-size="17" letter-spacing="3.5" fill="${PAPER}">TELEVISIONS</text>`;
  s += R(74, 336, 172, 168, "#2a2925", 2.2) + R(74, 504, 172, 16, "url(#mtv-hatch)") + R(254, 352, 38, 168, WASH, 1.8) + R(260, 360, 26, 70, PAPER, 1.2) + `<circle cx="262" cy="446" r="2.2" fill="${INK}"/>` + L(254, 352, 292, 352, 2);
  for (const [x, y, w, h] of SETS) s += R(x, y, w, h, WASH2, 1.5, 4) + `<circle cx="${x + w - 6}" cy="${y + 10}" r="2.6" fill="${PAPER}" stroke="${INK}" stroke-width="1"/><circle cx="${x + w - 6}" cy="${y + 19}" r="2" fill="${PAPER}" stroke="${INK}" stroke-width="1"/>` + L(x + w - 9, y + h - 9, x + w - 3, y + h - 9, 1) + L(x + w - 9, y + h - 6, x + w - 3, y + h - 6, 1);
  s += L(110, 346, 100, 336, 1.2) + L(110, 346, 122, 337, 1.2);
  s += L(-6, 520, 366, 520, 2.2) + L(-6, 560, 366, 560, 1.6);
  for (let x = 10; x < 360; x += 46) s += L(x, 520, x - 10, 560, 0.9);
  for (let x = 20; x < 360; x += 70) s += L(x, 600, x + 34, 600, 1.4);
  s += L(328, 520, 328, 330, 2.4) + `<path d="M328 330q0-16 -18-16" fill="none" stroke="${INK}" stroke-width="2.2" stroke-linecap="round"/>` + R(302, 312, 12, 7, PAPER, 1.4, 2);
  return `${s}</g>`;
}

export interface MomentSceneProps {
  entry: CatalogEntry;
  media: MomentMedia;
  sound: boolean;
  reducedMotion: boolean;
  onBack: () => void;
  onSound: () => void;
  onPlay: () => void;
  onReady: () => void;
  onFailed: () => void;
}

export default function MomentTvWall({ entry, media, sound, reducedMotion, onBack, onSound, onPlay, onReady, onFailed }: MomentSceneProps) {
  const art = useMemo(drawing, []);
  const canvases = useRef<(HTMLCanvasElement | null)[]>([]);
  const spill = useRef<HTMLDivElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const video = useRef<HTMLVideoElement | null>(null);
  const [inside, setInside] = useState(reducedMotion);

  // Push in to the window, a beat after the street appears (a cut with reduced motion).
  useEffect(() => {
    backRef.current?.focus({ preventScroll: true });
    if (reducedMotion) return;
    const frame = requestAnimationFrame(() => requestAnimationFrame(() => setInside(true)));
    return () => cancelAnimationFrame(frame);
  }, [reducedMotion]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onBack();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onBack]);

  // The clip: made only when it is wanted, released on leaving.
  const wantClip = Boolean(entry.clip) && (media === "loading" || media === "playing");
  useEffect(() => {
    if (!wantClip || !entry.clip) return;
    const element = document.createElement("video");
    element.muted = true;
    element.loop = true;
    element.playsInline = true;
    element.setAttribute("playsinline", "");
    element.preload = "auto";
    element.addEventListener("canplay", onReady, { once: true });
    element.addEventListener("error", onFailed, { once: true });
    element.src = entry.clip;
    element.play().catch(() => undefined);
    video.current = element;
    return () => {
      element.pause();
      element.removeAttribute("src");
      element.load();
      video.current = null;
    };
    // Made once per opening; ready and failed are stable callbacks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantClip, entry.clip]);
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    element.muted = !sound;
    if (sound) element.play().catch(() => undefined);
  }, [sound]);

  // Nine sets painted from one small source, ~18 times a second while open.
  useLayoutEffect(() => {
    const source = document.createElement("canvas");
    source.width = 192;
    source.height = 144;
    const sg = source.getContext("2d");
    if (!sg) return;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const sets = canvases.current.map((canvas, i) => {
      if (!canvas) return null;
      const [, , w, h] = SETS[i];
      canvas.width = Math.round((w - 16) * 2.2 * dpr);
      canvas.height = Math.round((h - 8) * 2.2 * dpr);
      return { canvas, g: canvas.getContext("2d"), kind: SETS[i][4], phase: (i * 0.37) % 1 };
    });
    const feed = () => {
      const element = video.current;
      if (element && element.readyState >= 2) {
        const vr = element.videoWidth / element.videoHeight;
        const cr = source.width / source.height;
        let w = source.width;
        let h = source.height;
        let x = 0;
        let y = 0;
        if (vr > cr) {
          w = source.height * vr;
          x = (source.width - w) / 2;
        } else {
          h = source.width / vr;
          y = (source.height - h) * 0.14;
        }
        sg.drawImage(element, x, y, w, h);
        return;
      }
      const image = sg.createImageData(source.width, source.height);
      for (let i = 0; i < image.data.length; i += 4) {
        const v = 40 + Math.random() * 190;
        image.data[i] = v;
        image.data[i + 1] = v;
        image.data[i + 2] = v + 12;
        image.data[i + 3] = 255;
      }
      sg.putImageData(image, 0, 0);
      const label = media === "held" ? "TAP PLAY" : media === "loading" ? "TUNING…" : "NO SIGNAL";
      sg.fillStyle = "rgba(20,22,30,.82)";
      sg.fillRect(24, 54, 144, 36);
      sg.fillStyle = "#fff";
      sg.font = "700 20px ui-sans-serif, system-ui, sans-serif";
      sg.textAlign = "center";
      sg.fillText(label, 96, 79);
    };
    const paint = (t: number) => {
      feed();
      let light = 0;
      for (const set of sets) {
        if (!set?.g) continue;
        const { g, canvas, kind } = set;
        const W = canvas.width;
        const H = canvas.height;
        g.globalCompositeOperation = "source-over";
        if (kind === "roll" && !reducedMotion) {
          const o = ((t / 900 + set.phase) % 1) * H;
          g.drawImage(source, 0, o - H, W, H);
          g.drawImage(source, 0, o, W, H);
          g.fillStyle = "#000";
          g.fillRect(0, o - 3, W, 6);
        } else g.drawImage(source, 0, 0, W, H);
        const tint = TINT[kind];
        if (tint) {
          g.globalCompositeOperation = "saturation";
          g.fillStyle = "#808080";
          g.fillRect(0, 0, W, H);
          g.globalCompositeOperation = "multiply";
          g.fillStyle = tint;
          g.fillRect(0, 0, W, H);
        }
        g.globalCompositeOperation = "source-over";
        g.fillStyle = "rgba(0,0,0,.2)";
        for (let y = 0; y < H; y += Math.max(3, Math.round(3 * dpr))) g.fillRect(0, y, W, 1);
        const vignette = g.createRadialGradient(W / 2, H / 2, H * 0.25, W / 2, H / 2, H * 0.85);
        vignette.addColorStop(0, "rgba(0,0,0,0)");
        vignette.addColorStop(1, "rgba(0,0,0,.55)");
        g.fillStyle = vignette;
        g.fillRect(0, 0, W, H);
        const flicker = reducedMotion ? 0 : Math.random() * 0.1;
        g.fillStyle = `rgba(255,255,255,${flicker})`;
        g.fillRect(0, 0, W, H);
        light += flicker;
      }
      if (spill.current) spill.current.style.opacity = String(reducedMotion ? 0.8 : 0.6 + light * 0.5);
    };
    let frame = 0;
    let last = 0;
    const loop = (t: number) => {
      if (t - last > 55 || !last) {
        last = t;
        paint(t);
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [media, reducedMotion]);

  return (
    <div aria-label={entry.title} aria-modal="true" className="moment-tv" data-inside={inside} data-media={media} data-testid="moment-scene" role="dialog">
      <div className="moment-tv-world">
        <svg aria-hidden="true" dangerouslySetInnerHTML={{ __html: art }} viewBox="0 0 360 640" />
        {SETS.map(([x, y, w, h], i) => (
          <canvas
            aria-hidden="true"
            className="moment-tv-set"
            data-testid="moment-screen"
            key={i}
            ref={(element) => {
              canvases.current[i] = element;
            }}
            style={{ left: `${(x + 4) / 3.6}%`, top: `${(y + 4) / 6.4}%`, width: `${(w - 16) / 3.6}%`, height: `${(h - 8) / 6.4}%` }}
          />
        ))}
        <div aria-hidden="true" className="moment-tv-spill" ref={spill} />
      </div>
      <div className="moment-tv-ui">
        {entry.caption ? <p className="moment-tv-caption">{entry.caption}</p> : null}
        <div className="moment-tv-row">
          <button className="moment-tv-button" onClick={onBack} ref={backRef} type="button">
            Back to the street
          </button>
          {media === "held" ? (
            <button className="moment-tv-button moment-tv-primary" onClick={onPlay} type="button">
              Play the clip
            </button>
          ) : (
            <button aria-pressed={sound} className="moment-tv-button moment-tv-primary" disabled={media !== "playing"} onClick={onSound} type="button">
              {sound ? "Sound off" : "Sound on"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
