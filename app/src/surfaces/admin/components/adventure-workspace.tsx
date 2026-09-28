import { CheckCircle2, CircleAlert, CircleDashed, CircleHelp, Minus, OctagonX, Plus, RotateCcw, Save } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import {
  adventureMediaUrl,
  adventureWriterAvailable,
  loadAdventureById,
  loadAdventureIndex,
  saveAdventure,
  savePublicationPlan,
} from "@/data/adventure-repository";
import { loadRouteDetail } from "@/data/route-repository";
import {
  confirmAnchor,
  haversineM,
  moveAnchor,
  placeAdventureOnRoute,
  type Adventure,
  type AdventureAnchor,
  type AdventureIndex,
} from "@/domain/adventure";
import type { QuestRoute } from "@/domain/route";
import { routeDetailPath } from "@/app/route-paths";
import {
  adventureReadiness,
  type MediaCheck,
  type ReadinessState,
} from "@/surfaces/admin/adventure-readiness";
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";

const NUDGE_M = 25;

async function sha256(url: string) {
  const bytes = await (await fetch(url)).arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return { hex: [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join(""), bytes: bytes.byteLength };
}

/**
 * The owner's adventure workspace. Import happens once, from a prepared pack,
 * on the command line; here the owner checks each chapter against the
 * recording, adjusts wording, placement and footage, and prepares, but never
 * performs, a publication.
 */
export function AdventureWorkspace() {
  const [index, setIndex] = useState<AdventureIndex | null | undefined>(undefined);
  const [writer, setWriter] = useState(false);
  const [selectedId, setSelectedId] = useState<string>();
  const [saved, setSaved] = useState<Adventure>();
  const [draft, setDraft] = useState<Adventure>();
  const [routes, setRoutes] = useState<Record<string, QuestRoute | undefined>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [media, setMedia] = useState<MediaCheck[]>();

  useEffect(() => {
    let active = true;
    void Promise.all([loadAdventureIndex(), adventureWriterAvailable()]).then(([loaded, available]) => {
      if (!active) return;
      setIndex(loaded ?? null);
      setWriter(available);
      setSelectedId(loaded?.adventures[0]?.id);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    let active = true;
    setMedia(undefined);
    setMessage(null);
    void loadAdventureById(selectedId, true).then(async (adventure) => {
      if (!active || !adventure) return;
      setSaved(adventure);
      setDraft(structuredClone(adventure));
      const loaded = await Promise.all(adventure.legs.map(async (leg) => [leg.slug, await loadRouteDetail(leg.slug)] as const));
      if (!active) return;
      setRoutes(Object.fromEntries(loaded.map(([slug, result]) => [slug, result.status === "ready" ? result.route : undefined])));
    });
    return () => {
      active = false;
    };
  }, [selectedId]);

  const placements = useMemo(
    () => (draft ? Object.values(routes).flatMap((route) => (route ? [placeAdventureOnRoute(draft, route)!] : [])) : []),
    [draft, routes],
  );
  const checks = useMemo(() => (draft ? adventureReadiness(draft, placements, routes, media) : []), [draft, placements, routes, media]);
  const dirty = Boolean(draft && saved && JSON.stringify(draft) !== JSON.stringify(saved));

  const updateAnchor = useCallback((kind: "chapters" | "scenes", id: string, anchor: AdventureAnchor) => {
    setDraft((current) => current && {
      ...current,
      [kind]: current[kind].map((item) => (item.id === id ? { ...item, anchor } : item)),
    });
  }, []);

  if (index === undefined) {
    return <p role="status" className="text-caption text-ink-secondary">Looking for local adventures…</p>;
  }
  if (index === null || !index.adventures.length) {
    return (
      <p className="text-caption text-ink-secondary">
        No adventures in the local store. Import a prepared pack with{" "}
        <code className="font-mono text-ink">npm run import:adventure -- &lt;pack-directory&gt;</code>.
      </p>
    );
  }

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    setMessage(null);
    try {
      await saveAdventure(draft);
      setSaved(structuredClone(draft));
      setMessage("Saved to the local adventure store.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  };

  const checkMedia = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      setMedia(await Promise.all(draft.footage.map(async (clip) => {
        const result = await sha256(adventureMediaUrl(draft, clip.src)).catch(() => ({ hex: "", bytes: 0 }));
        return { id: clip.id, matches: result.hex === clip.sha256, bytes: result.bytes };
      })));
    } finally {
      setBusy(false);
    }
  };

  const recordPlan = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      await savePublicationPlan(draft.id, {
        adventureId: draft.id,
        packSha256: draft.source.sha256,
        preparedAt: new Date().toISOString(),
        audience: null,
        checks,
        media: media ?? null,
        note: "Prepared locally. Nothing has been published; the audience is the owner's decision.",
      });
      setMessage("Publication plan recorded beside the adventure. Nothing was published.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The plan could not be recorded.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-4" data-testid="adventure-workspace">
      <div role="status" className="border border-line bg-surface-muted px-4 py-3 text-caption text-ink-secondary">
        {writer
          ? "Local adventure writer connected. Saving validates the adventure and refuses changes to its recordings, media or credits."
          : "Read-only. The adventure writer runs only with the local dev server."}
      </div>

      {index.adventures.length > 1 ? (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Local adventures">
          {index.adventures.map((item) => (
            <Button key={item.id} type="button" variant={item.id === selectedId ? "default" : "outline"} className="h-11" onClick={() => setSelectedId(item.id)}>
              {item.title}
            </Button>
          ))}
        </div>
      ) : null}

      {draft && saved ? (
        <article className="grid gap-5 border border-line bg-surface p-4" aria-labelledby="adventure-workspace-title">
          <header className="grid gap-1">
            <h3 id="adventure-workspace-title" className="font-editorial text-2xl text-ink">{draft.title}</h3>
            <p className="text-caption text-ink-secondary">
              From prepared pack <span className="font-medium text-ink">{draft.source.packId}</span> ·{" "}
              <span className="tabular-nums">{draft.source.sha256.slice(0, 12)}</span> · {draft.legs.length} recording{draft.legs.length === 1 ? "" : "s"}:{" "}
              {draft.legs.map((leg, position) => (
                <span key={leg.slug}>
                  {position ? ", " : ""}
                  <Link className="text-ink underline underline-offset-2" to={routeDetailPath(leg.slug)}>{leg.label}</Link>
                </span>
              ))}
            </p>
          </header>

          <section aria-label="Chapters" className="grid gap-2">
            <h4 className="text-control font-semibold text-ink">Chapters</h4>
            {draft.chapters.map((chapter) => {
              const route = routes[chapter.anchor.slug];
              const leg = draft.legs.find((item) => item.slug === chapter.anchor.slug)!;
              return (
                <div key={chapter.id} className="grid gap-3 border-t border-line pt-3 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]" data-chapter-id={chapter.id}>
                  <div className="grid gap-2">
                    <Input
                      aria-label={`Title of chapter ${chapter.id}`}
                      value={chapter.title}
                      className="h-11"
                      onChange={(event) => setDraft({ ...draft, chapters: draft.chapters.map((item) => (item.id === chapter.id ? { ...item, title: event.target.value } : item)) })}
                    />
                    <textarea
                      aria-label={`Note for chapter ${chapter.id}`}
                      value={chapter.note ?? ""}
                      rows={2}
                      className="min-h-11 rounded-md border border-line bg-background px-3 py-2 text-sm text-ink"
                      onChange={(event) => setDraft({ ...draft, chapters: draft.chapters.map((item) => (item.id === chapter.id ? { ...item, note: event.target.value || undefined } : item)) })}
                    />
                    <label className="grid gap-1 text-caption text-ink-secondary">
                      Footage shown with this chapter
                      <select
                        className="h-11 rounded-md border border-line bg-background px-2 text-sm text-ink"
                        value={chapter.footageId ?? ""}
                        onChange={(event) => setDraft({ ...draft, chapters: draft.chapters.map((item) => (item.id === chapter.id ? { ...item, footageId: event.target.value || undefined } : item)) })}
                      >
                        <option value="">No footage</option>
                        {draft.footage.map((clip) => <option key={clip.id} value={clip.id}>{clip.title}</option>)}
                      </select>
                    </label>
                  </div>
                  <AnchorEditor
                    label={`chapter ${chapter.id}`}
                    legLabel={leg.label}
                    anchor={chapter.anchor}
                    saved={saved.chapters.find((item) => item.id === chapter.id)?.anchor}
                    route={route}
                    onChange={(anchor) => updateAnchor("chapters", chapter.id, anchor)}
                    poster={chapter.footageId ? draft.footage.find((clip) => clip.id === chapter.footageId)?.poster : undefined}
                    adventure={draft}
                  />
                </div>
              );
            })}
          </section>

          {draft.scenes.length ? (
            <section aria-label="Captured scenes" className="grid gap-2">
              <h4 className="text-control font-semibold text-ink">Captured scenes</h4>
              {draft.scenes.map((scene) => (
                <div key={scene.id} className="grid gap-3 border-t border-line pt-3 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
                  <div className="text-sm text-ink">
                    <p className="font-medium">{scene.title}</p>
                    <p className="text-caption text-ink-secondary">
                      By <a className="underline underline-offset-2" href={scene.attribution.url} target="_blank" rel="noreferrer">{scene.attribution.author}</a> on Sketchfab · {scene.tour.shots.length} authored viewpoints
                    </p>
                  </div>
                  <AnchorEditor
                    label={`scene ${scene.id}`}
                    legLabel={draft.legs.find((item) => item.slug === scene.anchor.slug)!.label}
                    anchor={scene.anchor}
                    saved={saved.scenes.find((item) => item.id === scene.id)?.anchor}
                    route={routes[scene.anchor.slug]}
                    onChange={(anchor) => updateAnchor("scenes", scene.id, anchor)}
                    adventure={draft}
                  />
                </div>
              ))}
            </section>
          ) : null}

          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
            <Button type="button" className="h-11" disabled={!writer || !dirty || busy} onClick={() => void save()}>
              <Save aria-hidden="true" /> Save adventure
            </Button>
            <Button type="button" variant="outline" className="h-11" disabled={!dirty || busy} onClick={() => setDraft(structuredClone(saved))}>
              <RotateCcw aria-hidden="true" /> Revert
            </Button>
            {message ? <p role="status" className="text-caption text-ink-secondary">{message}</p> : null}
          </div>

          <section aria-labelledby="adventure-readiness-title" className="grid gap-3 border-t border-line pt-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 id="adventure-readiness-title" className="text-control font-semibold text-ink">Publication readiness</h4>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" className="h-11" disabled={busy} onClick={() => void checkMedia()}>Check media digests</Button>
                <Button type="button" variant="outline" className="h-11" disabled={!writer || busy || dirty} onClick={() => void recordPlan()}>Record publication plan</Button>
              </div>
            </div>
            <ul className="grid gap-2" data-testid="adventure-readiness">
              {checks.map((check) => (
                <li key={check.id} data-check={check.id} data-state={check.state} className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 text-sm">
                  <ReadinessIcon state={check.state} />
                  <span className="font-medium text-ink">{check.label}</span>
                  <span />
                  <span className="text-caption text-ink-secondary">{check.detail}</span>
                </li>
              ))}
            </ul>
          </section>
        </article>
      ) : (
        <p role="status" className="text-caption text-ink-secondary">Opening the adventure…</p>
      )}
    </div>
  );
}

function ReadinessIcon({ state }: { state: ReadinessState }) {
  const label = { pass: "Ready", attention: "Needs attention", blocked: "Blocked", unchecked: "Not checked", decision: "Owner decision" }[state];
  const Icon = { pass: CheckCircle2, attention: CircleAlert, blocked: OctagonX, unchecked: CircleDashed, decision: CircleHelp }[state];
  const tone = { pass: "text-forest", attention: "text-warning", blocked: "text-destructive", unchecked: "text-ink-muted", decision: "text-ink" }[state];
  return <Icon aria-label={label} role="img" className={`mt-0.5 size-4 ${tone}`} />;
}

/** One anchor on its recording: distance, nudges and a live confirmation. */
function AnchorEditor({
  label,
  legLabel,
  anchor,
  saved,
  route,
  poster,
  adventure,
  onChange,
}: {
  label: string;
  legLabel: string;
  anchor: AdventureAnchor;
  saved?: AdventureAnchor;
  route?: QuestRoute;
  poster?: string;
  adventure: Adventure;
  onChange: (anchor: AdventureAnchor) => void;
}) {
  const [text, setText] = useState((anchor.atDistanceM / 1_000).toFixed(3));
  useEffect(() => setText((anchor.atDistanceM / 1_000).toFixed(3)), [anchor.atDistanceM]);
  const reason = route ? confirmAnchor(route, anchor) : "The recording could not be loaded.";
  const moved = saved && saved.atDistanceM !== anchor.atDistanceM;
  const offset = saved ? Math.round(haversineM(saved.source, anchor.source)) : 0;
  const move = (distanceM: number) => route && onChange(moveAnchor(route, anchor, distanceM));

  return (
    <div className="grid content-start gap-2 text-caption text-ink-secondary">
      <p>On <span className="text-ink">{legLabel}</span></p>
      <div className="flex items-center gap-2">
        <Button type="button" size="icon" variant="outline" className="size-11" aria-label={`Move ${label} back ${NUDGE_M} m`} disabled={!route} onClick={() => move(anchor.atDistanceM - NUDGE_M)}>
          <Minus aria-hidden="true" />
        </Button>
        <label className="grid gap-0.5">
          <span className="sr-only">Distance of {label} in kilometres</span>
          <Input
            inputMode="decimal"
            className="h-11 w-28 tabular-nums"
            value={text}
            disabled={!route}
            onChange={(event) => setText(event.target.value)}
            onBlur={() => {
              const value = Number(text);
              if (Number.isFinite(value)) move(value * 1_000);
              else setText((anchor.atDistanceM / 1_000).toFixed(3));
            }}
            onKeyDown={(event) => { if (event.key === "Enter") (event.target as HTMLInputElement).blur(); }}
          />
        </label>
        <span>km</span>
        <Button type="button" size="icon" variant="outline" className="size-11" aria-label={`Move ${label} forward ${NUDGE_M} m`} disabled={!route} onClick={() => move(anchor.atDistanceM + NUDGE_M)}>
          <Plus aria-hidden="true" />
        </Button>
        {poster ? <img src={adventureMediaUrl(adventure, poster)} alt="" className="ml-auto h-14 w-8 rounded-sm object-cover" /> : null}
      </div>
      <p data-anchor-state={reason ? "withheld" : "confirmed"} className={reason ? "text-destructive" : undefined}>
        {reason ?? (moved ? `On the recording · moved ${offset} m by the owner` : "On the recording at its prepared place")}
      </p>
    </div>
  );
}
