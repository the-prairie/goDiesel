import { AlertTriangle, ArrowLeft, Check, CircleAlert, Film, Info, LoaderCircle, Map, Play, RefreshCcw, Rocket, Square } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";

import {
  cancelStudioJob,
  compileStudioRoute,
  loadStudioJob,
  promoteStudioRoute,
  renderStudioRoute,
  retryStudioJob,
  saveStudioMetadata,
  selectStudioGeometry,
  studioArtifactUrl,
  type StudioCandidate,
  type StudioJob,
  type StudioMetadata,
} from "@/data/studio-repository";
import { studioExperienceLanguage } from "@/surfaces/admin/studio-language";
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";

const initialMetadata: StudioMetadata = {
  name: "", activityType: "Run", completedByOwner: false, date: "", region: "", privacy: "private",
};

export function RouteStudioJobPage() {
  const { jobId = "" } = useParams();
  const [job, setJob] = useState<StudioJob | null>(null);
  const [metadata, setMetadata] = useState(initialMetadata);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void loadStudioJob(jobId).then((loaded) => {
      if (!active) return;
      setJob(loaded);
      setMetadata(loaded.metadata ?? initialMetadata);
    }).catch((error) => active && setMessage(error instanceof Error ? error.message : "Studio job could not be loaded."));
    return () => { active = false; };
  }, [jobId]);

  useEffect(() => {
    if (job?.status !== "rendering") return;
    const interval = window.setInterval(() => {
      void loadStudioJob(job.id).then(setJob).catch(() => undefined);
    }, 1200);
    return () => window.clearInterval(interval);
  }, [job?.id, job?.status]);

  async function act(label: string, action: () => Promise<StudioJob>) {
    setBusy(label); setMessage(null);
    try { setJob(await action()); } catch (error) { setMessage(error instanceof Error ? error.message : `${label} failed.`); }
    finally { setBusy(null); }
  }

  const selectedCandidate = useMemo(
    () => job?.inspection.candidates.find((candidate) => candidate.id === job.selectedGeometryId),
    [job],
  );
  const staged = job?.stagedRoute;
  const immutable = job?.status === "rendering" || job?.status === "promoting" || job?.status === "promoted";
  const language = staged
    ? studioExperienceLanguage(staged.lifecycle, staged.provenance.temporal.status)
    : null;
  const playableArtifact = job?.renderAttempts.find((attempt) => attempt.status === "complete" && attempt.outputPath)?.outputPath ?? null;

  if (!job) return <div className="grid min-h-64 place-items-center" role={message ? "alert" : "status"}>{message ?? "Loading Route Studio job..."}</div>;

  return (
    <section className="grid content-start gap-6" data-job-status={job.status} data-testid="route-studio-job">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-line pb-4">
        <div className="flex min-w-0 items-center gap-3"><Button asChild size="icon-sm" variant="outline"><Link to="/admin/studio" aria-label="Route Studio jobs"><ArrowLeft /></Link></Button><div className="min-w-0"><p className="text-micro font-semibold uppercase text-forest">Route Studio · {job.status.replaceAll("_", " ")}</p><h1 className="mt-1 truncate text-2xl font-semibold text-ink">{job.metadata?.name || job.source.originalFilename}</h1></div></div>
        <p className="font-mono text-micro text-ink-muted">{job.source.sha256.slice(0, 16)}</p>
      </header>

      <SourceInspection disabled={immutable || busy !== null} job={job} selected={selectedCandidate} onSelect={(candidateId) => void act("Select geometry", () => selectStudioGeometry(job.id, candidateId))} />

      {selectedCandidate ? (
        <MetadataForm
          candidate={selectedCandidate}
          metadata={metadata}
          disabled={immutable || busy !== null}
          onChange={setMetadata}
          onSave={() => void act("Save metadata", () => saveStudioMetadata(job.id, metadata))}
        />
      ) : null}

      {job.metadata ? (
        <section className="border-t border-line pt-5" aria-labelledby="compile-heading">
          <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 id="compile-heading" className="font-semibold text-ink">Production contract</h2><p className="mt-1 text-sm text-ink-secondary">Compile this selection without adding it to the canonical atlas.</p></div><Button disabled={immutable || busy !== null} onClick={() => void act("Compile", () => compileStudioRoute(job.id))}>{busy === "Compile" ? <LoaderCircle className="animate-spin" /> : <Check />}Compile staged route</Button></div>
        </section>
      ) : null}

      {staged && language ? (
        <section className="grid gap-4 border-t border-line pt-5" aria-labelledby="preview-heading">
          <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-micro font-semibold uppercase text-forest">{language.noun} · {language.timing}</p><h2 id="preview-heading" className="mt-1 text-xl font-semibold text-ink">{staged.activityName}</h2></div><Button asChild><Link to={`/admin/studio/${encodeURIComponent(job.id)}/preview`}><Play />Open interactive {language.noun}</Link></Button></div>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(18rem,.6fr)]">
            <RouteSketch candidate={selectedCandidate} />
            <dl className="grid grid-cols-2 content-start border-y border-line text-sm">
              <Fact label="Lifecycle" value={staged.lifecycle} /><Fact label="Identity" value={staged.routeId ?? staged.slug} />
              <Fact label="Distance" value={`${staged.distanceKm.toFixed(1)} km`} /><Fact label="Elevation" value={staged.provenance.elevation?.status === "unavailable" ? "Unavailable" : `${Math.round(staged.elevationGainM)} m ascent`} />
              <Fact label="Timing" value={language.timing} /><Fact label="Privacy" value={job.metadata?.privacy ?? "private"} />
            </dl>
          </div>
          <ElevationProfile candidate={selectedCandidate} />
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline"><Link to={`/admin/studio/${encodeURIComponent(job.id)}/preview?film=1`}><Film />Open Route film</Link></Button>
            {job.status === "rendering" ? <Button variant="outline" onClick={() => void act("Cancel", () => cancelStudioJob(job.id))}><Square />Cancel render</Button> : <Button variant="outline" onClick={() => void act("Render", () => renderStudioRoute(job.id))}><Film />Queue H.264 teaser</Button>}
            {job.retryable ? <Button variant="outline" onClick={() => void act("Retry", () => retryStudioJob(job.id))}><RefreshCcw />Retry</Button> : null}
            <Button disabled={busy !== null || job.status === "rendering"} onClick={() => void act("Promote", () => promoteStudioRoute(job.id))}><Rocket />Promote route</Button>
          </div>
          {job.renderAttempts[0] ? <div className="border-l-2 border-forest pl-3 text-sm" role="status"><strong className="capitalize">{job.renderAttempts[0].status}</strong> · {Math.round(job.renderAttempts[0].progress * 100)}%{job.renderAttempts[0].outputPath ? ` · ${job.renderAttempts[0].outputPath}` : ""}</div> : null}
          {playableArtifact ? <div className="grid gap-2"><video className="aspect-video w-full max-w-3xl bg-black" controls data-testid="studio-teaser" preload="metadata" src={studioArtifactUrl(job.id, playableArtifact)} /><a className="text-sm font-medium text-forest underline" href={studioArtifactUrl(job.id, playableArtifact)} rel="noreferrer" target="_blank">Open H.264 teaser</a></div> : null}
        </section>
      ) : null}

      {message ? <p className="border-l-2 border-destructive pl-3 text-sm text-destructive" role="alert">{message}</p> : null}
      {job.errors[0] ? <p className="border-l-2 border-destructive pl-3 text-sm text-destructive" role="alert">{job.errors[0].message}</p> : null}
      <section className="border-t border-line pt-4" aria-labelledby="events-heading"><h2 id="events-heading" className="font-semibold text-ink">Job events</h2><ol className="mt-3 divide-y divide-line border-y border-line">{job.events.map((event) => <li key={event.id} className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 py-2 text-sm"><Info className="mt-0.5 size-4 text-ink-muted" aria-hidden="true" /><span><span className="font-medium text-ink">{event.message}</span><span className="ml-2 text-micro text-ink-muted">{event.createdAt}</span></span></li>)}</ol></section>
    </section>
  );
}

function SourceInspection({ disabled, job, selected, onSelect }: { disabled: boolean; job: StudioJob; selected?: StudioCandidate; onSelect: (id: string) => void }) {
  const inspected = selected ?? job.inspection.candidates[0];
  return <section className="grid gap-4" aria-labelledby="source-heading"><div><p className="text-micro font-semibold uppercase text-forest">Source receipt</p><h2 id="source-heading" className="mt-1 font-semibold text-ink">{job.source.originalFilename} · {job.source.sourceFormat.toUpperCase()}</h2></div><div className="grid gap-3 lg:grid-cols-[minmax(18rem,.7fr)_minmax(0,1.3fr)]"><div className="divide-y divide-line border-y border-line">{job.inspection.candidates.map((candidate) => <button key={candidate.id} type="button" aria-pressed={candidate.id === selected?.id} className="group grid w-full grid-cols-[auto_minmax(0,1fr)] gap-3 px-2 py-3 text-left hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-55 aria-pressed:bg-forest-soft" disabled={disabled} onClick={() => onSelect(candidate.id)}><span className="mt-1 size-3 rounded-full border border-line-strong group-aria-pressed:border-forest group-aria-pressed:bg-forest" /><span><span className="block text-sm font-medium text-ink">{candidate.label}</span><span className="mt-1 block text-micro text-ink-muted">{(candidate.distanceM / 1000).toFixed(1)} km · {candidate.ascentM === null ? "ascent unavailable" : `${Math.round(candidate.ascentM)} m ascent`} · {candidate.pointCount} points · {candidate.segmentCount} segments</span><span className="mt-1 block text-micro text-ink-muted">Timing {candidate.timingStatus} · Elevation {candidate.elevationStatus}</span></span></button>)}</div><RouteSketch candidate={inspected} /></div><ElevationProfile candidate={inspected} /><div className="grid gap-2">{job.inspection.findings.map((finding) => { const Icon = finding.severity === "blocker" ? CircleAlert : finding.severity === "warning" ? AlertTriangle : Info; return <div key={`${finding.code}-${finding.message}`} className="flex gap-2 border-l-2 border-line-strong pl-3 text-sm text-ink-secondary"><Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" /><span><strong className="capitalize text-ink">{finding.severity}.</strong> {finding.message}</span></div>; })}</div></section>;
}

function MetadataForm({ candidate, metadata, disabled, onChange, onSave }: { candidate: StudioCandidate; metadata: StudioMetadata; disabled: boolean; onChange: (value: StudioMetadata) => void; onSave: () => void }) {
  const needsDate = metadata.completedByOwner && candidate.timingStatus === "unavailable";
  return <section className="border-t border-line pt-5" aria-labelledby="identity-heading"><div className="mb-4"><h2 id="identity-heading" className="font-semibold text-ink">Identify this route</h2><p className="mt-1 text-sm text-ink-secondary">Only owner facts that cannot be read safely from the source.</p></div><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"><Field label="Route name"><Input value={metadata.name} onChange={(event) => onChange({ ...metadata, name: event.target.value })} /></Field><Field label="Activity"><select className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={metadata.activityType} onChange={(event) => onChange({ ...metadata, activityType: event.target.value as "Run" | "Ride" })}><option>Run</option><option>Ride</option></select></Field><Field label="Place or region"><Input value={metadata.region} onChange={(event) => onChange({ ...metadata, region: event.target.value })} /></Field><Field label="Owner experience"><select className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={metadata.completedByOwner ? "completed" : "future"} onChange={(event) => onChange({ ...metadata, completedByOwner: event.target.value === "completed" })}><option value="future">Not completed</option><option value="completed">Completed by owner</option></select></Field>{needsDate ? <Field label="Completion date"><Input type="date" value={metadata.date} onChange={(event) => onChange({ ...metadata, date: event.target.value })} /></Field> : null}<Field label="Privacy"><select className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={metadata.privacy} onChange={(event) => onChange({ ...metadata, privacy: event.target.value as "private" | "public" })}><option value="private">Private owner content</option><option value="public">Public</option></select></Field></div><Button className="mt-4" disabled={disabled || !metadata.name || !metadata.region || (needsDate && !metadata.date)} onClick={onSave}><Check />Save route facts</Button></section>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="grid gap-1.5 text-sm font-medium text-ink"><span>{label}</span>{children}</label>; }
function Fact({ label, value }: { label: string; value: string }) { return <div className="border-b border-line px-3 py-3 odd:border-r"><dt className="text-micro uppercase text-ink-muted">{label}</dt><dd className="mt-1 truncate capitalize text-ink">{value}</dd></div>; }

function RouteSketch({ candidate }: { candidate?: StudioCandidate }) {
  const points = candidate?.previewSegments.flat() ?? [];
  if (points.length < 2) return <div className="grid min-h-52 place-items-center border-y border-line text-sm text-ink-muted"><Map className="mr-2 inline size-4" />No route geometry selected</div>;
  const lats = points.map(([lat]) => lat), lngs = points.map(([, lng]) => lng);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats), minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  const width = maxLng - minLng || 0.0001, height = maxLat - minLat || 0.0001;
  const line = points.map(([lat, lng]) => `${10 + ((lng - minLng) / width) * 380},${190 - ((lat - minLat) / height) * 180}`).join(" ");
  return <div className="relative min-h-52 overflow-hidden border-y border-line bg-[#e7ece7]" aria-label={`Route map for ${candidate?.label}`}><svg viewBox="0 0 400 200" className="absolute inset-0 size-full" role="img"><title>{candidate?.label}</title><path d="M0 42L400 12M0 138L400 108M72 0L42 200M312 0L282 200" stroke="#c9d2cc" strokeWidth="1" /><polyline points={line} fill="none" stroke="#d9573f" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" /></svg><span className="absolute bottom-2 left-2 bg-white/90 px-2 py-1 text-micro text-ink">Source geometry</span></div>;
}

function ElevationProfile({ candidate }: { candidate?: StudioCandidate }) {
  const elevations = candidate?.previewSegments.flat().map((point) => point[2]).filter((value): value is number => value !== null) ?? [];
  if (candidate?.elevationStatus !== "recorded" || elevations.length < 2) return <div className="border-y border-line py-4 text-sm text-ink-secondary">Elevation profile unavailable in the source.</div>;
  const min = Math.min(...elevations), max = Math.max(...elevations), span = max - min || 1;
  const points = elevations.map((value, index) => `${(index / (elevations.length - 1)) * 400},${100 - ((value - min) / span) * 88}`).join(" ");
  return <div className="border-y border-line py-3"><div className="mb-2 flex justify-between text-micro text-ink-muted"><span>Recorded elevation</span><span>{Math.round(min)}-{Math.round(max)} m</span></div><svg viewBox="0 0 400 104" className="h-28 w-full" preserveAspectRatio="none"><polyline points={points} fill="none" stroke="currentColor" className="text-forest" strokeWidth="2" /></svg></div>;
}
