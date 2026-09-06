import { useState } from "react";
import { saveWorldDiagnostics } from "./world-diagnostics";
import type { WorldEnvironment } from "./world-model";

export type ReplayWorldMode = "native" | "cinematic";
interface Props {
  mode: ReplayWorldMode;
  environment: WorldEnvironment;
  onMode: (mode: ReplayWorldMode) => void;
  onEnvironment: (environment: WorldEnvironment) => void;
}
const button = "min-h-11 flex-1 rounded border border-white/20 px-3 py-2 text-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white aria-pressed:bg-white/20 hover:bg-white/10";

export function WorldControls({ mode, environment, onMode, onEnvironment }: Props) {
  const [reportMessage, setReportMessage] = useState("");
  return (
    <div className="mt-4 space-y-4 border-b border-white/15 pb-4" data-testid="cinematic-world-settings">
      <fieldset>
        <legend className="mb-2 text-xs font-semibold">Replay world</legend>
        <div className="flex gap-2">
          <button className={button} type="button" aria-pressed={mode === "native"} onClick={() => onMode("native")}>Native Replay</button>
          <button className={button} type="button" aria-pressed={mode === "cinematic"} onClick={() => onMode("cinematic")}>Cinematic world</button>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-white/70">Cinematic world is an experimental flight through real terrain, with road names and a sky you can shape.</p>
      </fieldset>
      {mode === "cinematic" ? <>
        <fieldset>
          <legend className="mb-2 text-xs font-semibold">Light</legend>
          <div className="flex gap-2">{([
            ["daylight", "Daylight"], ["golden", "Golden hour"], ["blue", "Blue hour"],
          ] as const).map(([light, label]) => <button className={button} type="button" key={light} aria-pressed={environment.light === light} onClick={() => onEnvironment({ ...environment, light })}>{label}</button>)}</div>
        </fieldset>
        <label className="block text-xs font-semibold">
          Cloud cover <span className="float-right tabular-nums">{Math.round(environment.clouds * 100)}%</span>
          <input className="mt-1 block h-11 w-full accent-white disabled:opacity-40" type="range" min="0" max="100" step="5" aria-label="Cloud cover" disabled={environment.quality === "light"} value={Math.round(environment.clouds * 100)} onChange={(event) => onEnvironment({ ...environment, clouds: Number(event.target.value) / 100 })} />
        </label>
        <p className="text-xs leading-relaxed text-white/70">Light and clouds set the mood, not the day’s recorded weather.</p>
        <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3 text-xs font-semibold">
          Road names and landmarks
          <input className="size-5 accent-white" type="checkbox" checked={environment.labels} onChange={(event) => onEnvironment({ ...environment, labels: event.target.checked })} />
        </label>
        <fieldset>
          <legend className="mb-2 text-xs font-semibold">Detail</legend>
          <div className="flex gap-2">{(["light", "balanced", "cinema"] as const).map((quality) => <button className={`${button} capitalize`} key={quality} type="button" aria-pressed={environment.quality === quality} onClick={() => onEnvironment({ ...environment, quality })}>{quality[0].toUpperCase() + quality.slice(1)}</button>)}</div>
          <p className="mt-2 text-xs leading-relaxed text-white/70">Light turns off clouds. Balanced adjusts detail to keep the flight responsive.</p>
        </fieldset>
        <div>
          <button className={button} type="button" onClick={() => setReportMessage(saveWorldDiagnostics() ? "Playback report saved." : "The report could not be saved. Please try again.")}>Save playback report</button>
          <p className="mt-2 text-xs leading-relaxed text-white/70">Saves the last minute and session totals, including camera changes and this device’s settings. Nothing is sent automatically.</p>
          <p className="text-xs text-white/70" role="status">{reportMessage}</p>
        </div>
      </> : null}
    </div>
  );
}
