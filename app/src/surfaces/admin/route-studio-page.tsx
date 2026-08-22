import { FileUp, LockKeyhole, Route, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { loadAdminWorkspace } from "@/data/admin-repository";
import { loadStudioJobs, uploadStudioSource, type StudioJob } from "@/data/studio-repository";
import { Button } from "@/ui/button";

export function RouteStudioPage() {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<"checking" | "editable" | "read-only">("checking");
  const [jobs, setJobs] = useState<StudioJob[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    let active = true;
    void loadAdminWorkspace().then(async (workspace) => {
      if (!active) return;
      setMode(workspace.mode);
      if (workspace.mode === "editable") {
        try {
          const loaded = await loadStudioJobs();
          if (active) setJobs(loaded);
        } catch (error) {
          if (active) setMessage(error instanceof Error ? error.message : "Studio jobs could not be loaded.");
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
