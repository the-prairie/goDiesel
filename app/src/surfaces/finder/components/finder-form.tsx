import { Search, SlidersHorizontal } from "lucide-react";
import type { FormEvent } from "react";

import { Button } from "@/ui/button";
import { Input } from "@/ui/input";
import type { FinderIntent } from "@/domain/planning";

export function FinderForm({
  intent,
  onChange,
  onSubmit,
  expanded,
  onToggleFilters,
  preferencesChanged = false,
  submitted = false,
  allowAnyActivity = false,
}: {
  intent: FinderIntent;
  onChange: (intent: FinderIntent) => void;
  onSubmit: () => void;
  expanded: boolean;
  preferencesChanged?: boolean;
  submitted?: boolean;
  allowAnyActivity?: boolean;
  onToggleFilters: () => void;
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit();
  }

  return (
    <form aria-label="Find a route" className="grid gap-3" onSubmit={submit}>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Describe your next route" className="min-w-0 flex-1 [&>span]:sr-only">
          <Input
            value={intent.query ?? intent.place}
            maxLength={300}
            placeholder="A coastal run near Victoria, 10–15 km…"
            onChange={(event) =>
              onChange({ ...intent, query: event.target.value })
            }
          />
        </Field>

        <Button
          type="submit"
          aria-label="Find routes"
          className="shrink-0"
        >
          <Search aria-hidden="true" />
          <span className="hidden sm:inline">Find routes</span>
        </Button>
        <Button
          type="button"
          variant="outline"
          aria-label={expanded ? "Hide filters" : "Edit filters"}
          aria-expanded={expanded}
          aria-controls="finder-options"
          onClick={onToggleFilters}
        >
          <SlidersHorizontal aria-hidden="true" />
          <span className="hidden sm:inline">{expanded ? "Hide filters" : "Edit filters"}</span>
        </Button>
      </div>
      {!submitted || preferencesChanged ? <p className="text-sm text-ink-secondary" aria-label="Search preferences">{preferencesChanged ? "Not applied yet: " : "Search for: "}{intent.activity === "Any" ? "All activities" : intent.activity} · {intent.minDistanceKm != null || intent.maxDistanceKm != null ? `${intent.minDistanceKm ?? 0}–${intent.maxDistanceKm ?? "∞"} km` : intent.distanceKm ? `around ${intent.distanceKm} km` : "any distance"}{intent.terrain !== "any" ? ` · ${intent.terrain}` : ""}</p> : null}
      <div
        id="finder-options"
        className={`${expanded ? "grid" : "hidden"} grid-cols-2 gap-3 border-t border-line pt-3 lg:grid-cols-4`}
      >
        <Field label="Place"><Input value={intent.place} placeholder="Anywhere" onChange={e => onChange({...intent, place:e.target.value})} /></Field>
        <SelectField
          label="Activity"
          value={intent.activity}
          options={[
            ...(allowAnyActivity ? [["Any", "All activities"]] as const : []),
            ["Run", "Run"],
            ["Ride", "Ride"],
          ]}
          onChange={(value) =>
            onChange({ ...intent, activity: value as FinderIntent["activity"] })
          }
        />
        {intent.minDistanceKm != null || intent.maxDistanceKm != null ? <div className="col-span-2 grid grid-cols-2 gap-3">
          <Field label="Distance from" suffix="km"><Input id="finder-distance" type="number" min="0" max="500" step="0.1" value={intent.minDistanceKm ?? ""} placeholder="Any" onChange={e => onChange({...intent, distanceKm:0, minDistanceKm:e.target.value === "" ? undefined : Number(e.target.value)})}/></Field>
          <Field label="Distance to" suffix="km"><Input type="number" min={intent.minDistanceKm ?? 0} max="500" step="0.1" value={intent.maxDistanceKm ?? ""} placeholder="Any" onChange={e => onChange({...intent, distanceKm:0, maxDistanceKm:e.target.value === "" ? undefined : Number(e.target.value)})}/></Field>
        </div> : (
        <Field label="Distance" suffix="km">
          <Input
            id="finder-distance"
            type="number"
            min="0"
            max="500"
            step="0.5"
            value={intent.distanceKm || ""}
            placeholder="Any distance"
            onChange={(event) =>
              onChange({ ...intent, distanceKm: Number(event.target.value), minDistanceKm: undefined, maxDistanceKm: undefined })
            }
          />
        </Field>
        )}

        <SelectField
          label="Terrain"
          value={intent.terrain}
          options={[
            ["any", "Any terrain"],
            ["road", "Road"],
            ["trail", "Trail"],
            ["mixed", "Mixed"],
            ["mountain", "Mountain"],
          ]}
          onChange={(value) =>
            onChange({ ...intent, terrain: value as FinderIntent["terrain"] })
          }
        />

        <Field label="Maximum climb" suffix="m"><Input type="number" min="0" max="20000" value={intent.maxElevationM ?? ""} placeholder="Any" onChange={e => onChange({...intent, maxElevationM:e.target.value === "" ? undefined : Number(e.target.value)})} /></Field>
        <Field label="Vibe" className="col-span-2 lg:col-span-1">
          <Input
            value={intent.vibe}
            placeholder="Exploratory climbing, coastal, touring..."
            onChange={(event) =>
              onChange({ ...intent, vibe: event.target.value })
            }
          />
        </Field>
      </div>
    </form>
  );
}

function Field({
  label,
  suffix,
  className,
  children,
}: {
  label: string;
  suffix?: string;
  className?: string;
  children: React.ReactElement;
}) {
  return (
    <label
      className={`grid min-w-0 gap-1.5 text-control font-medium ${className ?? ""}`}
    >
      <span className="flex items-center justify-between gap-2">
        {label}
        {suffix ? (
          <span className="text-xs text-muted-foreground">{suffix}</span>
        ) : null}
      </span>
      {children}
    </label>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly (readonly [string, string])[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid min-w-0 gap-1.5 text-control font-medium">
      {label}
      <select
        value={value}
        className="h-11 min-w-0 rounded-sm border border-input bg-surface-raised px-3 text-control text-ink outline-none transition-colors hover:border-forest/50 focus-visible:ring-2 focus-visible:ring-ring"
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </label>
  );
}
