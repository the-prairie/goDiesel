import { useEffect, useReducer, useRef, useState } from "react";
import { MapPin, Search, Upload, WandSparkles } from "lucide-react";
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";
import type {
  CourseActivity,
  CourseRequest,
  CourseVibe,
} from "@/domain/courses";

type Place = CourseRequest["start"];
type PlaceState =
  | { status: "idle" }
  | { status: "searching"; id: number }
  | { status: "choices"; places: Place[] }
  | { status: "chosen"; place: Place }
  | { status: "error"; message: string };
type PlaceEvent =
  | { type: "edit" }
  | { type: "search"; id: number }
  | { type: "results"; id: number; places: Place[] }
  | { type: "error"; id: number; message: string }
  | { type: "choose"; place: Place };
export function placeReducer(state: PlaceState, event: PlaceEvent): PlaceState {
  if (event.type === "edit") return { status: "idle" };
  if (event.type === "search") return { status: "searching", id: event.id };
  if (event.type === "choose") return { status: "chosen", place: event.place };
  if (state.status !== "searching" || state.id !== event.id) return state;
  if (event.type === "error")
    return { status: "error", message: event.message };
  return event.places.length
    ? { status: "choices", places: event.places }
    : {
        status: "error",
        message:
          "No places found. Try a nearby landmark or a more specific place.",
      };
}
const vibes: { value: CourseVibe; label: string }[] = [
  { value: "quiet", label: "Quieter roads" },
  { value: "green", label: "Parks & green" },
  { value: "water", label: "Along water" },
  { value: "paved", label: "Prefer paved" },
];
export function CourseForm({
  busy,
  onGenerate,
  onImport,
}: {
  busy: boolean;
  onGenerate: (request: CourseRequest) => void;
  onImport: (file: File, activity: CourseActivity) => void;
}) {
  const [mode, setMode] = useState<"generate" | "import">("generate");
  const [activity, setActivity] = useState<CourseActivity>("Run");
  const [query, setQuery] = useState("");
  const [place, dispatch] = useReducer(placeReducer, { status: "idle" });
  const [distance, setDistance] = useState("10");
  const [unit, setUnit] = useState<"km" | "mi">("km");
  const [preferences, setPreferences] = useState<CourseVibe[]>([]);
  const [seed, setSeed] = useState(0);
  const searchRef = useRef<AbortController | null>(null);
  const searchId = useRef(0);
  useEffect(() => () => searchRef.current?.abort(), []);
  async function search() {
    searchRef.current?.abort();
    const controller = new AbortController();
    searchRef.current = controller;
    const id = ++searchId.current;
    dispatch({ type: "search", id });
    try {
      const response = await fetch(
        `/api/discovery?place=${encodeURIComponent(query.trim())}`,
        { signal: controller.signal },
      );
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error ?? "Place search unavailable.");
      const places: Place[] = Array.isArray(data.places)
        ? data.places.filter(
            (p: Place) =>
              typeof p.name === "string" &&
              Number.isFinite(p.lat) &&
              Math.abs(p.lat) <= 90 &&
              Number.isFinite(p.lng) &&
              Math.abs(p.lng) <= 180,
          )
        : [];
      dispatch({ type: "results", id, places });
    } catch (error) {
      if (!controller.signal.aborted)
        dispatch({
          type: "error",
          id,
          message:
            error instanceof Error
              ? error.message
              : "Place search unavailable.",
        });
    }
  }
  return (
    <section className="min-w-0 space-y-5" aria-label="Create a course">
      <div
        className="flex gap-2 border-b border-line pb-3"
        role="group"
        aria-label="Creation method"
      >
        <Button
          variant={mode === "generate" ? "secondary" : "ghost"}
          aria-pressed={mode === "generate"}
          onClick={() => setMode("generate")}
          disabled={busy}
        >
          <WandSparkles />
          Plan a loop
        </Button>
        <Button
          variant={mode === "import" ? "secondary" : "ghost"}
          aria-pressed={mode === "import"}
          onClick={() => setMode("import")}
          disabled={busy}
        >
          <Upload />
          Import GPX
        </Button>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (mode === "generate" && place.status === "chosen") {
            onGenerate({
              start: place.place,
              distance: Number(distance),
              unit,
              activity,
              vibes: preferences,
              seed,
            });
            setSeed((value) => value + 1);
          }
        }}
      >
        <fieldset disabled={busy} className="min-w-0 space-y-5">
          <legend className="sr-only">Course preferences</legend>
          <label className="grid gap-2 text-sm">
            Activity
            <select
              aria-label="Activity"
              className="h-11 w-full rounded-md border border-line bg-surface px-3"
              value={activity}
              onChange={(e) => setActivity(e.target.value as CourseActivity)}
            >
              <option value="Run">Run</option>
              <option value="Walk">Walk</option>
              <option value="Ride">Ride</option>
            </select>
          </label>
          {mode === "generate" ? (
            <>
              <div className="space-y-2">
                <label htmlFor="course-place" className="text-sm">
                  Start near a place or landmark
                </label>
                <div className="flex gap-2">
                  <Input
                    id="course-place"
                    placeholder="e.g. Golden Gate Park, San Francisco"
                    value={query}
                    maxLength={120}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      searchRef.current?.abort();
                      dispatch({ type: "edit" });
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        if (query.trim()) void search();
                      }
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label="Find starting place"
                    disabled={!query.trim() || place.status === "searching"}
                    onClick={() => void search()}
                  >
                    <Search />
                  </Button>
                </div>
                {place.status === "searching" ? (
                  <p role="status" className="text-sm text-ink-secondary">
                    Finding places…
                  </p>
                ) : null}
                {place.status === "error" ? (
                  <p role="alert" className="text-sm">
                    {place.message}
                  </p>
                ) : null}
                {place.status === "choices" ? (
                  <div className="grid gap-1" aria-label="Starting places">
                    {place.places.map((p, i) => (
                      <Button
                        key={`${p.lat}-${p.lng}-${i}`}
                        type="button"
                        variant="outline"
                        className="h-auto min-h-11 justify-start whitespace-normal py-3 text-left"
                        onClick={() => dispatch({ type: "choose", place: p })}
                      >
                        <MapPin />
                        {p.name}
                      </Button>
                    ))}
                  </div>
                ) : null}
                {place.status === "chosen" ? (
                  <p className="flex items-start gap-2 text-sm text-ink-secondary">
                    <MapPin className="mt-0.5 size-4 shrink-0" />
                    {place.place.name}
                  </p>
                ) : null}
              </div>
              <div className="grid grid-cols-[1fr_6rem] gap-3">
                <label className="grid gap-2 text-sm">
                  Target distance
                  <Input
                    type="number"
                    min={unit === "mi" ? 0.63 : 1}
                    max={unit === "mi" ? 124 : 200}
                    step="any"
                    required
                    value={distance}
                    onChange={(e) => setDistance(e.target.value)}
                  />
                </label>
                <label className="grid gap-2 text-sm">
                  Unit
                  <select
                    className="h-11 rounded-md border border-line bg-surface px-3"
                    value={unit}
                    onChange={(e) => setUnit(e.target.value as "km" | "mi")}
                  >
                    <option value="km">km</option>
                    <option value="mi">miles</option>
                  </select>
                </label>
              </div>
              <fieldset className="space-y-2">
                <legend className="mb-2 text-sm">What kind of day?</legend>
                <div className="flex flex-wrap gap-2">
                  {vibes.map((v) => (
                    <Button
                      key={v.value}
                      type="button"
                      variant={
                        preferences.includes(v.value) ? "secondary" : "outline"
                      }
                      aria-pressed={preferences.includes(v.value)}
                      onClick={() =>
                        setPreferences((current) =>
                          current.includes(v.value)
                            ? current.filter((x) => x !== v.value)
                            : [...current, v.value],
                        )
                      }
                    >
                      {v.label}
                    </Button>
                  ))}
                </div>
                <p className="text-xs leading-5 text-ink-secondary">
                  Preferences guide the routing model. They are not verified
                  claims about every path.
                </p>
              </fieldset>
              <Button
                type="submit"
                className="w-full"
                disabled={place.status !== "chosen"}
              >
                <WandSparkles />
                Generate route
              </Button>
              <p className="text-xs leading-5 text-ink-secondary">
                A loop back to your starting area. Actual distance depends on
                the mapped path network.
              </p>
            </>
          ) : (
            <div
              className="grid min-h-52 content-center gap-4 rounded-lg border border-dashed border-line-strong p-6"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (!busy && e.dataTransfer.files[0])
                  onImport(e.dataTransfer.files[0], activity);
              }}
            >
              <Upload className="size-6" aria-hidden="true" />
              <label className="grid gap-3 text-sm">
                Drop a GPX here, or choose a file
                <Input
                  type="file"
                  accept=".gpx,application/gpx+xml"
                  aria-label="Upload GPX"
                  onChange={(e) => {
                    if (e.target.files?.[0])
                      onImport(e.target.files[0], activity);
                    e.target.value = "";
                  }}
                />
              </label>
              <p className="text-xs leading-5 text-ink-secondary">
                Up to 5 MB and 50,000 points. Track sections stay separate. Your
                original coordinates and available elevation are preserved.
              </p>
            </div>
          )}
        </fieldset>
      </form>
    </section>
  );
}
