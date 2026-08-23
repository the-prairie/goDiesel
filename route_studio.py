"""Owner-only Route Studio orchestration with staged compilation and promotion."""

from datetime import date
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import threading
import uuid

from admin_curation import write_atomic
from private_route_read_model import private_owner_routes
from route_studio_compiler import compile_route
from route_studio_importers import (
    Finding,
    IMPORTER_VERSION,
    ImportError as SourceImportError,
    SourceInspection,
    candidate_by_id,
    canonical_gpx,
    inspect_source,
)
from route_studio_store import StudioStateConflict, StudioStore
from route_imports import PRIVATE_DURABLE_BACKUP, private_route_source_root


class StudioError(RuntimeError):
    pass


class StudioConflict(StudioError):
    pass


class StudioNotFound(StudioError):
    pass


class RouteStudio:
    def __init__(self, checkout_root, *, durable_source_root=None):
        self.root = Path(checkout_root).resolve()
        self.durable_source_root = Path(
            durable_source_root or private_route_source_root(self.root)
        ).expanduser().resolve()
        self.state_root = self.root / ".route-studio"
        self.sources_root = self.state_root / "sources"
        self.store = StudioStore(self.state_root / "studio.sqlite3")
        self._render_processes = {}
        self._render_threads = {}
        self._render_lock = threading.Lock()
        self._closing = threading.Event()
        self._recover_interrupted_promotions()

    def owner_routes(self):
        return private_owner_routes(
            self.root,
            durable_source_root=self.durable_source_root,
        )

    def job_for_source_sha(self, digest):
        source = self.store.source_by_sha(digest)
        return self.store.job_for_source(source["id"]) if source else None

    def close(self):
        self._closing.set()
        with self._render_lock:
            processes = list(self._render_processes.values())
            threads = list(self._render_threads.values())
        for process in processes:
            self._terminate_process_group(process)
        for thread in threads:
            if thread is not threading.current_thread():
                thread.join()
        self.store.close()

    def upload(self, filename, payload):
        safe_filename = Path(str(filename)).name
        if not safe_filename or safe_filename in (".", ".."):
            raise StudioError("source filename is missing")
        try:
            inspection = inspect_source(safe_filename, payload)
        except SourceImportError as error:
            raise StudioError(str(error)) from error
        digest = hashlib.sha256(payload).hexdigest()
        existing = self.store.source_by_sha(digest)
        if existing:
            job_id = self.store.job_for_source(existing["id"])
            if job_id is None:
                job_id = self.store.create_job_for_existing_source(existing["id"])
            return self._upload_response(job_id, exact_duplicate=True)
        inspection = self._with_similarity_findings(inspection)

        extension = f".{inspection.source_format}"
        source_id = f"src-{digest}"
        relative_path = Path(".route-studio") / "sources" / digest[:2] / digest / f"source{extension}"
        source_path = self.root / relative_path
        source_path.parent.mkdir(parents=True, exist_ok=True)
        try:
            descriptor = os.open(source_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o444)
        except FileExistsError as error:
            raise StudioError("immutable source path already exists") from error
        with os.fdopen(descriptor, "wb") as source_file:
            source_file.write(payload)
            source_file.flush()
            os.fsync(source_file.fileno())
        os.chmod(source_path, 0o444)
        source = {
            "id": source_id,
            "sha256": digest,
            "original_filename": safe_filename,
            "stored_path": relative_path.as_posix(),
            "source_format": inspection.source_format,
        }
        try:
            job_id = self.store.create_source_job(
                source,
                inspection.as_dict(),
                inspection.selected_geometry_id,
            )
        except Exception:
            source_path.unlink(missing_ok=True)
            raise
        return self._upload_response(job_id, exact_duplicate=False)

    def list_jobs(self):
        return self.store.list_jobs()

    def get_job(self, job_id):
        job = self.store.get_job(job_id)
        if not job:
            raise StudioNotFound(f"Studio job {job_id} was not found")
        return job

    def events(self, job_id):
        return self.get_job(job_id)["events"]

    def staged_route(self, job_id):
        route = self.get_job(job_id)["staged_route"]
        if route is None:
            raise StudioConflict("Studio job has not been compiled")
        return route

    def select_geometry(self, job_id, candidate_id):
        job, inspection = self._inspection(job_id)
        self._ensure_mutable(job)
        candidate_by_id(inspection, candidate_id)
        try:
            self.store.select_geometry(job_id, candidate_id)
        except StudioStateConflict as error:
            raise StudioConflict(str(error)) from error
        self._discard_job_artifacts(job_id)
        return self.get_job(job_id)

    def set_metadata(self, job_id, value):
        job, inspection = self._inspection(job_id)
        self._ensure_mutable(job)
        if not job["selected_geometry_id"]:
            raise StudioConflict("Select one route geometry before recording metadata")
        candidate = candidate_by_id(inspection, job["selected_geometry_id"])
        metadata = self._validate_metadata(value, candidate)
        try:
            self.store.save_metadata(job_id, metadata, job["selected_geometry_id"])
        except StudioStateConflict as error:
            raise StudioConflict(str(error)) from error
        self._discard_job_artifacts(job_id)
        return self.get_job(job_id)

    def compile(self, job_id):
        job, inspection = self._inspection(job_id)
        self._ensure_mutable(job)
        if not job["selected_geometry_id"]:
            raise StudioConflict("Select one route geometry before compiling")
        if job["metadata"] is None:
            raise StudioConflict("Record route metadata before compiling")
        candidate = candidate_by_id(inspection, job["selected_geometry_id"])
        receipt = self._receipt(job, candidate)
        route, fingerprint = compile_route(candidate, job["metadata"], receipt)
        try:
            self.store.save_staged_route(
                job_id,
                route,
                fingerprint,
                job["metadata"],
                job["selected_geometry_id"],
            )
        except StudioStateConflict as error:
            raise StudioConflict(str(error)) from error
        return route

    def promote(self, job_id, *, rebuild):
        job, inspection = self._inspection(job_id)
        self._ensure_mutable(job)
        staged = job["staged_route"]
        if staged is None:
            raise StudioConflict("Compile the staged route before promotion")
        candidate = candidate_by_id(inspection, job["selected_geometry_id"])
        slug = staged["slug"]
        source_relative = Path("route_sources") / "studio" / f"{slug}.gpx"
        receipt_relative = Path("route_sources") / "receipts" / f"{slug}.json"
        source_path = self.root / source_relative
        receipt_path = self.root / receipt_relative
        durable_relative = Path("studio") / f"{slug}.gpx"
        durable_path = self.durable_source_root / durable_relative
        config_path = self.root / "quests.json"
        original_config = config_path.read_text(encoding="utf-8")
        if source_path.exists() or receipt_path.exists() or durable_path.exists():
            raise StudioConflict(f"canonical source for {slug} already exists")
        config = json.loads(original_config)
        routes = config.setdefault("routes", [])
        if any(str(route.get("route_id") or route.get("activity_id")) == slug for route in routes):
            raise StudioConflict(f"route identity {slug} already exists")
        backup_path = self._create_promotion_backup(job_id, original_config)
        journal = {
            "backup_path": str(backup_path.relative_to(self.root)),
            "source_path": str(source_path.relative_to(self.root)),
            "receipt_path": str(receipt_path.relative_to(self.root)),
            "durable_path": str(durable_path),
        }
        try:
            self.store.start_promotion(job_id, journal, job["route_fingerprint"])
        except StudioStateConflict as error:
            self._remove_promotion_backup(backup_path)
            raise StudioConflict(str(error)) from error
        try:
            source_path.parent.mkdir(parents=True, exist_ok=True)
            receipt_path.parent.mkdir(parents=True, exist_ok=True)
            canonical_source = canonical_gpx(
                candidate,
                name=job["metadata"]["name"],
                preserve_timing=candidate.timing_status == "recorded",
            )
            self._write_bytes_atomic(source_path, canonical_source)
            self._write_bytes_atomic(durable_path, canonical_source)
            canonical_checksum = hashlib.sha256(canonical_source).hexdigest()
            write_atomic(
                receipt_path,
                json.dumps(staged["source_receipt"], indent=2) + "\n",
            )
            spec = {
                "route_id": slug,
                "source_gpx": source_relative.as_posix(),
                "source_receipt": receipt_relative.as_posix(),
                "source_backup": durable_relative.as_posix(),
                "source_policy": PRIVATE_DURABLE_BACKUP,
                "canonical_source_sha256": canonical_checksum,
                "source_kind": "owner-import",
                "source_format": staged["source_format"],
                "source_sha256": job["source"]["sha256"],
                "elevation_status": staged["provenance"]["elevation"]["status"],
                "activity_name": job["metadata"]["name"],
                "activity_type": job["metadata"]["activity_type"],
                "date": job["metadata"]["date"],
                "region": job["metadata"]["region"],
                "lifecycle": staged["lifecycle"],
                "privacy": job["metadata"]["privacy"],
                "visibility": "hidden" if job["metadata"]["privacy"] == "private" else "public",
                "status": "approved",
            }
            routes.append(spec)
            write_atomic(config_path, json.dumps(config, indent=2) + "\n")
            rebuild()
            self._verify_promotion(staged, job["metadata"]["privacy"])
        except StudioConflict as error:
            self._restore_promotion_backup(
                backup_path, source_path, receipt_path, durable_path
            )
            self.store.mark_promotion_failed(job_id, str(error))
            self._remove_promotion_backup(backup_path)
            raise
        except Exception as error:
            self._restore_promotion_backup(
                backup_path, source_path, receipt_path, durable_path
            )
            self.store.mark_promotion_failed(job_id, str(error))
            self._remove_promotion_backup(backup_path)
            raise StudioError("Canonical generation failed; promotion was rolled back and the staged route is intact.") from error
        self.store.mark_promoted(job_id)
        self._remove_promotion_backup(backup_path)
        return self.get_job(job_id)

    def cancel(self, job_id):
        self.get_job(job_id)
        self.store.request_cancel(job_id)
        with self._render_lock:
            process = self._render_processes.get(job_id)
        if process is not None and process.poll() is None:
            self._terminate_process_group(process)
        return self.get_job(job_id)

    def render(self, job_id, *, base_url="http://127.0.0.1:8787"):
        job = self.get_job(job_id)
        self._ensure_mutable(job)
        if job["staged_route"] is None:
            raise StudioConflict("Compile the staged route before rendering")
        if any(attempt["status"] == "running" for attempt in job["render_attempts"]):
            raise StudioConflict("A render is already running for this Studio job")
        route_fingerprint = job["route_fingerprint"]
        version_path = self.root / "app" / "src" / "surfaces" / "replay" / "cinematic" / "route-experience-version.json"
        if not version_path.is_file():
            version_path = Path(__file__).parent / "app" / "src" / "surfaces" / "replay" / "cinematic" / "route-experience-version.json"
        versions = json.loads(version_path.read_text(encoding="utf-8"))
        manifest_version = int(versions["manifestVersion"])
        director_version = int(versions["directorVersion"])
        render_fingerprint = hashlib.sha256(
            f"{route_fingerprint}|teaser|manifest-{manifest_version}|director-{director_version}|1920x1080|24|17.5".encode("ascii")
        ).hexdigest()
        attempt_id = f"render-{uuid.uuid4().hex[:16]}"
        artifact_root = self.state_root / "artifacts" / job_id
        artifact_root.mkdir(parents=True, exist_ok=True)
        output_path = artifact_root / "teaser.mp4"
        report_path = artifact_root / "teaser.report.json"
        command = [
            "node",
            str(self.root / "app" / "scripts" / "render-route-film.mjs"),
            f"--route={job['staged_route']['slug']}",
            f"--film-url={base_url}/#/admin/studio/{job_id}/preview?render=1",
            f"--output={output_path}",
            f"--report={report_path}",
            f"--source-fingerprint={render_fingerprint}",
            f"--manifest-version={manifest_version}",
            f"--director-version={director_version}",
            "--width=1920",
            "--height=1080",
            "--fps=24",
            "--max-seconds=17.5",
            "--proxy=false",
            "--resume=true",
        ]
        try:
            self.store.start_render(
                job_id, attempt_id, render_fingerprint, job["route_fingerprint"]
            )
        except StudioStateConflict as error:
            raise StudioConflict(str(error)) from error
        thread = threading.Thread(
            target=self._run_render,
            args=(job_id, attempt_id, command, output_path, report_path),
            daemon=True,
        )
        with self._render_lock:
            self._render_threads[job_id] = thread
            thread.start()
        return self.get_job(job_id)

    def retry(self, job_id, *, base_url="http://127.0.0.1:8787", rebuild=None):
        job = self.get_job(job_id)
        if job["status"] == "promotion_failed":
            if rebuild is None:
                raise StudioConflict("Promotion retry requires the canonical generator")
            return self.promote(job_id, rebuild=rebuild)
        if not job["retryable"] and job["status"] not in ("render_interrupted", "render_failed"):
            raise StudioConflict("Studio job has no retryable operation")
        return self.render(job_id, base_url=base_url)

    def delete(self, job_id):
        self._ensure_mutable(self.get_job(job_id))
        try:
            deleted = self.store.delete_job(job_id)
        except StudioStateConflict as error:
            raise StudioConflict(str(error)) from error
        if not deleted:
            raise StudioNotFound(f"Studio job {job_id} was not found")
        self._discard_job_artifacts(job_id)

    def _run_render(self, job_id, attempt_id, command, output_path, report_path):
        evidence = {"command": command, "provider_policy": "local-owner-only"}
        try:
            process = subprocess.Popen(
                command,
                cwd=self.root / "app",
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                start_new_session=True,
            )
            with self._render_lock:
                self._render_processes[job_id] = process
            if self._closing.is_set() or self.get_job(job_id)["cancellation_requested"]:
                self._terminate_process_group(process)
            output_tail = []
            for line in process.stdout or ():
                output_tail.append(line.rstrip())
                output_tail = output_tail[-40:]
                match = re.search(r"Verified\s+(\d+)s\s*/\s*(\d+)s", line)
                if match and int(match.group(2)) > 0:
                    self.store.update_render(
                        attempt_id,
                        status="running",
                        progress=min(0.95, int(match.group(1)) / int(match.group(2))),
                        evidence={"output_tail": output_tail},
                    )
            exit_code = process.wait()
            cancelled = self.get_job(job_id)["cancellation_requested"]
            if cancelled:
                self.store.update_render(
                    attempt_id, status="cancelled", progress=0, evidence={"output_tail": output_tail}
                )
            elif exit_code != 0:
                self.store.update_render(
                    attempt_id, status="failed", progress=0, evidence={"exit_code": exit_code, "output_tail": output_tail}
                )
            else:
                if report_path.is_file():
                    evidence.update(json.loads(report_path.read_text(encoding="utf-8")))
                self.store.update_render(
                    attempt_id,
                    status="complete",
                    progress=1,
                    output_path=str(output_path.relative_to(self.root)),
                    artifact_sha256=self._file_sha256(output_path),
                    evidence=evidence,
                )
        except Exception as error:
            self.store.update_render(
                attempt_id,
                status="failed",
                progress=0,
                evidence={"error": str(error)},
            )
        finally:
            with self._render_lock:
                self._render_processes.pop(job_id, None)
                self._render_threads.pop(job_id, None)

    @staticmethod
    def _terminate_process_group(process):
        if process.poll() is not None:
            return
        try:
            os.killpg(process.pid, signal.SIGTERM)
            process.wait(timeout=5)
        except ProcessLookupError:
            return
        except subprocess.TimeoutExpired:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                return
            process.wait(timeout=5)

    def _inspection(self, job_id):
        job = self.get_job(job_id)
        source_path = self.root / job["source"]["stored_path"]
        payload = source_path.read_bytes()
        if hashlib.sha256(payload).hexdigest() != job["source"]["sha256"]:
            raise StudioError("preserved source checksum no longer matches its receipt")
        try:
            inspection = inspect_source(job["source"]["original_filename"], payload)
        except SourceImportError as error:
            raise StudioError(f"preserved source can no longer be inspected: {error}") from error
        return job, inspection

    def _receipt(self, job, candidate):
        return {
            "source_id": job["source"]["id"],
            "sha256": job["source"]["sha256"],
            "original_filename": job["source"]["original_filename"],
            "detected_format": job["source"]["source_format"],
            "importer_version": IMPORTER_VERSION,
            "selected_geometry": {
                "id": candidate.id,
                "label": candidate.label,
                "geometry_kind": candidate.geometry_kind,
            },
            "source_metadata": job["inspection"]["source_metadata"],
            "warnings": [
                finding for finding in job["inspection"]["findings"]
                if finding["severity"] == "warning"
            ],
            "source_elevation_availability": candidate.elevation_status,
            "source_timing_availability": candidate.timing_status,
            "canonical_geometry_fingerprint": candidate.geometry_fingerprint,
        }

    def _verify_promotion(self, staged, privacy):
        slug = staged["slug"]
        detail_path = self.root / "app" / "public" / "data" / "routes" / f"{slug}.json"
        manifest_path = self.root / "app" / "src" / "data" / "generated" / "routes.manifest.json"
        if not manifest_path.is_file():
            raise StudioError("canonical generator did not produce the route manifest")
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        manifest_routes = manifest.get("routes", [])
        manifest_matches = [route for route in manifest_routes if route.get("slug") == slug]
        if privacy == "private":
            if detail_path.exists() or manifest_matches:
                raise StudioError("private route appeared in public generated route data")
            private_matches = [
                route for route in self.owner_routes()
                if route.get("slug") == slug
            ]
            if len(private_matches) != 1:
                raise StudioError("private route did not enter the owner read model")
            if (
                self._geometry_signature(private_matches[0].get("route"))
                != self._geometry_signature(staged.get("route"))
            ):
                raise StudioError(
                    "private owner read-model geometry does not match the staged route"
                )
            return
        if not detail_path.is_file() or len(manifest_matches) != 1:
            raise StudioError("canonical generator did not publish one matching detail and manifest record")
        detail = json.loads(detail_path.read_text(encoding="utf-8"))
        contract_fields = (
            "slug", "route_id", "identity_kind", "source_kind", "source_format",
            "name", "subtitle", "activity_name", "region", "date", "type",
            "description", "distance_km", "elevation_gain_m", "lifecycle",
            "difficulty", "theme", "xp", "completion_rule", "quest_blurb", "mid_idx",
        )
        for field in contract_fields:
            if detail.get(field) != staged.get(field):
                raise StudioError(f"generated {field} does not match the staged route")
        manifest_route = manifest_matches[0]
        manifest_fields = tuple(field for field in contract_fields if field not in ("mid_idx", "quest_blurb"))
        for field in manifest_fields:
            if manifest_route.get(field) != staged.get(field):
                raise StudioError(f"manifest {field} does not match the staged route")
        if self._geometry_signature(detail.get("route")) != self._geometry_signature(staged.get("route")):
            raise StudioError("generated geometry does not match the staged route")
        if manifest_route.get("trace") != self._manifest_trace(detail.get("route")):
            raise StudioError("manifest trace does not match generated geometry")
        if detail.get("replay") != staged.get("replay") or manifest_route.get("replay") != staged.get("replay"):
            raise StudioError("generated replay contract does not match the staged route")
        for field in ("center_lat", "center_lng"):
            try:
                expected = round(float(staged[field]), 7)
                actual_detail = round(float(detail[field]), 7)
                actual_manifest = round(float(manifest_route[field]), 7)
            except (KeyError, TypeError, ValueError):
                raise StudioError(f"generated {field} is missing or invalid") from None
            if actual_detail != expected or actual_manifest != expected:
                raise StudioError(f"generated {field} does not match the staged route")
        expected_elevation = staged["provenance"]["elevation"]["status"]
        actual_elevation = detail.get("provenance", {}).get("elevation", {}).get("status")
        if actual_elevation != expected_elevation:
            raise StudioError("generated elevation provenance does not match the staged route")
        expected_temporal = staged["provenance"]["temporal"]["status"]
        actual_temporal = detail.get("provenance", {}).get("temporal", {}).get("status")
        if actual_temporal != expected_temporal:
            raise StudioError("generated temporal provenance does not match the staged route")
        if detail.get("provenance", {}).get("temporal") != staged["provenance"]["temporal"]:
            raise StudioError("generated temporal contract does not match the staged route")
        expected_segments = staged["provenance"]["track"].get("segment_count")
        actual_segments = detail.get("provenance", {}).get("track", {}).get("segment_count")
        if actual_segments != expected_segments:
            raise StudioError("generated track segmentation does not match the staged route")

    @staticmethod
    def _geometry_signature(route):
        if not isinstance(route, list):
            return None
        try:
            return tuple(
                (
                    round(float(point["lat"]), 7),
                    round(float(point["lng"]), 7),
                    (
                        round(float(point["elev"]), 2)
                        if point.get("elev") is not None
                        else None
                    ),
                    round(float(point["d"]), 1),
                    point.get("elapsed_s"),
                )
                for point in route
            )
        except (KeyError, TypeError, ValueError):
            return None

    @staticmethod
    def _manifest_trace(route, max_points=96):
        if not isinstance(route, list):
            return None
        if len(route) <= max_points:
            simplified = route
        else:
            last = len(route) - 1
            simplified = [
                route[round(index * last / (max_points - 1))]
                for index in range(max_points)
            ]
        try:
            return [
                [point["lat"], point["lng"], point.get("elev"), point.get("d", 0)]
                for point in simplified
            ]
        except (KeyError, TypeError):
            return None

    def _snapshot_publication(self):
        details = self.root / "app" / "public" / "data" / "routes"
        files = (
            self.root / "app" / "src" / "data" / "quests.generated.json",
            self.root / "app" / "src" / "data" / "generated" / "routes.manifest.json",
            self.root / "app" / "src" / "data" / "generated" / "route-stats.json",
        )
        detail_files = None
        if details.is_dir():
            detail_files = {
                path.relative_to(details): path.read_bytes()
                for path in details.rglob("*") if path.is_file()
            }
        return {
            "details": detail_files,
            "files": {path: path.read_bytes() if path.is_file() else None for path in files},
        }

    def _create_promotion_backup(self, job_id, original_config):
        backup = self.state_root / "promotion-backups" / job_id
        if backup.exists():
            shutil.rmtree(backup)
        backup.mkdir(parents=True)
        (backup / "quests.json").write_text(original_config, encoding="utf-8")
        snapshot = self._snapshot_publication()
        details = snapshot["details"]
        if details is not None:
            for relative, payload in details.items():
                target = backup / "routes" / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(payload)
        metadata = {"details_present": details is not None, "files": {}}
        for index, (path, payload) in enumerate(snapshot["files"].items()):
            metadata["files"][str(path.relative_to(self.root))] = payload is not None
            if payload is not None:
                (backup / f"generated-{index}.bin").write_bytes(payload)
        (backup / "metadata.json").write_text(
            json.dumps(metadata, separators=(",", ":")), encoding="utf-8"
        )
        return backup

    def _restore_promotion_backup(
        self, backup, source_path, receipt_path, durable_path=None
    ):
        metadata = json.loads((backup / "metadata.json").read_text(encoding="utf-8"))
        write_atomic(
            self.root / "quests.json",
            (backup / "quests.json").read_text(encoding="utf-8"),
        )
        source_path.unlink(missing_ok=True)
        receipt_path.unlink(missing_ok=True)
        if durable_path is not None:
            durable_path.unlink(missing_ok=True)
        files = {}
        for index, (relative, present) in enumerate(metadata["files"].items()):
            path = self.root / relative
            files[path] = (backup / f"generated-{index}.bin").read_bytes() if present else None
        details = None
        if metadata["details_present"]:
            route_backup = backup / "routes"
            details = {
                path.relative_to(route_backup): path.read_bytes()
                for path in route_backup.rglob("*") if path.is_file()
            }
        self._restore_publication({"details": details, "files": files})

    @staticmethod
    def _remove_promotion_backup(backup):
        if backup.is_dir():
            shutil.rmtree(backup)

    def _recover_interrupted_promotions(self):
        for job_id, journal in self.store.interrupted_promotions():
            try:
                backup = (self.root / journal["backup_path"]).resolve()
                source_path = (self.root / journal["source_path"]).resolve()
                receipt_path = (self.root / journal["receipt_path"]).resolve()
                durable_path = Path(journal.get("durable_path", "")).resolve()
                backup_root = (self.state_root / "promotion-backups").resolve()
                if (
                    not backup.is_relative_to(backup_root)
                    or not source_path.is_relative_to(self.root)
                    or not receipt_path.is_relative_to(self.root)
                    or (
                        journal.get("durable_path")
                        and not durable_path.is_relative_to(self.durable_source_root)
                    )
                ):
                    raise StudioError("promotion journal path escaped the checkout")
                self._restore_promotion_backup(
                    backup,
                    source_path,
                    receipt_path,
                    durable_path if journal.get("durable_path") else None,
                )
                self.store.mark_promotion_interrupted(job_id)
                self._remove_promotion_backup(backup)
            except Exception as error:
                raise StudioError(
                    f"interrupted promotion {job_id} could not restore its rollback journal: {error}"
                ) from error

    def _restore_publication(self, snapshot):
        details = self.root / "app" / "public" / "data" / "routes"
        detail_files = snapshot["details"]
        if detail_files is None:
            if details.exists():
                shutil.rmtree(details)
        else:
            staged = details.with_name(f".routes-studio-restore-{uuid.uuid4().hex}")
            replaced = details.with_name(f".routes-studio-replaced-{uuid.uuid4().hex}")
            staged.mkdir(parents=True)
            for relative, payload in detail_files.items():
                target = staged / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(payload)
            if details.exists():
                os.replace(details, replaced)
            os.replace(staged, details)
            if replaced.exists():
                shutil.rmtree(replaced)
        for path, payload in snapshot["files"].items():
            if payload is None:
                path.unlink(missing_ok=True)
                continue
            temporary = path.with_name(f".{path.name}.studio-restore-{uuid.uuid4().hex}")
            temporary.parent.mkdir(parents=True, exist_ok=True)
            temporary.write_bytes(payload)
            os.replace(temporary, path)

    @staticmethod
    def _ensure_mutable(job):
        if job["status"] in ("promoted", "rendering", "promoting"):
            raise StudioConflict(f"Studio job cannot be edited while {job['status']}")

    def _discard_job_artifacts(self, job_id):
        artifact_root = self.state_root / "artifacts" / job_id
        if artifact_root.is_dir():
            shutil.rmtree(artifact_root)

    @staticmethod
    def _file_sha256(path):
        digest = hashlib.sha256()
        with path.open("rb") as source:
            for chunk in iter(lambda: source.read(1024 * 1024), b""):
                digest.update(chunk)
        return digest.hexdigest()

    @staticmethod
    def _write_bytes_atomic(path, payload):
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_name(f".{path.name}.studio-{uuid.uuid4().hex}")
        temporary.write_bytes(payload)
        os.replace(temporary, path)

    @staticmethod
    def _validate_metadata(value, candidate):
        if not isinstance(value, dict):
            raise StudioError("metadata must be an object")
        name = value.get("name")
        activity_type = value.get("activity_type")
        completed = value.get("completed_by_owner")
        region = value.get("region")
        privacy = value.get("privacy", "private")
        date_value = value.get("date", "")
        if not isinstance(name, str) or not name.strip():
            raise StudioError("route name is required")
        if activity_type not in ("Run", "Ride"):
            raise StudioError("activity_type must be Run or Ride")
        if not isinstance(completed, bool):
            raise StudioError("completed_by_owner must be explicitly confirmed")
        if not isinstance(region, str) or not region.strip():
            raise StudioError("place or region confirmation is required")
        if privacy not in ("private", "public"):
            raise StudioError("privacy must be private or public")
        if date_value:
            if not isinstance(date_value, str):
                raise StudioError("date must use YYYY-MM-DD")
            try:
                parsed_date = date.fromisoformat(date_value)
            except ValueError as error:
                raise StudioError("date must use YYYY-MM-DD") from error
            if parsed_date.isoformat() != date_value:
                raise StudioError("date must use YYYY-MM-DD")
        if completed and not date_value:
            if candidate.timing_status != "recorded":
                raise StudioError("completed routes require a date when the source has no recorded time")
            date_value = candidate.points[0].timestamp.date().isoformat()
        return {
            "name": name.strip(),
            "activity_type": activity_type,
            "completed_by_owner": completed,
            "date": date_value,
            "region": region.strip(),
            "privacy": privacy,
        }

    def _upload_response(self, job_id, *, exact_duplicate):
        job = self.get_job(job_id)
        return {
            "job_id": job_id,
            "exact_duplicate": exact_duplicate,
            "source": job["source"],
            "inspection": job["inspection"],
            "status": job["status"],
        }

    def _with_similarity_findings(self, inspection):
        findings = list(inspection.findings)
        existing_candidates = [
            (source_id, candidate)
            for source_id, stored in self.store.source_inspections()
            for candidate in stored.get("candidates", [])
        ]
        existing_candidates.extend(self._canonical_route_candidates())
        for candidate in inspection.candidates:
            for source_id, existing in existing_candidates:
                existing_fingerprint = existing.get("geometry_fingerprint")
                if candidate.geometry_fingerprint == existing_fingerprint:
                    findings.append(Finding(
                        "warning", "exact-geometry-duplicate",
                        f"{candidate.label} matches geometry already preserved as {source_id}.",
                    ))
                    break
                if candidate.reverse_geometry_fingerprint == existing_fingerprint:
                    findings.append(Finding(
                        "warning", "reversed-route",
                        f"{candidate.label} matches an existing route in reverse.",
                    ))
                    break
                existing_distance = existing.get("distance_m")
                if isinstance(existing_distance, (int, float)) and max(existing_distance, candidate.distance_m, 1) > 0:
                    difference = abs(existing_distance - candidate.distance_m) / max(existing_distance, candidate.distance_m, 1)
                    if difference <= 0.02:
                        findings.append(Finding(
                            "information", "similar-distance",
                            f"{candidate.label} is within 2% of an existing route distance; compare the map before promotion.",
                        ))
                        break
        return SourceInspection(
            source_format=inspection.source_format,
            candidates=inspection.candidates,
            selected_geometry_id=inspection.selected_geometry_id,
            findings=tuple(findings),
            source_metadata=inspection.source_metadata,
        )

    def _canonical_route_candidates(self):
        candidates = []
        source_backed_slugs = set()
        try:
            specs = json.loads((self.root / "quests.json").read_text(encoding="utf-8")).get("routes", [])
        except (AttributeError, OSError, UnicodeDecodeError, json.JSONDecodeError):
            specs = []
        for spec in specs:
            if not isinstance(spec, dict) or not isinstance(spec.get("source_gpx"), str):
                continue
            source_path = (self.root / spec["source_gpx"]).resolve()
            source_root = (self.root / "route_sources").resolve()
            if not source_path.is_relative_to(source_root) or not source_path.is_file():
                continue
            slug = str(spec.get("route_id") or spec.get("activity_id") or source_path.stem)
            try:
                source_inspection = inspect_source(source_path.name, source_path.read_bytes())
            except (OSError, SourceImportError):
                continue
            source_backed_slugs.add(slug)
            candidates.extend(
                (f"canonical:{slug}", candidate.as_dict())
                for candidate in source_inspection.candidates
            )
        route_root = self.root / "app" / "public" / "data" / "routes"
        for path in route_root.glob("*.json"):
            try:
                detail = json.loads(path.read_text(encoding="utf-8"))
                slug = str(detail.get("slug", path.stem))
                if slug in source_backed_slugs:
                    continue
                points = detail["route"]
                fingerprint_payload = "|".join(
                    f"0:{float(point['lat']):.7f},{float(point['lng']):.7f}"
                    for point in points
                ).encode("ascii")
                distance_m = float(points[-1]["d"]) if points else 0.0
            except (KeyError, OSError, TypeError, UnicodeDecodeError, ValueError, json.JSONDecodeError):
                continue
            candidates.append((
                f"canonical:{slug}",
                {
                    "geometry_fingerprint": hashlib.sha256(fingerprint_payload).hexdigest(),
                    "distance_m": distance_m,
                },
            ))
        return candidates
