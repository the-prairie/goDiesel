import { Save } from "lucide-react";

import { CurationStatus } from "@/components/admin/curation-status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  validateCuration,
  type AdminRouteRecord,
  type CurationDraft,
} from "@/domain/admin-curation";

export function RouteEditor({
  route,
  draft,
  readOnly,
  saving,
  saveMessage,
  onChange,
  onSave,
}: {
  route: AdminRouteRecord;
  draft: CurationDraft;
  readOnly: boolean;
  saving: boolean;
  saveMessage: string | null;
  onChange: (draft: CurationDraft) => void;
  onSave: () => void;
}) {
  const validation = validateCuration(draft);

  return (
    <section aria-label="Route curation editor" className="grid min-w-0 content-start gap-6">
      <header className="grid gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>{route.region}</span>
          <span>{route.type}</span>
          <span>{route.distanceKm.toFixed(1)} km</span>
          <span>{route.date || "Date unknown"}</span>
        </div>
        <h2 className="text-xl font-semibold">{route.name}</h2>
      </header>

      <CurationStatus route={route} validation={validation} />

      <fieldset disabled={readOnly || saving} className="grid gap-5 disabled:opacity-70">
        <legend className="sr-only">Experiential route metadata</legend>
        <TextAreaField
          label="Vibe"
          value={draft.vibe}
          rows={3}
          placeholder="What will this route feel like?"
          onChange={(vibe) => onChange({ ...draft, vibe })}
        />
        <TextAreaField
          label="Ideal use"
          value={draft.idealUse}
          rows={2}
          placeholder="The kind of day this route suits"
          onChange={(idealUse) => onChange({ ...draft, idealUse })}
        />

        <div className="grid gap-5 sm:grid-cols-2">
          <TextField
            label="Difficulty"
            value={draft.difficulty}
            placeholder="Easy, demanding, epic..."
            onChange={(difficulty) => onChange({ ...draft, difficulty })}
          />
          <label className="grid gap-1.5 text-sm font-medium">
            Review status
            <select
              value={draft.reviewStatus}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onChange={(event) =>
                onChange({
                  ...draft,
                  reviewStatus: event.target.value as CurationDraft["reviewStatus"],
                })
              }
            >
              <option value="draft">Draft</option>
              <option value="reviewed">Reviewed</option>
              <option value="published">Published</option>
            </select>
          </label>
        </div>

        <ListField
          label="Terrain"
          value={draft.terrain}
          placeholder="One surface per line"
          onChange={(terrain) => onChange({ ...draft, terrain })}
        />
        <ListField
          label="Highlights"
          value={draft.highlights}
          placeholder="One memorable feature per line"
          onChange={(highlights) => onChange({ ...draft, highlights })}
        />
        <ListField
          label="Caveats"
          value={draft.caveats}
          placeholder="One practical warning per line"
          onChange={(caveats) => onChange({ ...draft, caveats })}
        />
        <TextAreaField
          label="Seasonality"
          value={draft.seasonality}
          rows={2}
          placeholder="Weather, access, or seasonal guidance"
          onChange={(seasonality) => onChange({ ...draft, seasonality })}
        />
        <TextAreaField
          label="Editorial note"
          value={draft.editorialNote}
          rows={3}
          placeholder="Why this route belongs in the atlas"
          onChange={(editorialNote) => onChange({ ...draft, editorialNote })}
        />
      </fieldset>

      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-5">
        {!readOnly ? (
          <Button
            type="button"
            disabled={!validation.canSave || saving}
            onClick={onSave}
          >
            <Save aria-hidden="true" />
            {saving ? "Saving and rebuilding..." : "Save and regenerate"}
          </Button>
        ) : null}
        {saveMessage ? <p role="status" className="text-sm text-muted-foreground">{saveMessage}</p> : null}
      </div>
    </section>
  );
}

function TextField({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-1.5 text-sm font-medium">
      {label}
      <Input
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function TextAreaField({
  label,
  value,
  rows,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  rows: number;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-1.5 text-sm font-medium">
      {label}
      <textarea
        value={value}
        rows={rows}
        placeholder={placeholder}
        className="min-w-0 resize-y rounded-md border border-input bg-background px-3 py-2 text-sm leading-6 outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function ListField({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string[];
  placeholder: string;
  onChange: (value: string[]) => void;
}) {
  return (
    <TextAreaField
      label={label}
      value={value.join("\n")}
      rows={3}
      placeholder={placeholder}
      onChange={(next) =>
        onChange(
          next
            .split("\n")
            .map((item) => item.trim())
            .filter(Boolean),
        )
      }
    />
  );
}
