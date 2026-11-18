import { useEffect, useState } from "react";

import { EXAMPLE_MOMENTS, chooseMoments, momentDataSaving, placementsOf, type CatalogEntry, type MomentsData } from "@/labs/sketch/moment-catalog";
import "@/labs/sketch/moments-catalog.css";

// Her moments, in the lab: every catalog entry with a small silent preview and
// where it stands in the world. Read-only this round: placing and swapping
// need a writer for her private file (see the plan, S31).

const facing = (deg: number) => ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(deg / 45) % 8];

function Preview({ entry }: { entry: CatalogEntry }) {
  const [asked, setAsked] = useState(false);
  if (!entry.clip) return <div className="moments-preview moments-preview-none">No signal</div>;
  if (momentDataSaving() && !asked)
    return (
      <button className="moments-preview moments-preview-none" onClick={() => setAsked(true)} type="button">
        Show preview
      </button>
    );
  return <video aria-hidden="true" autoPlay className="moments-preview" loop muted playsInline preload="metadata" src={entry.clip} />;
}

export function MomentsCatalogPage() {
  const [data, setData] = useState<MomentsData>(EXAMPLE_MOMENTS);
  const [source, setSource] = useState<"example" | "private">("example");
  useEffect(() => {
    fetch("/moments/moments.json", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((loaded) => {
        const chosen = chooseMoments(loaded);
        setData(chosen);
        setSource(chosen === EXAMPLE_MOMENTS ? "example" : "private");
      })
      .catch(() => undefined);
  }, []);
  const ids = new Set(data.catalog.map((entry) => entry.id));
  const empty = data.placements.filter((placement) => !placement.entryId || !ids.has(placement.entryId));
  return (
    <main className="moments-catalog" data-source={source} data-testid="moments-catalog">
      <h1>Moments</h1>
      <p className="moments-note">{source === "private" ? "Your moments, from the private moments folder." : "The example: no private moments folder on this machine."}</p>
      <ul className="moments-list">
        {data.catalog.map((entry) => {
          const places = placementsOf(data, entry.id);
          return (
            <li className="moments-card" data-testid="moments-entry" key={entry.id}>
              <Preview entry={entry} />
              <div className="moments-text">
                <h2>{entry.title}</h2>
                <p className="moments-meta">
                  {entry.kind === "tv-wall" ? "Wall of televisions" : entry.kind} · {entry.public ? "public" : "private"}
                </p>
                {entry.caption ? <p className="moments-caption">{entry.caption}</p> : null}
                <p className="moments-where">
                  {places.length
                    ? places.map((place) => `Placed at ${place.at.lat.toFixed(5)}, ${place.at.lng.toFixed(5)}, facing ${facing(place.facingDeg)}`).join("; ")
                    : "Not placed"}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
      {empty.length ? (
        <section>
          <h2>Places showing nothing</h2>
          <ul className="moments-list">
            {empty.map((place) => (
              <li className="moments-card" key={place.id}>
                <p className="moments-where">
                  {place.at.lat.toFixed(5)}, {place.at.lng.toFixed(5)}: {place.entryId ? `"${place.entryId}" is not in the catalog` : "empty"}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
