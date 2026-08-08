import { Search } from "lucide-react";
import type { FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { FinderIntent } from "@/surfaces/finder/planning";

export function FinderForm({
  intent,
  onChange,
  onSubmit,
}: {
  intent: FinderIntent;
  onChange: (intent: FinderIntent) => void;
  onSubmit: () => void;
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit();
  }

  return (
    <form
      aria-label="Find a route"
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(12rem,1.35fr)_minmax(8rem,0.7fr)_minmax(7rem,0.65fr)_minmax(8rem,0.7fr)_minmax(12rem,1.2fr)_auto] lg:items-end"
      onSubmit={submit}
    >
      <Field label="Place" className="sm:col-span-2 lg:col-span-1">
        <Input
          required
          value={intent.place}
          placeholder="Kyoto, Banff, Victoria..."
          onChange={(event) => onChange({ ...intent, place: event.target.value })}
        />
      </Field>

      <SelectField
        label="Activity"
        value={intent.activity}
        options={[
          ["Run", "Run"],
          ["Ride", "Ride"],
        ]}
        onChange={(value) =>
          onChange({ ...intent, activity: value as FinderIntent["activity"] })
        }
      />
      <Field label="Distance" suffix="km">
        <Input
          required
          type="number"
          min="1"
          max="500"
          step="0.5"
          value={intent.distanceKm || ""}
          onChange={(event) =>
            onChange({ ...intent, distanceKm: Number(event.target.value) })
          }
        />
      </Field>

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

      <Field label="Vibe" className="sm:col-span-2 lg:col-span-1">
        <Input
          value={intent.vibe}
          placeholder="Exploratory climbing, coastal, touring..."
          onChange={(event) => onChange({ ...intent, vibe: event.target.value })}
        />
      </Field>

      <Button type="submit" className="w-full sm:col-span-2 lg:col-span-1 lg:w-fit">
        <Search aria-hidden="true" />
        Find curated routes
      </Button>
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
    <label className={`grid min-w-0 gap-1.5 text-control font-medium ${className ?? ""}`}>
      <span className="flex items-center justify-between gap-2">
        {label}
        {suffix ? <span className="text-xs text-muted-foreground">{suffix}</span> : null}
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
