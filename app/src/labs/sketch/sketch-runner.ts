// Her marker in the 3D world, in the sketch's language: a figure drawn in
// ink from behind, as the chase camera sees her, with the one red accent.
// Four frames of a stride (or a pedal stroke), drawn in code as SVG.

export const SKETCH_INK = "#1d1d1f";
export const SKETCH_RED = "#d9412b";
const PAPER = "#fbfbf8";

/** The figure's height in CSS pixels for a screen of this height. */
function figureHeight(viewportHeight: number) {
  return Math.round(Math.min(96, Math.max(48, viewportHeight * 0.085)));
}

function runnerSvg(step: number) {
  // A stride: legs and arms swing opposite, the body bobs a little.
  const swing = [0.55, 0.15, -0.55, -0.15][step];
  const bob = [0, -1.2, 0, -1.2][step];
  const leg = (sign: number) => {
    const hip: [number, number] = [sign * 3, 40 + bob];
    const knee: [number, number] = [hip[0] + Math.sin(swing * sign) * 7, hip[1] + 11];
    const foot: [number, number] = [knee[0] + Math.sin(swing * sign * 0.4) * 3, knee[1] + 12];
    return `M${hip[0]} ${hip[1]} L${knee[0].toFixed(1)} ${knee[1].toFixed(1)} L${foot[0].toFixed(1)} ${foot[1].toFixed(1)}`;
  };
  const arm = (sign: number) => {
    const shoulder: [number, number] = [sign * 7, 22 + bob];
    const elbow: [number, number] = [shoulder[0] + sign * 3, shoulder[1] + 8 + Math.sin(-swing * sign) * 3];
    const hand: [number, number] = [elbow[0] - sign * 2, elbow[1] + 7];
    return `M${shoulder[0]} ${shoulder[1]} L${elbow[0].toFixed(1)} ${elbow[1].toFixed(1)} L${hand[0].toFixed(1)} ${hand[1].toFixed(1)}`;
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-20 0 40 70" width="40" height="70">
<ellipse cx="0" cy="66" rx="9" ry="2.2" fill="${SKETCH_INK}" opacity="0.18"/>
<g fill="none" stroke="${SKETCH_INK}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
<path d="${leg(-1)}"/><path d="${leg(1)}"/>
<path d="M-7 ${21 + bob} Q0 ${18 + bob} 7 ${21 + bob} L5 ${40 + bob} L-5 ${40 + bob} Z" fill="${PAPER}"/>
<path d="M-6 ${30 + bob} L6 ${30 + bob}" stroke="${SKETCH_RED}" stroke-width="3"/>
<path d="${arm(-1)}"/><path d="${arm(1)}"/>
<circle cx="0" cy="${12 + bob}" r="6" fill="${PAPER}"/>
<path d="M-6 ${10 + bob} Q0 ${3 + bob} 6 ${10 + bob}" stroke="${SKETCH_RED}" stroke-width="2.6"/>
</g></svg>`;
}

function riderSvg(step: number) {
  const angle = (step / 4) * Math.PI * 2;
  const pedal = (sign: number) => `M0 52 L${(Math.cos(angle) * 5 * sign).toFixed(1)} ${(52 + Math.sin(angle) * 5 * sign).toFixed(1)}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-20 0 40 70" width="40" height="70">
<ellipse cx="0" cy="66" rx="10" ry="2.2" fill="${SKETCH_INK}" opacity="0.18"/>
<g fill="none" stroke="${SKETCH_INK}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
<circle cx="0" cy="56" r="9"/>
<path d="${pedal(1)}"/><path d="${pedal(-1)}"/>
<path d="M-8 22 Q0 19 8 22 L5 42 L-5 42 Z" fill="${PAPER}"/>
<path d="M-6 30 L6 30" stroke="${SKETCH_RED}" stroke-width="3"/>
<path d="M-7 24 L-11 34 M7 24 L11 34"/>
<circle cx="0" cy="13" r="6" fill="${PAPER}"/>
<path d="M-7 11 Q0 3 7 11" stroke="${SKETCH_RED}" stroke-width="2.6"/>
</g></svg>`;
}

export function sketchRunnerFrames(kind: "run" | "ride", viewportHeight: number) {
  const height = figureHeight(viewportHeight);
  const width = Math.round((height * 40) / 70);
  const urls = [0, 1, 2, 3].map((step) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(kind === "run" ? runnerSvg(step) : riderSvg(step))}`);
  return { width, height, urls };
}
