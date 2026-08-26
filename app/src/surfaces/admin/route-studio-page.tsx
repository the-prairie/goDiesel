import { FileDown, FileUp, LockKeyhole, RefreshCw, Route, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { loadAdminWorkspace } from "@/data/admin-repository";
import {
  importRouteInboxEntry,
  loadRouteInbox,
  loadStudioJobs,
  uploadStudioSource,
  type RouteInbox,
  type StudioJob,
} from "@/data/studio-repository";
import { Button } from "@/ui/button";

export function RouteStudioPage() {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<"checking" | "editable" | "read-only">("checking");
  const [jobs, setJobs] = useState<StudioJob[]>([]);
  const [inbox, setInbox] = useState<RouteInbox | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [inboxMessage, setInboxMessage] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [importingId, setImportingId] = useState<string | null>(null);
  const [refreshingInbox, setRefreshingInbox] = useState(false);

  useEffect(() => {
    let active = true;
    void loadAdminWorkspace().then(async (workspace) => {
      if (!active) return;
      setMode(workspace.mode);
      if (workspace.mode === "editable") {
        try {
          const loadedJobs = await loadStudioJobs();
          if (active) setJobs(loadedJobs);
        } catch (error) {
          if (active) setMessage(error instanceof Error ? error.message : "Studio jobs could not be loaded.");
        }
        try {
          const loadedInbox = await loadRouteInbox();
          if (active) setInbox(loadedInbox);
        } catch (error) {
          if (active) {
            setInbox({ roots: [], entries: [], warnings: [] });
            setInboxMessage(error instanceof Error ? error.message : "Export Inbox could not be loaded.");
          }
        }
      }
    });
    return () => { active = false; };
  }, []);

  async function upload(file: File | undefined) {
    if (!file || uploading || mode !== "editable") return;
    setUploading(true);
    setMessage(null);
    try {
      const result = await uploadStudioSource(file);
      navigate(`/admin/studio/${encodeURIComponent(result.job_id)}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Route source could not be uploaded.");
    } finally {
      setUploading(false);
    }
  }

  async function refreshInbox() {
    if (refreshingInbox || mode !== "editable") return;
    setRefreshingInbox(true);
    setInboxMessage(null);
    try {
      setInbox(await loadRouteInbox());
    } catch (error) {
      setInboxMessage(error instanceof Error ? error.message : "Export Inbox could not be refreshed.");
    } finally {
      setRefreshingInbox(false);
    }
  }

  async function importFromInbox(entryId: string) {
    if (importingId || mode !== "editable") return;
    setImportingId(entryId);
    setMessage(null);
    try {
      const result = await importRouteInboxEntry(entryId);
      navigate(`/admin/studio/${encodeURIComponent(result.job_id)}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Route export could not be imported.");
    } finally {
      setImportingId(null);
    }
  }

  return (
    <section className="grid content-start gap-5" data-testid="route-studio">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-line pb-4">
        <div>
          <p className="text-micro font-semibold uppercase text-forest">Admin</p>
          <h1 className="mt-1 text-2xl font-semibold text-ink">Route Studio</h1>
        </div>
        <Button asChild size="sm" variant="outline"><Link to="/admin">Curation ledger</Link></Button>
      </header>

      {mode === "checking" ? (
        <div className="grid min-h-64 place-items-center border-y border-line" role="status">Checking for the local owner writer...</div>
      ) : mode === "read-only" ? (
        <div className="flex gap-3 border-y border-line py-6" role="status">
          <LockKeyhole className="size-5 shrink-0 text-ink-muted" aria-hidden="true" />
          <div><h2 className="font-semibold text-ink">Route Studio is local-only</h2><p className="mt-1 max-w-2xl text-sm text-ink-secondary">Uploads and route mutations are unavailable in the deployed read-only Admin.</p></div>
        </div>
      ) : (
        <>
          <section aria-labelledby="export-inbox-heading" className="border-y border-line">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-3 py-3">
              <div>
                <h2 id="export-inbox-heading" className="font-semibold text-ink">Export Inbox</h2>
                <p className="mt-0.5 text-micro text-ink-muted">
                  {inbox?.roots.length ? inbox.roots.join(" · ") : "No local route folder configured"}
                </p>
              </div>
              <Button
                type="button"
                size="icon-sm"
                variant="outline"
                aria-label="Refresh Export Inbox"
                title="Refresh Export Inbox"
                disabled={refreshingInbox}
                onClick={() => void refreshInbox()}
              >
                <RefreshCw className={refreshingInbox ? "animate-spin" : ""} />
              </Button>
            </div>
            {inboxMessage ? <p className="border-b border-line px-3 py-2 text-caption text-destructive" role="alert">{inboxMessage}</p> : null}
            {inbox?.warnings.map((warning) => <p key={warning} className="border-b border-line px-3 py-2 text-caption text-ink-secondary" role="status">{warning}</p>)}
            {inbox === null ? (
              <div className="grid min-h-24 place-items-center text-sm text-ink-secondary" role="status">Scanning local route exports...</div>
            ) : inbox.entries.length === 0 ? (
              <div className="flex min-h-24 items-center gap-3 px-3 text-sm text-ink-secondary"><FileDown className="size-4" aria-hidden="true" />No GPX, KML, KMZ, or FIT exports found.</div>
            ) : (
              <div className="divide-y divide-line">
                {inbox.entries.map((entry) => (
                  <div key={entry.id} className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-3 py-3">
                    <FileDown className="size-4 text-forest" aria-hidden="true" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink">{entry.filename}</p>
                      <p className="mt-0.5 text-micro text-ink-muted">{entry.sourceFormat.toUpperCase()} · {formatBytes(entry.sizeBytes)} · {formatModifiedAt(entry.modifiedAt)}</p>
                      {entry.reason ? <p className="mt-1 text-caption text-ink-secondary">{entry.reason}</p> : null}
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant={entry.eligible ? "outline" : "ghost"}
                      aria-label={`${inboxAction(entry)} ${entry.filename}`}
                      disabled={!entry.eligible || importingId !== null}
                      onClick={() => void importFromInbox(entry.id)}
                    >
                      {importingId === entry.id
                        ? entry.checksumStatus === "deferred" ? "Checking..." : entry.imported ? "Reopening..." : "Importing..."
                        : inboxAction(entry)}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </section>

          <input
            ref={inputRef}
            className="sr-only"
            type="file"
            accept=".gpx,.kml,.kmz,application/gpx+xml,application/vnd.google-earth.kml+xml,application/vnd.google-earth.kmz"
            onChange={(event) => void upload(event.target.files?.[0])}
          />
          <button
            type="button"
            className="grid min-h-52 place-items-center border border-dashed border-line-strong bg-surface-muted px-6 py-8 text-center transition-colors hover:border-forest focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => inputRef.current?.click()}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => { event.preventDefault(); void upload(event.dataTransfer.files[0]); }}
          >
            <span className="grid justify-items-center gap-3">
              <span className="grid size-10 place-items-center rounded-md bg-forest text-white"><Upload className="size-5" aria-hidden="true" /></span>
              <span><span className="block font-semibold text-ink">{uploading ? "Preserving source..." : "Drop a GPX, KML, or KMZ route"}</span><span className="mt-1 block text-sm text-ink-secondary">The original is checksum-addressed before inspection.</span></span>
            </span>
          </button>
          {message ? <p className="border-l-2 border-destructive pl-3 text-sm text-destructive" role="alert">{message}</p> : null}

          <section aria-labelledby="studio-jobs-heading" className="border-t border-line pt-4">
            <div className="flex items-center justify-between gap-3"><h2 id="studio-jobs-heading" className="font-semibold text-ink">Staged routes</h2><span className="text-micro text-ink-muted">{jobs.length} jobs</span></div>
            {jobs.length === 0 ? (
              <div className="mt-4 flex min-h-28 items-center gap-3 border-y border-line text-sm text-ink-secondary"><FileUp className="size-4" aria-hidden="true" />No route sources staged yet.</div>
            ) : (
              <div className="mt-3 divide-y divide-line border-y border-line">
                {jobs.map((job) => (
                  <Link key={job.id} to={`/admin/studio/${encodeURIComponent(job.id)}`} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-2 py-3 hover:bg-surface-muted">
                    <Route className="size-4 text-forest" aria-hidden="true" />
                    <span className="min-w-0"><span className="block truncate text-sm font-medium text-ink">{job.metadata?.name || job.source.originalFilename}</span><span className="block truncate text-micro text-ink-muted">{job.source.sourceFormat.toUpperCase()} · {job.status.replaceAll("_", " ")}</span></span>
                    <span className="text-micro text-ink-muted">Open</span>
                  </Link>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </section>
  );
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  return `${(value / 1024).toFixed(value < 10 * 1024 ? 1 : 0)} KB`;
}

function inboxAction(entry: RouteInbox["entries"][number]) {
  if (!entry.eligible) return "Needs GPX";
  if (entry.checksumStatus === "deferred") return "Check and open";
  return entry.imported ? "Reopen" : "Import";
}

function formatModifiedAt(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Time unavailable";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
}
