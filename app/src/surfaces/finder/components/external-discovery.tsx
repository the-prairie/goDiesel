import { discoveryPreference } from "@/domain/search/external-ranking";
import { Link, useSearchParams } from "react-router-dom";
import { saveExternalPlan, useExternalPlans } from "@/data/external-plan-store";
import { useExternalRanking } from "@/data/search/use-external-ranking";
import { ExternalRouteEvidence } from "@/ui/external-route-evidence";
import { useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, MapPin } from "lucide-react";
import type { FinderIntent } from "@/domain/planning";
import type { DiscoveryPlace, ExternalRoute } from "@/domain/search/external";
import { matchesExternalRoute } from "@/domain/search/external-filters";
import { routes } from "@/data/routes";
import { Input } from "@/ui/input";
import { Button } from "@/ui/button";
import { FinderRouteMap } from "@/ui/planning-route-map";

export function ExternalDiscovery({ intent }: { intent: FinderIntent }) {
  const plans = useExternalPlans();
  const [params, setParams] = useSearchParams();
  const [destination, setDestination] = useState(params.get("near") ?? intent.place);
  const [view, setView] = useState<"list" | "map">("list");
  const [saveMessage, setSaveMessage] = useState<{
    id: string;
    text: string;
  }>();
  const [places, setPlaces] = useState<DiscoveryPlace[]>([]);
  const [place, setPlace] = useState<DiscoveryPlace>();
  const [results, setResults] = useState<ExternalRoute[]>([]);
  const [selected, setSelected] = useState<string>();
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">(
    "idle",
  );
  const [message, setMessage] = useState("");
  const requestRef = useRef<AbortController | null>(null);
  useEffect(() => () => requestRef.current?.abort(), []);
  async function discover(selectedPlace?: DiscoveryPlace) {
    if (!selectedPlace && !destination.trim()) return;
    const nextParams = new URLSearchParams(params);
    nextParams.set("near", destination.trim());
    setParams(nextParams, { replace: true });
    setView("list");
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setStatus("loading");
    setMessage("Looking for mapped routes…");
    setResults([]);
    setPlaces([]);
    try {
      const known = routes.find(
        (r) =>
          r.region.toLowerCase() === destination.trim().toLowerCase() ||
          r.region.split(",")[0].toLowerCase() === destination.trim().toLowerCase(),
      );
      let location =
        selectedPlace ??
        (known
          ? { name: known.region, lat: known.centerLat, lng: known.centerLng }
          : undefined);
      if (!location) {
        const data = await api(
          new URLSearchParams({ place: destination.trim() }),
          controller.signal,
        );
        if (controller.signal.aborted) return;
        if (!data.places?.length) {
          setStatus("ready");
          setMessage("No places found. Try a town or region name.");
          return;
        }
        // Let the user disambiguate; never silently search a different same-named city.
        setPlaces(
          (data.places as DiscoveryPlace[]).filter(
            (p, i, all) =>
              all.findIndex((other) => other.name === p.name) === i,
          ),
        );
        setStatus("idle");
        setMessage("Choose the place you mean.");
        return;
      }
      setPlace(location);
      const data = await api(
        new URLSearchParams({
          lat: String(location.lat),
          lng: String(location.lng),
          activity: intent.activity,
        }),
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setResults(data.routes ?? []);
      setSelected(undefined);
      setStatus("ready");
      setMessage("");
    } catch (error) {
      if (controller.signal.aborted) return;
      setStatus("error");
      setMessage(
        error instanceof Error
          ? error.message
          : "Discovery unavailable. Please try again.",
      );
    }
  }
  const candidates = useMemo(() => results.filter(r => matchesExternalRoute(r,intent)), [results,intent]);
  const preference = discoveryPreference(intent);
  const { ranked, mode } = useExternalRanking(candidates, preference);
  const active = candidates.find((r) => r.id === selected) ?? ranked[0]?.route;
  return (
    <section
      aria-label="New route discovery"
      className="flex min-h-0 flex-1 flex-col overflow-y-auto"
    >
      <div className="border-b border-line p-4 sm:px-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl text-ink">
              {results.length
                ? `Near ${place?.name.split(",")[0]}`
                : "Beyond your collection"}
            </h2>
            {!results.length ? (
              <p className="mt-1 max-w-2xl text-sm text-ink-secondary">
                Explore named walking and cycling routes within 18 km of a
                place.
              </p>
            ) : (
              <p className="mt-1 text-xs text-ink-muted">
                Mapped routes · Check current access before heading out
              </p>
            )}
          </div>
        </div>
        <form className="mt-4 flex items-end gap-2" onSubmit={e => { e.preventDefault(); discover(); }}>
          <label className="grid min-w-0 flex-1 gap-1 text-sm">Near where?
            <Input required value={destination} placeholder="Town or region" onChange={e => { setDestination(e.target.value); setPlaces([]); }} />
          </label>
          <Button type="submit" disabled={!destination.trim() || status === "loading"}>{status === "loading" ? "Searching…" : status === "error" ? "Try again" : results.length ? "Search again" : "Search new routes"}</Button>
        </form>
        {preference ? <p className="mt-2 text-sm text-ink-secondary">Looking for: {preference}.{destination.trim() ? " Matching themes are ranked first." : " Choose a location to explore nearby routes."}</p> : null}
        {intent.maxElevationM != null || intent.terrain !== "any" ? (
          <p className="mt-2 text-xs text-ink-muted">
            Only routes with documented climb or surface can match your filters.
          </p>
        ) : null}
        {message ? (
          <p role="status" className="mt-3 text-sm text-ink">
            {message}
          </p>
        ) : null}
        {places.length ? (
          <div className="mt-3 grid gap-2">
            {places.map((p) => (
              <Button
                key={`${p.lat},${p.lng}`}
                variant="outline"
                className="h-auto justify-start whitespace-normal py-3 text-left"
                onClick={() => discover(p)}
              >
                <MapPin className="shrink-0" />
                {p.name}
              </Button>
            ))}
          </div>
        ) : null}
      </div>
      {status === "ready" && !candidates.length ? (
        <div role="status" className="p-6">
          <h3 className="text-xl">No mapped routes match these filters</h3>
          <p className="mt-2 text-sm text-ink-secondary">
            Try a wider distance or remove climb and terrain limits. This source
            does not cover every route.
          </p>
        </div>
      ) : null}
      {active ? <div role="group" aria-label="Discovery results view" className="flex shrink-0 justify-end gap-1 border-b border-line px-4 py-2 lg:hidden">
        <Button size="sm" variant={view === "list" ? "secondary" : "ghost"} aria-pressed={view === "list"} onClick={() => setView("list")}>List</Button>
        <Button size="sm" variant={view === "map" ? "secondary" : "ghost"} aria-pressed={view === "map"} onClick={() => setView("map")}>Map</Button>
      </div> : null}
      {active ? (
        <div className="grid min-h-[24rem] flex-1 lg:min-h-0 lg:grid-cols-[minmax(22rem,0.9fr)_minmax(0,1.4fr)]">
          <div className={`${view === "map" ? "flex" : "hidden"} min-h-0 flex-col lg:order-2 lg:flex`}>
            <p aria-label="Selected map route" className="border-b border-line px-4 py-3 text-sm">Showing: {active.name} · {active.distanceKm.toFixed(1)} km</p>
            <div className="min-h-0 flex-1"><FinderRouteMap lines={active.lines} selectedSlug={active.id} /></div>
          </div>
          <div
            aria-label="Discovered routes"
            className={`${view === "list" ? "block" : "hidden"} min-h-0 overflow-y-auto border-line p-4 lg:block lg:border-r`}
          >
            <p className="mb-3 text-sm text-ink-muted">
              {candidates.length} mapped routes · Not recorded by you
            </p>
            {mode.includes("unavailable") ? <p role="status" className="mb-3 text-xs text-ink-secondary">Related matches may be limited right now.</p> : null}
            {ranked.map(({ route: r, reason }) => (
              <article
                key={r.id}
                aria-label={r.name}
                className={`mb-3 rounded-xl border p-4 ${r.id === active.id ? "border-ink/70 bg-white/5" : "border-line"}`}
              >
                <p className="text-xs text-ink-muted">
                  OpenStreetMap ·{" "}
                  {r.activity === "Run" ? "Walking / running" : "Cycling"}
                </p>
                <h3 className="mt-1 text-lg font-medium">{r.name}</h3>
                <p className="mt-2 text-sm text-ink-secondary">
                  {r.distanceKm.toFixed(1)} km{" "}
                  {r.distanceKind === "mapped"
                    ? "of mapped paths"
                    : "source distance"}{" "}
                  ·{" "}
                  {r.ascentM == null ? "Climb unknown" : `${r.ascentM} m climb`}
                </p>
                {r.description ? (
                  <p className="mt-2 text-sm text-ink-secondary">
                    {r.description}
                  </p>
                ) : null}
                {reason ? (
                  <p className="mt-2 text-xs text-ink-muted">{reason}</p>
                ) : null}
                <ExternalRouteEvidence route={r} />
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <Button
                    size="sm"
                    disabled={plans.some((p) => p.route.id === r.id)}
                    onClick={() => {
                      try {
                        saveExternalPlan(
                          r,
                          place?.name ?? destination,
                          { ...intent, place: destination },
                        );
                        setSaveMessage({
                          id: r.id,
                          text: "Saved on this device.",
                        });
                      } catch {
                        setSaveMessage({
                          id: r.id,
                          text: "Could not save. Device storage is full or unavailable. Try again after freeing space.",
                        });
                      }
                    }}
                  >
                    {plans.some((p) => p.route.id === r.id)
                      ? "Saved to plans"
                      : "Save as planned"}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => { setSelected(r.id); setView("map"); }}
                    aria-pressed={r.id === active.id}
                  >
                    {r.id === active.id ? "On map" : "Preview route"}
                  </Button>
                  <a
                    className="inline-flex min-h-11 items-center gap-2 text-sm underline underline-offset-4"
                    href={r.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View source <ExternalLink className="size-3" />
                  </a>
                </div>
                {saveMessage?.id === r.id ? (
                  <p role="status" className="mt-2 text-sm">
                    {saveMessage.text}
                  </p>
                ) : null}
                {plans.some((p) => p.route.id === r.id) ? (
                  <Link
                    className="mt-2 inline-flex min-h-11 items-center text-sm underline"
                    to="/routes?lifecycle=planned"
                  >
                    View planned routes
                  </Link>
                ) : null}
              </article>
            ))}
          </div>
        </div>
      ) : null}
      <p className="mt-auto border-t border-line px-4 py-3 text-xs text-ink-muted">
        ©{" "}
        <a
          href="https://www.openstreetmap.org/copyright"
          target="_blank"
          rel="noreferrer"
          className="underline"
        >
          OpenStreetMap contributors
        </a>{" "}
        · Place search by Photon. Route sections are shown as mapped; they may
        not form a continuous outing.
      </p>
    </section>
  );
}
async function api(params: URLSearchParams, signal: AbortSignal) {
  const response = await fetch(`/api/discovery?${params}`, { signal });
  if (!response.headers.get("content-type")?.includes("application/json"))
    throw Error(
      "New-route discovery is not available on this host. Your collection is still searchable.",
    );
  const data = await response.json();
  if (!response.ok)
    throw Error(data.error ?? "Discovery unavailable. Try again.");
  return data;
}
