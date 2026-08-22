"""Durable SQLite state for the local Route Studio owner workflow."""

from contextlib import contextmanager
from datetime import UTC, datetime
import json
from pathlib import Path
import sqlite3
import threading


def utc_now():
    return datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


class StudioStateConflict(RuntimeError):
    pass


class StudioStore:
    def __init__(self, path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.connection = sqlite3.connect(self.path, check_same_thread=False)
        self.connection.row_factory = sqlite3.Row
        self.connection.execute("PRAGMA foreign_keys = ON")
        self.connection.execute("PRAGMA journal_mode = WAL")
        self.lock = threading.RLock()
        self._migrate()
        self.recover_incomplete_work()

    def close(self):
        with self.lock:
            self.connection.close()

    @contextmanager
    def transaction(self):
        with self.lock:
            try:
                yield self.connection
            except Exception:
                self.connection.rollback()
                raise
            else:
                self.connection.commit()

    def _migrate(self):
        with self.transaction() as connection:
            connection.executescript("""
                CREATE TABLE IF NOT EXISTS sources (
                    id TEXT PRIMARY KEY,
                    sha256 TEXT NOT NULL UNIQUE,
                    original_filename TEXT NOT NULL,
                    stored_path TEXT NOT NULL,
                    source_format TEXT NOT NULL,
                    inspection_json TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS jobs (
                    id TEXT PRIMARY KEY,
                    source_id TEXT NOT NULL UNIQUE REFERENCES sources(id),
                    status TEXT NOT NULL,
                    selected_geometry_id TEXT,
                    retryable INTEGER NOT NULL DEFAULT 0,
                    cancellation_requested INTEGER NOT NULL DEFAULT 0,
                    promoted_at TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS job_stages (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
                    stage TEXT NOT NULL,
                    status TEXT NOT NULL,
                    detail_json TEXT NOT NULL DEFAULT '{}',
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
                    level TEXT NOT NULL,
                    code TEXT NOT NULL,
                    message TEXT NOT NULL,
                    data_json TEXT NOT NULL DEFAULT '{}',
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS metadata_decisions (
                    job_id TEXT PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
                    decision_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS staged_routes (
                    job_id TEXT PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
                    route_json TEXT NOT NULL,
                    route_fingerprint TEXT NOT NULL,
                    compiled_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS render_attempts (
                    id TEXT PRIMARY KEY,
                    job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
                    status TEXT NOT NULL,
                    render_fingerprint TEXT NOT NULL,
                    progress REAL NOT NULL DEFAULT 0,
                    output_path TEXT,
                    evidence_json TEXT NOT NULL DEFAULT '{}',
                    started_at TEXT NOT NULL,
                    finished_at TEXT
                );
                CREATE TABLE IF NOT EXISTS artifacts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
                    kind TEXT NOT NULL,
                    path TEXT NOT NULL,
                    sha256 TEXT,
                    metadata_json TEXT NOT NULL DEFAULT '{}',
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS errors (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
                    stage TEXT NOT NULL,
                    code TEXT NOT NULL,
                    message TEXT NOT NULL,
                    retryable INTEGER NOT NULL,
                    detail_json TEXT NOT NULL DEFAULT '{}',
                    created_at TEXT NOT NULL
                );
            """)

    def recover_incomplete_work(self):
        with self.transaction() as connection:
            rows = connection.execute(
                "SELECT id, job_id FROM render_attempts WHERE status IN ('queued', 'running')"
            ).fetchall()
            for row in rows:
                connection.execute(
                    "UPDATE render_attempts SET status = 'interrupted', finished_at = ? WHERE id = ?",
                    (utc_now(), row["id"]),
                )
                self._set_job(connection, row["job_id"], "render_interrupted", retryable=True)
                self._event(
                    connection,
                    row["job_id"],
                    "warning",
                    "render-interrupted",
                    "The local renderer stopped before completion. The verified frames remain available for retry.",
                )

    def source_by_sha(self, sha256):
        with self.lock:
            row = self.connection.execute(
                "SELECT * FROM sources WHERE sha256 = ?", (sha256,)
            ).fetchone()
            return dict(row) if row else None

    def source_inspections(self):
        with self.lock:
            rows = self.connection.execute(
                "SELECT id, inspection_json FROM sources ORDER BY created_at"
            ).fetchall()
        return [(row["id"], json.loads(row["inspection_json"])) for row in rows]

    def source(self, source_id):
        with self.lock:
            row = self.connection.execute(
                "SELECT * FROM sources WHERE id = ?", (source_id,)
            ).fetchone()
            return dict(row) if row else None

    def create_source_job(self, source, inspection, selected_geometry_id):
        now = utc_now()
        job_id = f"job-{source['sha256'][:16]}"
        with self.transaction() as connection:
            connection.execute(
                """INSERT INTO sources
                   (id, sha256, original_filename, stored_path, source_format, inspection_json, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (
                    source["id"], source["sha256"], source["original_filename"],
                    source["stored_path"], source["source_format"],
                    json.dumps(inspection, separators=(",", ":")), now,
                ),
            )
            connection.execute(
                """INSERT INTO jobs
                   (id, source_id, status, selected_geometry_id, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (
                    job_id,
                    source["id"],
                    "needs_metadata" if selected_geometry_id else "needs_geometry_selection",
                    selected_geometry_id,
                    now,
                    now,
                ),
            )
            self._stage(connection, job_id, "inspection", "complete", inspection)
            self._event(connection, job_id, "information", "source-inspected", "Source preserved and inspected.")
        return job_id

    def create_job_for_existing_source(self, source_id):
        with self.transaction() as connection:
            source = connection.execute(
                "SELECT sha256, inspection_json FROM sources WHERE id = ?", (source_id,)
            ).fetchone()
            if not source:
                raise KeyError(source_id)
            inspection = json.loads(source["inspection_json"])
            selected_geometry_id = inspection.get("selected_geometry_id")
            now = utc_now()
            job_id = f"job-{source['sha256'][:16]}"
            connection.execute(
                """INSERT INTO jobs
                   (id, source_id, status, selected_geometry_id, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (
                    job_id, source_id,
                    "needs_metadata" if selected_geometry_id else "needs_geometry_selection",
                    selected_geometry_id, now, now,
                ),
            )
            self._stage(connection, job_id, "inspection", "complete", inspection)
            self._event(
                connection, job_id, "information", "source-reopened",
                "Preserved source reopened as a new Studio job.",
            )
        return job_id

    def job_for_source(self, source_id):
        with self.lock:
            row = self.connection.execute(
                "SELECT id FROM jobs WHERE source_id = ?", (source_id,)
            ).fetchone()
            return row["id"] if row else None

    def list_jobs(self):
        with self.lock:
            rows = self.connection.execute(
                "SELECT id FROM jobs ORDER BY created_at DESC"
            ).fetchall()
        return [self.get_job(row["id"]) for row in rows]

    def get_job(self, job_id):
        with self.lock:
            job = self.connection.execute(
                """SELECT jobs.*, sources.sha256, sources.original_filename,
                          sources.stored_path, sources.source_format, sources.inspection_json
                   FROM jobs JOIN sources ON sources.id = jobs.source_id
                   WHERE jobs.id = ?""",
                (job_id,),
            ).fetchone()
            if not job:
                return None
            metadata = self.connection.execute(
                "SELECT decision_json FROM metadata_decisions WHERE job_id = ?", (job_id,)
            ).fetchone()
            staged = self.connection.execute(
                "SELECT route_json, route_fingerprint, compiled_at FROM staged_routes WHERE job_id = ?",
                (job_id,),
            ).fetchone()
            events = self.connection.execute(
                "SELECT * FROM events WHERE job_id = ? ORDER BY id", (job_id,)
            ).fetchall()
            stages = self.connection.execute(
                "SELECT * FROM job_stages WHERE job_id = ? ORDER BY id", (job_id,)
            ).fetchall()
            renders = self.connection.execute(
                "SELECT * FROM render_attempts WHERE job_id = ? ORDER BY started_at DESC", (job_id,)
            ).fetchall()
            artifacts = self.connection.execute(
                "SELECT * FROM artifacts WHERE job_id = ? ORDER BY id DESC", (job_id,)
            ).fetchall()
            errors = self.connection.execute(
                "SELECT * FROM errors WHERE job_id = ? ORDER BY id DESC", (job_id,)
            ).fetchall()
        return {
            "id": job["id"],
            "source_id": job["source_id"],
            "status": job["status"],
            "selected_geometry_id": job["selected_geometry_id"],
            "retryable": bool(job["retryable"]),
            "cancellation_requested": bool(job["cancellation_requested"]),
            "promoted_at": job["promoted_at"],
            "created_at": job["created_at"],
            "updated_at": job["updated_at"],
            "source": {
                "id": job["source_id"],
                "sha256": job["sha256"],
                "original_filename": job["original_filename"],
                "stored_path": job["stored_path"],
                "source_format": job["source_format"],
            },
            "inspection": json.loads(job["inspection_json"]),
            "metadata": json.loads(metadata["decision_json"]) if metadata else None,
            "staged_route": json.loads(staged["route_json"]) if staged else None,
            "route_fingerprint": staged["route_fingerprint"] if staged else None,
            "stages": [self._stage_dict(row) for row in stages],
            "events": [self._event_dict(row) for row in events],
            "render_attempts": [self._render_dict(row) for row in renders],
            "artifacts": [self._artifact_dict(row) for row in artifacts],
            "errors": [self._error_dict(row) for row in errors],
        }

    def select_geometry(self, job_id, candidate_id):
        with self.transaction() as connection:
            self._require_mutable_job(connection, job_id)
            self._invalidate_downstream(connection, job_id, include_metadata=True)
            connection.execute(
                """UPDATE jobs
                   SET selected_geometry_id = ?, status = 'needs_metadata', retryable = 0,
                       cancellation_requested = 0, updated_at = ?
                   WHERE id = ?""",
                (candidate_id, utc_now(), job_id),
            )
            self._stage(connection, job_id, "geometry-selection", "complete", {"candidate_id": candidate_id})
            self._event(connection, job_id, "information", "geometry-selected", "Route geometry selected.")

    def save_metadata(self, job_id, metadata, expected_geometry_id):
        now = utc_now()
        with self.transaction() as connection:
            job = self._require_mutable_job(connection, job_id)
            if job["selected_geometry_id"] != expected_geometry_id:
                raise StudioStateConflict("Selected geometry changed before metadata could be saved")
            self._invalidate_downstream(connection, job_id, include_metadata=False)
            connection.execute(
                """INSERT INTO metadata_decisions (job_id, decision_json, updated_at)
                   VALUES (?, ?, ?)
                   ON CONFLICT(job_id) DO UPDATE SET decision_json = excluded.decision_json,
                                                     updated_at = excluded.updated_at""",
                (job_id, json.dumps(metadata, separators=(",", ":")), now),
            )
            self._set_job(connection, job_id, "ready_to_compile")
            self._stage(connection, job_id, "metadata", "complete", metadata)
            self._event(connection, job_id, "information", "metadata-recorded", "Owner facts recorded.")

    def save_staged_route(
        self, job_id, route, fingerprint, expected_metadata, expected_geometry_id
    ):
        now = utc_now()
        with self.transaction() as connection:
            job = self._require_mutable_job(connection, job_id)
            metadata = connection.execute(
                "SELECT decision_json FROM metadata_decisions WHERE job_id = ?", (job_id,)
            ).fetchone()
            if (
                job["selected_geometry_id"] != expected_geometry_id
                or not metadata
                or json.loads(metadata["decision_json"]) != expected_metadata
            ):
                raise StudioStateConflict("Route inputs changed before compilation could be saved")
            connection.execute(
                """INSERT INTO staged_routes (job_id, route_json, route_fingerprint, compiled_at)
                   VALUES (?, ?, ?, ?)
                   ON CONFLICT(job_id) DO UPDATE SET route_json = excluded.route_json,
                                                     route_fingerprint = excluded.route_fingerprint,
                                                     compiled_at = excluded.compiled_at""",
                (job_id, json.dumps(route, separators=(",", ":")), fingerprint, now),
            )
            self._set_job(connection, job_id, "staged")
            self._stage(connection, job_id, "compile", "complete", {"route_fingerprint": fingerprint})
            self._event(connection, job_id, "information", "route-compiled", "Staged route compiled with the production contract.")

    def start_render(self, job_id, attempt_id, fingerprint, expected_route_fingerprint):
        with self.transaction() as connection:
            job = connection.execute(
                "SELECT status FROM jobs WHERE id = ?", (job_id,)
            ).fetchone()
            if not job:
                raise KeyError(job_id)
            if job["status"] in ("rendering", "promoting", "promoted"):
                raise StudioStateConflict(f"Studio job cannot render while {job['status']}")
            staged = connection.execute(
                "SELECT route_fingerprint FROM staged_routes WHERE job_id = ?", (job_id,)
            ).fetchone()
            if not staged or staged["route_fingerprint"] != expected_route_fingerprint:
                raise StudioStateConflict("Staged route changed before render could be reserved")
            connection.execute(
                """INSERT INTO render_attempts
                   (id, job_id, status, render_fingerprint, started_at)
                   VALUES (?, ?, 'running', ?, ?)""",
                (attempt_id, job_id, fingerprint, utc_now()),
            )
            connection.execute(
                "UPDATE jobs SET cancellation_requested = 0 WHERE id = ?", (job_id,)
            )
            self._set_job(connection, job_id, "rendering")
            self._event(connection, job_id, "information", "render-started", "Local H.264 teaser render started.")

    def start_promotion(self, job_id, journal, expected_route_fingerprint):
        with self.transaction() as connection:
            job = connection.execute(
                "SELECT status FROM jobs WHERE id = ?", (job_id,)
            ).fetchone()
            if not job:
                raise KeyError(job_id)
            running = connection.execute(
                "SELECT 1 FROM render_attempts WHERE job_id = ? AND status = 'running' LIMIT 1",
                (job_id,),
            ).fetchone()
            if job["status"] in ("rendering", "promoting", "promoted") or running:
                raise StudioStateConflict(f"Studio job cannot promote while {job['status']}")
            staged = connection.execute(
                "SELECT route_fingerprint FROM staged_routes WHERE job_id = ?", (job_id,)
            ).fetchone()
            if not staged or staged["route_fingerprint"] != expected_route_fingerprint:
                raise StudioStateConflict("Staged route changed before promotion could be reserved")
            self._set_job(connection, job_id, "promoting")
            self._stage(connection, job_id, "promotion", "running", journal)
            self._event(
                connection, job_id, "information", "promotion-started",
                "Canonical promotion started with a durable rollback journal.",
            )

    def interrupted_promotions(self):
        with self.lock:
            jobs = self.connection.execute(
                "SELECT id FROM jobs WHERE status = 'promoting' ORDER BY updated_at"
            ).fetchall()
            interrupted = []
            for job in jobs:
                stage = self.connection.execute(
                    """SELECT detail_json FROM job_stages
                       WHERE job_id = ? AND stage = 'promotion' AND status = 'running'
                       ORDER BY id DESC LIMIT 1""",
                    (job["id"],),
                ).fetchone()
                interrupted.append((job["id"], json.loads(stage["detail_json"]) if stage else {}))
        return interrupted

    def mark_promotion_interrupted(self, job_id):
        with self.transaction() as connection:
            self._set_job(connection, job_id, "promotion_failed", retryable=True)
            self._stage(connection, job_id, "promotion", "interrupted", {})
            self._error(
                connection, job_id, "promotion", "promotion-interrupted",
                "Promotion was interrupted and rolled back on restart.", True,
            )
            self._event(
                connection, job_id, "warning", "promotion-interrupted",
                "Interrupted promotion restored the previous canonical publication.",
            )

    def update_render(
        self, attempt_id, *, status, progress, output_path=None, artifact_sha256=None,
        evidence=None,
    ):
        with self.transaction() as connection:
            row = connection.execute(
                "SELECT job_id FROM render_attempts WHERE id = ?", (attempt_id,)
            ).fetchone()
            if not row:
                raise KeyError(attempt_id)
            finished = utc_now() if status in ("complete", "failed", "cancelled") else None
            connection.execute(
                """UPDATE render_attempts
                   SET status = ?, progress = ?, output_path = COALESCE(?, output_path),
                       evidence_json = ?, finished_at = COALESCE(?, finished_at)
                   WHERE id = ?""",
                (status, progress, output_path, json.dumps(evidence or {}), finished, attempt_id),
            )
            job_status = {"complete": "rendered", "failed": "render_failed", "cancelled": "staged"}.get(status, "rendering")
            self._set_job(connection, row["job_id"], job_status, retryable=status == "failed")
            if status == "complete" and output_path:
                connection.execute(
                    """INSERT INTO artifacts
                       (job_id, kind, path, sha256, metadata_json, created_at)
                       VALUES (?, 'h264-teaser', ?, ?, ?, ?)""",
                    (
                        row["job_id"], output_path, artifact_sha256,
                        json.dumps(evidence or {}, separators=(",", ":")), utc_now(),
                    ),
                )
            elif status == "failed":
                self._error(
                    connection, row["job_id"], "render", "render-failed",
                    "Local teaser rendering failed. Inspect the render evidence and retry.",
                    True, evidence,
                )
            self._event(connection, row["job_id"], "information" if status == "complete" else "warning", f"render-{status}", f"Render {status}.", {"progress": progress})

    def request_cancel(self, job_id):
        with self.transaction() as connection:
            self._require_job(connection, job_id)
            connection.execute(
                "UPDATE jobs SET cancellation_requested = 1, updated_at = ? WHERE id = ?",
                (utc_now(), job_id),
            )
            self._event(connection, job_id, "warning", "cancellation-requested", "Cancellation requested.")

    def mark_promotion_failed(self, job_id, message):
        with self.transaction() as connection:
            self._set_job(connection, job_id, "promotion_failed", retryable=True)
            self._error(connection, job_id, "promotion", "canonical-generation-failed", message, True)
            self._event(connection, job_id, "warning", "promotion-rolled-back", "Canonical promotion failed and was rolled back.")

    def mark_promoted(self, job_id):
        with self.transaction() as connection:
            now = utc_now()
            connection.execute(
                "UPDATE jobs SET status = 'promoted', promoted_at = ?, retryable = 0, updated_at = ? WHERE id = ?",
                (now, now, job_id),
            )
            self._stage(connection, job_id, "promotion", "complete", {})
            self._event(connection, job_id, "information", "route-promoted", "Staged route promoted into canonical source data.")

    def delete_job(self, job_id):
        with self.transaction() as connection:
            self._require_mutable_job(connection, job_id)
            result = connection.execute("DELETE FROM jobs WHERE id = ?", (job_id,))
            return result.rowcount > 0

    def _require_job(self, connection, job_id):
        row = connection.execute("SELECT id FROM jobs WHERE id = ?", (job_id,)).fetchone()
        if not row:
            raise KeyError(job_id)

    def _require_mutable_job(self, connection, job_id):
        row = connection.execute(
            "SELECT status, selected_geometry_id FROM jobs WHERE id = ?", (job_id,)
        ).fetchone()
        if not row:
            raise KeyError(job_id)
        if row["status"] in ("rendering", "promoting", "promoted"):
            raise StudioStateConflict(f"Studio job cannot be edited while {row['status']}")
        return row

    def _invalidate_downstream(self, connection, job_id, *, include_metadata):
        if include_metadata:
            connection.execute("DELETE FROM metadata_decisions WHERE job_id = ?", (job_id,))
        connection.execute("DELETE FROM staged_routes WHERE job_id = ?", (job_id,))
        connection.execute("DELETE FROM render_attempts WHERE job_id = ?", (job_id,))
        connection.execute("DELETE FROM artifacts WHERE job_id = ?", (job_id,))
        connection.execute("DELETE FROM errors WHERE job_id = ?", (job_id,))

    def _set_job(self, connection, job_id, status, *, retryable=False):
        connection.execute(
            "UPDATE jobs SET status = ?, retryable = ?, updated_at = ? WHERE id = ?",
            (status, int(retryable), utc_now(), job_id),
        )

    def _stage(self, connection, job_id, stage, status, detail):
        connection.execute(
            "INSERT INTO job_stages (job_id, stage, status, detail_json, created_at) VALUES (?, ?, ?, ?, ?)",
            (job_id, stage, status, json.dumps(detail, separators=(",", ":")), utc_now()),
        )

    def _event(self, connection, job_id, level, code, message, data=None):
        connection.execute(
            "INSERT INTO events (job_id, level, code, message, data_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (job_id, level, code, message, json.dumps(data or {}, separators=(",", ":")), utc_now()),
        )

    def _error(self, connection, job_id, stage, code, message, retryable, detail=None):
        connection.execute(
            "INSERT INTO errors (job_id, stage, code, message, retryable, detail_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (job_id, stage, code, message, int(retryable), json.dumps(detail or {}), utc_now()),
        )

    @staticmethod
    def _stage_dict(row):
        return {
            "id": row["id"], "stage": row["stage"], "status": row["status"],
            "detail": json.loads(row["detail_json"]), "created_at": row["created_at"],
        }

    @staticmethod
    def _event_dict(row):
        return {
            "id": row["id"], "level": row["level"], "code": row["code"],
            "message": row["message"], "data": json.loads(row["data_json"]),
            "created_at": row["created_at"],
        }

    @staticmethod
    def _render_dict(row):
        return {
            "id": row["id"], "status": row["status"], "progress": row["progress"],
            "render_fingerprint": row["render_fingerprint"], "output_path": row["output_path"],
            "evidence": json.loads(row["evidence_json"]), "started_at": row["started_at"],
            "finished_at": row["finished_at"],
        }

    @staticmethod
    def _artifact_dict(row):
        return {
            "id": row["id"], "kind": row["kind"], "path": row["path"],
            "sha256": row["sha256"], "metadata": json.loads(row["metadata_json"]),
            "created_at": row["created_at"],
        }

    @staticmethod
    def _error_dict(row):
        return {
            "stage": row["stage"], "code": row["code"], "message": row["message"],
            "retryable": bool(row["retryable"]), "detail": json.loads(row["detail_json"]),
            "created_at": row["created_at"],
        }
