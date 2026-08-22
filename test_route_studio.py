import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import MagicMock, patch
import signal
import zipfile

from route_studio import RouteStudio, StudioConflict, StudioError
from route_studio_compiler import compile_route as compile_studio_route
from route_studio_importers import ImportError as SourceImportError, ImportSecurityError, inspect_source
from route_studio_store import StudioStateConflict


FIXTURES = Path(__file__).parent / "tests" / "fixtures" / "route-studio"


def fixture(name):
    return (FIXTURES / name).read_bytes()


def kmz_bytes(entries):
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w") as archive:
        for name, payload in entries.items():
            archive.writestr(name, payload)
    return stream.getvalue()


class RouteStudioImporterTests(unittest.TestCase):
    def test_source_detection_rejects_extension_content_mismatches(self):
        with self.assertRaisesRegex(SourceImportError, "GPX document"):
            inspect_source("route.gpx", fixture("simple-line.kml"))
        with self.assertRaisesRegex(SourceImportError, "supported route formats"):
            inspect_source("route.txt", fixture("simple.gpx"))

    def test_simple_gpx_preserves_recorded_elevation_and_geometry(self):
        receipt = inspect_source("simple.gpx", fixture("simple.gpx"))

        self.assertEqual(receipt.source_format, "gpx")
        self.assertEqual(len(receipt.candidates), 1)
        self.assertEqual(receipt.candidates[0].point_count, 3)
        self.assertEqual(receipt.candidates[0].segment_count, 1)
        self.assertEqual(receipt.candidates[0].elevation_status, "recorded")
        self.assertEqual(receipt.candidates[0].timing_status, "unavailable")

    def test_multiple_kml_lines_require_explicit_selection(self):
        receipt = inspect_source("alternatives.kml", fixture("multiple-lines.kml"))

        self.assertEqual(len(receipt.candidates), 2)
        self.assertIsNone(receipt.selected_geometry_id)
        self.assertTrue(any(item.code == "multiple-geometries" for item in receipt.findings))

    def test_gpx_tracks_and_segments_are_not_flattened(self):
        receipt = inspect_source("segments.gpx", fixture("multi-segment.gpx"))

        self.assertEqual(len(receipt.candidates), 1)
        self.assertEqual(receipt.candidates[0].segment_count, 2)

    def test_multiple_gpx_tracks_require_explicit_selection(self):
        receipt = inspect_source("options.gpx", fixture("multiple-tracks.gpx"))

        self.assertEqual(len(receipt.candidates), 2)
        self.assertIsNone(receipt.selected_geometry_id)

    def test_gx_track_preserves_recorded_timing_and_elevation(self):
        candidate = inspect_source("timed.kml", fixture("gx-track.kml")).candidates[0]

        self.assertEqual(candidate.geometry_kind, "gx-track")
        self.assertEqual(candidate.timing_status, "recorded")
        self.assertEqual(candidate.elevation_status, "recorded")

    def test_missing_elevation_and_time_remain_unavailable(self):
        receipt = inspect_source("plain.gpx", fixture("without-elevation-time.gpx"))

        candidate = receipt.candidates[0]
        self.assertEqual(candidate.elevation_status, "unavailable")
        self.assertEqual(candidate.timing_status, "unavailable")
        self.assertIsNone(candidate.ascent_m)

    def test_missing_timestamps_remain_unavailable_when_elevation_is_recorded(self):
        candidate = inspect_source("untimed.gpx", fixture("without-timestamps.gpx")).candidates[0]

        self.assertEqual(candidate.timing_status, "unavailable")
        self.assertEqual(candidate.elevation_status, "recorded")

    def test_malformed_xml_and_entity_declarations_are_rejected(self):
        with self.assertRaisesRegex(SourceImportError, "malformed"):
            inspect_source("bad.gpx", fixture("malformed.gpx"))
        with self.assertRaises(ImportSecurityError):
            inspect_source("entity.gpx", b'<!DOCTYPE gpx [<!ENTITY x SYSTEM "file:///etc/passwd">]><gpx>&x;</gpx>')
        with self.assertRaises(ImportSecurityError):
            inspect_source(
                "padded.gpx",
                b"<gpx>" + b" " * 5000 + b'<!DOCTYPE gpx [<!ENTITY x "expanded">]>&x;</gpx>',
            )

    def test_kmz_rejects_zip_slip_and_nested_archives(self):
        with self.assertRaises(ImportSecurityError):
            inspect_source("unsafe.kmz", kmz_bytes({"../route.kml": b"<kml/>"}))
        with self.assertRaises(ImportSecurityError):
            inspect_source("nested.kmz", kmz_bytes({"route.zip": b"not a zip"}))

    def test_kmz_caps_entry_count_and_uncompressed_bytes(self):
        with self.assertRaisesRegex(ImportSecurityError, "too many entries"):
            inspect_source("crowded.kmz", kmz_bytes({f"item-{index}.txt": b"x" for index in range(65)}))
        with self.assertRaisesRegex(ImportSecurityError, "uncompressed size"):
            inspect_source("large.kmz", kmz_bytes({"route.kml": b" " * (20 * 1024 * 1024 + 1)}))

    def test_kmz_surfaces_every_kml_candidate_without_fetching_resources(self):
        receipt = inspect_source(
            "routes.kmz",
            kmz_bytes({
                "one.kml": fixture("simple-line.kml"),
                "two.kml": fixture("multiple-lines.kml"),
                "photo.jpg": b"not inspected",
            }),
        )

        self.assertEqual(receipt.source_format, "kmz")
        self.assertEqual(len(receipt.candidates), 3)
        self.assertIsNone(receipt.selected_geometry_id)


class RouteStudioWorkflowTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.durable_source_root = self.root / "durable-route-sources"
        (self.root / "quests.json").write_text('{"routes": []}\n', encoding="utf-8")
        self.studio = RouteStudio(
            self.root,
            durable_source_root=self.durable_source_root,
        )

    def tearDown(self):
        self.studio.close()
        self.temporary.cleanup()

    def test_duplicate_upload_is_idempotent_and_source_is_immutable(self):
        first = self.studio.upload("first.gpx", fixture("simple.gpx"))
        second = self.studio.upload("renamed.gpx", fixture("simple.gpx"))

        self.assertEqual(first["job_id"], second["job_id"])
        self.assertTrue(second["exact_duplicate"])
        source_path = self.root / first["source"]["stored_path"]
        self.assertEqual(source_path.read_bytes(), fixture("simple.gpx"))
        self.assertFalse(bool(source_path.stat().st_mode & 0o222))

    def test_deleted_job_can_be_recreated_from_its_preserved_exact_source(self):
        first = self.studio.upload("first.gpx", fixture("simple.gpx"))
        source_path = self.root / first["source"]["stored_path"]
        self.studio.delete(first["job_id"])

        reopened = self.studio.upload("again.gpx", fixture("simple.gpx"))

        self.assertEqual(reopened["job_id"], first["job_id"])
        self.assertTrue(reopened["exact_duplicate"])
        self.assertTrue(source_path.is_file())
        self.assertEqual(self.studio.get_job(reopened["job_id"])["events"][0]["code"], "source-reopened")

    def test_preserved_source_checksum_is_verified_before_reinspection(self):
        uploaded = self.studio.upload("simple.gpx", fixture("simple.gpx"))
        source_path = self.root / uploaded["source"]["stored_path"]
        source_path.unlink()
        source_path.write_bytes(fixture("reversed.gpx"))

        with self.assertRaisesRegex(StudioError, "checksum"):
            self.studio.set_metadata(uploaded["job_id"], self._metadata(completed=False))

    def test_reversed_geometry_is_reported_without_becoming_an_exact_file_duplicate(self):
        self.studio.upload("first.gpx", fixture("simple.gpx"))
        reversed_upload = self.studio.upload("reversed.gpx", fixture("reversed.gpx"))

        self.assertFalse(reversed_upload["exact_duplicate"])
        self.assertTrue(any(
            finding["code"] == "reversed-route"
            for finding in reversed_upload["inspection"]["findings"]
        ))

    def test_upload_is_compared_with_existing_canonical_atlas_routes(self):
        candidate = inspect_source("simple.gpx", fixture("simple.gpx")).candidates[0]
        detail_path = self.root / "app" / "public" / "data" / "routes" / "published.json"
        detail_path.parent.mkdir(parents=True)
        detail_path.write_text(json.dumps({
            "slug": "published",
            "route": [
                {"lat": point.lat, "lng": point.lng, "d": index}
                for index, point in enumerate(candidate.points)
            ],
        }), encoding="utf-8")

        uploaded = self.studio.upload("simple.gpx", fixture("simple.gpx"))

        self.assertTrue(any(
            finding["code"] == "exact-geometry-duplicate"
            and "canonical:published" in finding["message"]
            for finding in uploaded["inspection"]["findings"]
        ))

    def test_canonical_source_is_used_when_published_geometry_is_simplified(self):
        source = self.root / "route_sources" / "studio" / "published.gpx"
        source.parent.mkdir(parents=True)
        source.write_bytes(fixture("simple.gpx"))
        (self.root / "quests.json").write_text(json.dumps({"routes": [{
            "route_id": "published",
            "source_gpx": "route_sources/studio/published.gpx",
        }]}), encoding="utf-8")
        detail = self.root / "app" / "public" / "data" / "routes" / "published.json"
        detail.parent.mkdir(parents=True)
        detail.write_text(json.dumps({
            "slug": "published",
            "route": [{"lat": 51, "lng": -114, "d": 0}],
        }), encoding="utf-8")

        uploaded = self.studio.upload("simple.gpx", fixture("simple.gpx"))

        self.assertTrue(any(
            finding["code"] == "exact-geometry-duplicate"
            and "canonical:published" in finding["message"]
            for finding in uploaded["inspection"]["findings"]
        ))

    def test_multi_geometry_must_be_selected_before_metadata_and_compile(self):
        uploaded = self.studio.upload("alternatives.kml", fixture("multiple-lines.kml"))
        job_id = uploaded["job_id"]

        with self.assertRaises(StudioConflict):
            self.studio.set_metadata(job_id, self._metadata(completed=False))

        candidate_id = uploaded["inspection"]["candidates"][1]["id"]
        self.studio.select_geometry(job_id, candidate_id)
        self.studio.set_metadata(job_id, self._metadata(completed=False))
        compiled = self.studio.compile(job_id)

        self.assertEqual(compiled["lifecycle"], "discovered")
        self.assertTrue(compiled["slug"].startswith("route-"))
        self.assertEqual(compiled["route_id"], compiled["slug"])
        self.assertNotIn("activity_id", compiled)
        self.assertEqual(compiled["source_kind"], "owner-import")
        self.assertEqual(compiled["source_format"], "kml")

    def test_completed_route_uses_recorded_time_only_when_source_has_it(self):
        uploaded = self.studio.upload("timed.gpx", fixture("timestamped.gpx"))
        job_id = uploaded["job_id"]
        self.studio.set_metadata(job_id, self._metadata(completed=True))
        compiled = self.studio.compile(job_id)

        self.assertEqual(compiled["lifecycle"], "completed")
        self.assertEqual(compiled["date"], "2026-08-01")
        self.assertEqual(compiled["provenance"]["temporal"]["status"], "recorded")
        self.assertTrue(all("elapsed_s" in point for point in compiled["route"]))

    def test_partial_timestamps_remain_unavailable_after_compilation(self):
        payload = b'''<gpx><trk><trkseg>
          <trkpt lat="51" lon="-114"><time>2026-08-01T14:00:00Z</time></trkpt>
          <trkpt lat="51.01" lon="-114.01" />
          <trkpt lat="51.02" lon="-114.02"><time>2026-08-01T14:10:00Z</time></trkpt>
        </trkseg></trk></gpx>'''
        uploaded = self.studio.upload("partial.gpx", payload)
        job_id = uploaded["job_id"]
        self.studio.set_metadata(job_id, self._metadata(completed=False))

        compiled = self.studio.compile(job_id)

        self.assertEqual(uploaded["inspection"]["candidates"][0]["timing_status"], "unavailable")
        self.assertEqual(compiled["provenance"]["temporal"]["status"], "unavailable")
        self.assertTrue(all("elapsed_s" not in point for point in compiled["route"]))

    def test_high_altitude_route_without_elevation_keeps_altitude_unavailable(self):
        payload = b'''<gpx><trk><trkseg>
          <trkpt lat="27.986" lon="86.922" />
          <trkpt lat="27.988" lon="86.925" />
          <trkpt lat="27.990" lon="86.928" />
        </trkseg></trk></gpx>'''
        uploaded = self.studio.upload("high-altitude.gpx", payload)
        self.studio.set_metadata(
            uploaded["job_id"],
            {
                **self._metadata(completed=False),
                "region": "Khumbu, Nepal",
            },
        )

        compiled = self.studio.compile(uploaded["job_id"])

        self.assertEqual(compiled["provenance"]["elevation"]["status"], "unavailable")
        self.assertTrue(all(point["elev"] is None for point in compiled["route"]))
        self.assertIn("Elevation is unavailable", compiled["completion_rule"])

    def test_geometry_or_metadata_edits_invalidate_compiled_and_render_state(self):
        uploaded = self.studio.upload("alternatives.kml", fixture("multiple-lines.kml"))
        job_id = uploaded["job_id"]
        first_id, second_id = [item["id"] for item in uploaded["inspection"]["candidates"]]
        self.studio.select_geometry(job_id, first_id)
        self.studio.set_metadata(job_id, self._metadata(completed=False))
        first = self.studio.compile(job_id)
        self.studio.store.start_render(job_id, "attempt-1", "render", self.studio.get_job(job_id)["route_fingerprint"])
        artifact = self.root / ".route-studio" / "artifacts" / job_id / "teaser.mp4"
        artifact.parent.mkdir(parents=True)
        artifact.write_bytes(b"render")
        self.studio.store.update_render(
            "attempt-1", status="complete", progress=1,
            output_path=str(artifact.relative_to(self.root)), artifact_sha256="c" * 64,
        )

        self.studio.select_geometry(job_id, second_id)
        selected = self.studio.get_job(job_id)
        self.assertIsNone(selected["metadata"])
        self.assertIsNone(selected["staged_route"])
        self.assertEqual(selected["render_attempts"], [])
        self.assertFalse(artifact.exists())

        self.studio.set_metadata(job_id, self._metadata(completed=True, date="2026-08-02"))
        second = self.studio.compile(job_id)
        self.assertNotEqual(first["route_id"], second["route_id"])
        self.studio.set_metadata(job_id, self._metadata(completed=False))
        self.assertIsNone(self.studio.get_job(job_id)["staged_route"])

    def test_restart_marks_inflight_render_retryable_and_preserves_events(self):
        uploaded = self.studio.upload("simple.gpx", fixture("simple.gpx"))
        job_id = uploaded["job_id"]
        self.studio.set_metadata(job_id, self._metadata(completed=False))
        self.studio.compile(job_id)
        self.studio.store.start_render(job_id, "attempt-1", "fingerprint", self.studio.get_job(job_id)["route_fingerprint"])
        self.studio.close()

        self.studio = RouteStudio(
            self.root,
            durable_source_root=self.durable_source_root,
        )
        job = self.studio.get_job(job_id)

        self.assertEqual(job["status"], "render_interrupted")
        self.assertTrue(job["retryable"])
        self.assertTrue(any(event["code"] == "render-interrupted" for event in job["events"]))

    def test_render_completion_persists_artifact_checksum_and_stage_history(self):
        uploaded = self.studio.upload("simple.gpx", fixture("simple.gpx"))
        job_id = uploaded["job_id"]
        self.studio.set_metadata(job_id, self._metadata(completed=False))
        self.studio.compile(job_id)
        self.studio.store.start_render(job_id, "attempt-1", "render-fingerprint", self.studio.get_job(job_id)["route_fingerprint"])
        self.studio.store.update_render(
            "attempt-1", status="complete", progress=1,
            output_path=".route-studio/artifacts/job/teaser.mp4",
            artifact_sha256="b" * 64, evidence={"verified_frames": 360},
        )

        job = self.studio.get_job(job_id)
        self.assertEqual(job["status"], "rendered")
        self.assertEqual(job["artifacts"][0]["sha256"], "b" * 64)
        self.assertEqual(job["stages"][0]["stage"], "inspection")

    def test_render_queues_the_staged_cinematic_preview_url(self):
        uploaded = self.studio.upload("simple.gpx", fixture("simple.gpx"))
        job_id = uploaded["job_id"]
        self.studio.set_metadata(job_id, self._metadata(completed=False))
        self.studio.compile(job_id)

        with patch("route_studio.threading.Thread") as thread:
            self.studio.render(job_id, base_url="http://127.0.0.1:8787")

        command = thread.call_args.kwargs["args"][2]
        self.assertIn(
            f"--film-url=http://127.0.0.1:8787/#/admin/studio/{job_id}/preview?render=1",
            command,
        )
        self.assertTrue(any(item.startswith("--source-fingerprint=") for item in command))
        self.assertIn("--manifest-version=2", command)
        self.assertIn("--director-version=2", command)
        self.assertIn("--max-seconds=17.5", command)

    def test_render_publishes_only_a_started_worker(self):
        uploaded = self.studio.upload("simple.gpx", fixture("simple.gpx"))
        job_id = uploaded["job_id"]
        self.studio.set_metadata(job_id, self._metadata(completed=False))
        self.studio.compile(job_id)

        def assert_start_is_atomic():
            acquired = self.studio._render_lock.acquire(blocking=False)
            if acquired:
                self.studio._render_lock.release()
            self.assertFalse(acquired)

        with patch("route_studio.threading.Thread") as thread:
            thread.return_value.start.side_effect = assert_start_is_atomic
            self.studio.render(job_id)

        thread.return_value.start.assert_called_once_with()

    def test_cancel_terminates_the_complete_render_process_group(self):
        uploaded = self.studio.upload("simple.gpx", fixture("simple.gpx"))
        job_id = uploaded["job_id"]
        self.studio.set_metadata(job_id, self._metadata(completed=False))
        self.studio.compile(job_id)
        self.studio.store.start_render(
            job_id, "attempt-1", "render", self.studio.get_job(job_id)["route_fingerprint"]
        )
        process = MagicMock(pid=4217)
        process.poll.return_value = None
        process.wait.return_value = 0
        self.studio._render_processes[job_id] = process

        with patch("route_studio.os.killpg") as kill_group:
            self.studio.cancel(job_id)

        kill_group.assert_called_once_with(4217, signal.SIGTERM)

    def test_cancel_before_process_registration_terminates_the_spawned_group(self):
        uploaded = self.studio.upload("simple.gpx", fixture("simple.gpx"))
        job_id = uploaded["job_id"]
        self.studio.set_metadata(job_id, self._metadata(completed=False))
        self.studio.compile(job_id)
        self.studio.store.start_render(
            job_id, "attempt-1", "render", self.studio.get_job(job_id)["route_fingerprint"]
        )
        self.studio.cancel(job_id)
        process = MagicMock(pid=4218, stdout=[])
        process.poll.return_value = None
        process.wait.return_value = -signal.SIGTERM

        with (
            patch("route_studio.subprocess.Popen", return_value=process),
            patch("route_studio.os.killpg") as kill_group,
        ):
            self.studio._run_render(
                job_id,
                "attempt-1",
                ["node", "render-route-film.mjs"],
                self.root / "teaser.mp4",
                self.root / "teaser.report.json",
            )

        kill_group.assert_called_once_with(4218, signal.SIGTERM)
        job = self.studio.get_job(job_id)
        self.assertEqual(job["status"], "staged")
        self.assertEqual(job["render_attempts"][0]["status"], "cancelled")

    def test_shutdown_before_process_registration_terminates_the_spawned_group(self):
        uploaded = self.studio.upload("simple.gpx", fixture("simple.gpx"))
        job_id = uploaded["job_id"]
        self.studio.set_metadata(job_id, self._metadata(completed=False))
        self.studio.compile(job_id)
        self.studio.store.start_render(
            job_id, "attempt-1", "render", self.studio.get_job(job_id)["route_fingerprint"]
        )
        process = MagicMock(pid=4219, stdout=[])
        process.poll.return_value = None
        process.wait.return_value = -signal.SIGTERM
        self.studio._closing.set()

        with (
            patch("route_studio.subprocess.Popen", return_value=process),
            patch("route_studio.os.killpg") as kill_group,
        ):
            self.studio._run_render(
                job_id,
                "attempt-1",
                ["node", "render-route-film.mjs"],
                self.root / "teaser.mp4",
                self.root / "teaser.report.json",
            )

        kill_group.assert_called_once_with(4219, signal.SIGTERM)

    def test_close_joins_render_workers_before_closing_sqlite(self):
        worker = MagicMock()
        self.studio._render_threads["job"] = worker
        with patch.object(self.studio.store, "close") as close_store:
            self.studio.close()
        worker.join.assert_called_once_with()
        close_store.assert_called_once_with()
        self.studio._render_threads.clear()

    def test_running_render_must_be_cancelled_before_edit_or_delete(self):
        uploaded = self.studio.upload("simple.gpx", fixture("simple.gpx"))
        job_id = uploaded["job_id"]
        self.studio.set_metadata(job_id, self._metadata(completed=False))
        self.studio.compile(job_id)
        self.studio.store.start_render(job_id, "attempt-1", "render", self.studio.get_job(job_id)["route_fingerprint"])

        with self.assertRaisesRegex(StudioConflict, "rendering"):
            self.studio.set_metadata(job_id, self._metadata(completed=False))
        with self.assertRaisesRegex(StudioConflict, "rendering"):
            self.studio.delete(job_id)
        with self.assertRaisesRegex(StudioConflict, "rendering"):
            self.studio.promote(job_id, rebuild=lambda: None)
        with self.assertRaises(StudioStateConflict):
            self.studio.store.start_promotion(job_id, {"backup_path": "unused"}, self.studio.get_job(job_id)["route_fingerprint"])

    def test_promotion_rolls_back_source_and_config_when_generation_fails(self):
        uploaded = self.studio.upload("simple.gpx", fixture("simple.gpx"))
        job_id = uploaded["job_id"]
        self.studio.set_metadata(job_id, self._metadata(completed=False))
        staged = self.studio.compile(job_id)
        original = (self.root / "quests.json").read_text(encoding="utf-8")
        atlas_path = self.root / "app" / "src" / "data" / "generated" / "routes.manifest.json"
        atlas_path.parent.mkdir(parents=True)
        atlas_path.write_text('{"routes":[{"slug":"existing-route"}]}\n', encoding="utf-8")
        original_atlas = atlas_path.read_text(encoding="utf-8")

        def fail_generation():
            raise RuntimeError("generator failed")

        with self.assertRaisesRegex(StudioError, "rolled back"):
            self.studio.promote(job_id, rebuild=fail_generation)

        self.assertEqual((self.root / "quests.json").read_text(encoding="utf-8"), original)
        self.assertEqual(atlas_path.read_text(encoding="utf-8"), original_atlas)
        self.assertFalse((self.root / "route_sources" / "studio" / f'{staged["slug"]}.gpx').exists())
        self.assertEqual(self.studio.get_job(job_id)["status"], "promotion_failed")

    def test_promotion_reservation_rejects_an_interleaved_metadata_edit(self):
        uploaded = self.studio.upload("simple.gpx", fixture("simple.gpx"))
        job_id = uploaded["job_id"]
        self.studio.set_metadata(job_id, self._metadata(completed=False))
        self.studio.compile(job_id)
        original_config = (self.root / "quests.json").read_text(encoding="utf-8")
        create_backup = self.studio._create_promotion_backup

        def edit_during_backup(*args):
            backup = create_backup(*args)
            changed = self._metadata(completed=False)
            changed["name"] = "Changed during promotion"
            self.studio.store.save_metadata(
                job_id, changed, self.studio.get_job(job_id)["selected_geometry_id"]
            )
            return backup

        with patch.object(self.studio, "_create_promotion_backup", side_effect=edit_during_backup):
            with self.assertRaisesRegex(StudioConflict, "Staged route changed"):
                self.studio.promote(job_id, rebuild=lambda: None)

        self.assertEqual((self.root / "quests.json").read_text(encoding="utf-8"), original_config)
        self.assertEqual(self.studio.get_job(job_id)["status"], "ready_to_compile")

    def test_compile_reservation_rejects_an_interleaved_metadata_edit(self):
        uploaded = self.studio.upload("simple.gpx", fixture("simple.gpx"))
        job_id = uploaded["job_id"]
        self.studio.set_metadata(job_id, self._metadata(completed=False))
        def edit_during_compile(*args):
            route, fingerprint = compile_studio_route(*args)
            changed = self._metadata(completed=False)
            changed["name"] = "New metadata"
            current = self.studio.get_job(job_id)
            self.studio.store.save_metadata(
                job_id, changed, current["selected_geometry_id"]
            )
            return route, fingerprint

        with patch("route_studio.compile_route", side_effect=edit_during_compile):
            with self.assertRaisesRegex(StudioConflict, "Route inputs changed"):
                self.studio.compile(job_id)

        job = self.studio.get_job(job_id)
        self.assertEqual(job["metadata"]["name"], "New metadata")
        self.assertIsNone(job["staged_route"])

    def test_post_generation_verification_failure_restores_exact_publication(self):
        uploaded = self.studio.upload("simple.gpx", fixture("simple.gpx"))
        job_id = uploaded["job_id"]
        metadata = self._metadata(completed=False)
        metadata["privacy"] = "public"
        self.studio.set_metadata(job_id, metadata)
        staged = self.studio.compile(job_id)
        details = self.root / "app" / "public" / "data" / "routes"
        details.mkdir(parents=True)
        (details / "existing.json").write_text('{"slug":"existing"}\n', encoding="utf-8")
        manifest = self.root / "app" / "src" / "data" / "generated" / "routes.manifest.json"
        manifest.parent.mkdir(parents=True)
        manifest.write_text('{"routes":[{"slug":"existing"}]}\n', encoding="utf-8")
        before_detail = (details / "existing.json").read_bytes()
        before_manifest = manifest.read_bytes()

        def build_invalid_publication():
            (details / "existing.json").unlink()
            (details / f'{staged["slug"]}.json').write_text(
                json.dumps({
                    **staged,
                    "lifecycle": "completed",
                    "source_kind": "strava-export",
                    "route": [{"lat": 0, "lng": 0, "elev": 0}],
                }), encoding="utf-8"
            )
            manifest.write_text(
                json.dumps({"routes": [{
                    field: staged[field]
                    for field in (
                        "slug", "route_id", "identity_kind", "source_format",
                        "activity_name", "region", "date", "type",
                    )
                } | {"source_kind": "strava-export", "lifecycle": "completed"}]}),
                encoding="utf-8",
            )

        with self.assertRaisesRegex(StudioError, "rolled back"):
            self.studio.promote(job_id, rebuild=build_invalid_publication)

        self.assertEqual((details / "existing.json").read_bytes(), before_detail)
        self.assertEqual(manifest.read_bytes(), before_manifest)
        self.assertFalse((details / f'{staged["slug"]}.json').exists())

    def test_public_promotion_verifies_complete_detail_and_manifest_contract(self):
        uploaded = self.studio.upload("simple.gpx", fixture("simple.gpx"))
        job_id = uploaded["job_id"]
        metadata = self._metadata(completed=False)
        metadata["privacy"] = "public"
        self.studio.set_metadata(job_id, metadata)
        staged = self.studio.compile(job_id)

        def build_valid_publication():
            detail = self.root / "app" / "public" / "data" / "routes" / f'{staged["slug"]}.json'
            detail.parent.mkdir(parents=True, exist_ok=True)
            detail.write_text(json.dumps(staged), encoding="utf-8")
            manifest = self.root / "app" / "src" / "data" / "generated" / "routes.manifest.json"
            manifest.parent.mkdir(parents=True, exist_ok=True)
            manifest_route = {
                **staged,
                "trace": self.studio._manifest_trace(staged["route"]),
            }
            manifest.write_text(json.dumps({"routes": [manifest_route]}), encoding="utf-8")

        promoted = self.studio.promote(job_id, rebuild=build_valid_publication)

        self.assertEqual(promoted["status"], "promoted")

    def test_promotion_verification_rejects_a_missing_required_detail_field(self):
        uploaded = self.studio.upload("simple.gpx", fixture("simple.gpx"))
        job_id = uploaded["job_id"]
        metadata = self._metadata(completed=False)
        metadata["privacy"] = "public"
        self.studio.set_metadata(job_id, metadata)
        staged = self.studio.compile(job_id)
        invalid = dict(staged)
        invalid.pop("mid_idx")
        detail = self.root / "app" / "public" / "data" / "routes" / f'{staged["slug"]}.json'
        detail.parent.mkdir(parents=True)
        detail.write_text(json.dumps(invalid), encoding="utf-8")
        manifest = self.root / "app" / "src" / "data" / "generated" / "routes.manifest.json"
        manifest.parent.mkdir(parents=True)
        manifest.write_text(json.dumps({"routes": [{
            **staged,
            "trace": self.studio._manifest_trace(staged["route"]),
        }]}), encoding="utf-8")

        with self.assertRaisesRegex(StudioError, "mid_idx"):
            self.studio._verify_promotion(staged, "public")

    def test_restart_rolls_back_an_interrupted_promotion_journal(self):
        uploaded = self.studio.upload("simple.gpx", fixture("simple.gpx"))
        job_id = uploaded["job_id"]
        self.studio.set_metadata(job_id, self._metadata(completed=False))
        staged = self.studio.compile(job_id)
        config_path = self.root / "quests.json"
        original_config = config_path.read_text(encoding="utf-8")
        details = self.root / "app" / "public" / "data" / "routes"
        details.mkdir(parents=True)
        (details / "existing.json").write_text('{"slug":"existing"}\n', encoding="utf-8")
        manifest = self.root / "app" / "src" / "data" / "generated" / "routes.manifest.json"
        manifest.parent.mkdir(parents=True)
        manifest.write_text('{"routes":[{"slug":"existing"}]}\n', encoding="utf-8")
        source_path = self.root / "route_sources" / "studio" / f'{staged["slug"]}.gpx'
        receipt_path = self.root / "route_sources" / "receipts" / f'{staged["slug"]}.json'
        backup = self.studio._create_promotion_backup(job_id, original_config)
        self.studio.store.start_promotion(job_id, {
            "backup_path": str(backup.relative_to(self.studio.root)),
            "source_path": str(source_path.resolve().relative_to(self.studio.root)),
            "receipt_path": str(receipt_path.resolve().relative_to(self.studio.root)),
        }, self.studio.get_job(job_id)["route_fingerprint"])
        source_path.parent.mkdir(parents=True)
        receipt_path.parent.mkdir(parents=True)
        source_path.write_bytes(b"partial")
        receipt_path.write_text("{}", encoding="utf-8")
        config_path.write_text('{"routes":[{"route_id":"partial"}]}\n', encoding="utf-8")
        (details / "existing.json").unlink()
        (details / "partial.json").write_text("{}", encoding="utf-8")
        manifest.write_text('{"routes":[{"slug":"partial"}]}\n', encoding="utf-8")
        self.studio.close()

        self.studio = RouteStudio(
            self.root,
            durable_source_root=self.durable_source_root,
        )
        recovered = self.studio.get_job(job_id)

        self.assertEqual(config_path.read_text(encoding="utf-8"), original_config)
        self.assertTrue((details / "existing.json").is_file())
        self.assertFalse((details / "partial.json").exists())
        self.assertFalse(source_path.exists())
        self.assertFalse(receipt_path.exists())
        self.assertEqual(recovered["status"], "promotion_failed")
        self.assertTrue(recovered["retryable"])

    def test_interrupted_promotion_is_closed_before_backup_cleanup(self):
        uploaded = self.studio.upload("simple.gpx", fixture("simple.gpx"))
        job_id = uploaded["job_id"]
        self.studio.set_metadata(job_id, self._metadata(completed=False))
        self.studio.compile(job_id)
        backup = self.studio._create_promotion_backup(
            job_id, (self.root / "quests.json").read_text(encoding="utf-8")
        )
        self.studio.store.start_promotion(job_id, {
            "backup_path": str(backup.relative_to(self.studio.root)),
            "source_path": "route_sources/studio/interrupted.gpx",
            "receipt_path": "route_sources/receipts/interrupted.json",
        }, self.studio.get_job(job_id)["route_fingerprint"])
        observed_statuses = []
        remove_backup = self.studio._remove_promotion_backup

        def observe_then_remove(path):
            observed_statuses.append(self.studio.get_job(job_id)["status"])
            remove_backup(path)

        with patch.object(self.studio, "_remove_promotion_backup", side_effect=observe_then_remove):
            self.studio._recover_interrupted_promotions()

        self.assertEqual(observed_statuses, ["promotion_failed"])

    def test_promotion_writes_canonical_spec_and_receipt_then_marks_promoted(self):
        uploaded = self.studio.upload("simple.gpx", fixture("simple.gpx"))
        job_id = uploaded["job_id"]
        self.studio.set_metadata(job_id, self._metadata(completed=False))
        staged = self.studio.compile(job_id)

        def build_private_atlas():
            path = self.root / "app" / "src" / "data" / "generated" / "routes.manifest.json"
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('{"routes":[]}\n', encoding="utf-8")

        self.studio.promote(job_id, rebuild=build_private_atlas)

        config = json.loads((self.root / "quests.json").read_text(encoding="utf-8"))
        self.assertEqual(config["routes"][0]["route_id"], staged["slug"])
        self.assertNotIn("activity_id", config["routes"][0])
        self.assertTrue((self.root / config["routes"][0]["source_gpx"]).is_file())
        self.assertTrue((self.root / config["routes"][0]["source_receipt"]).is_file())
        self.assertEqual(
            config["routes"][0]["source_policy"],
            "private-durable-backup",
        )
        durable_source = self.durable_source_root / config["routes"][0]["source_backup"]
        self.assertTrue(durable_source.is_file())
        canonical = (self.root / config["routes"][0]["source_gpx"]).read_text(encoding="utf-8")
        self.assertNotIn("<time>", canonical)
        (self.root / config["routes"][0]["source_gpx"]).unlink()
        owner_routes = self.studio.owner_routes()
        self.assertEqual([route["slug"] for route in owner_routes], [staged["slug"]])
        self.assertEqual(owner_routes[0]["lifecycle"], "discovered")
        durable_source.write_bytes(b"tampered")
        with self.assertRaisesRegex(ValueError, "checksum"):
            self.studio.owner_routes()
        self.assertEqual(self.studio.get_job(job_id)["status"], "promoted")

    def test_promotion_preserves_unavailable_elevation_in_canonical_spec(self):
        uploaded = self.studio.upload("plain.gpx", fixture("without-elevation-time.gpx"))
        job_id = uploaded["job_id"]
        self.studio.set_metadata(job_id, self._metadata(completed=False))
        self.studio.compile(job_id)

        def build_private_atlas():
            path = self.root / "app" / "src" / "data" / "generated" / "routes.manifest.json"
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('{"routes":[]}\n', encoding="utf-8")

        self.studio.promote(job_id, rebuild=build_private_atlas)

        config = json.loads((self.root / "quests.json").read_text(encoding="utf-8"))
        self.assertEqual(config["routes"][0]["elevation_status"], "unavailable")

    def test_failed_promotion_retry_runs_promotion_not_rendering(self):
        uploaded = self.studio.upload("simple.gpx", fixture("simple.gpx"))
        job_id = uploaded["job_id"]
        self.studio.set_metadata(job_id, self._metadata(completed=False))
        self.studio.compile(job_id)
        with self.assertRaises(StudioError):
            self.studio.promote(job_id, rebuild=lambda: (_ for _ in ()).throw(RuntimeError("failed")))

        def build_private_atlas():
            path = self.root / "app" / "src" / "data" / "generated" / "routes.manifest.json"
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('{"routes":[]}\n', encoding="utf-8")

        retried = self.studio.retry(job_id, rebuild=build_private_atlas)

        self.assertEqual(retried["status"], "promoted")
        self.assertEqual(retried["render_attempts"], [])

    @staticmethod
    def _metadata(*, completed, date=""):
        return {
            "name": "Synthetic Ridge",
            "activity_type": "Run",
            "completed_by_owner": completed,
            "date": date,
            "region": "Calgary, AB",
            "privacy": "private",
        }


if __name__ == "__main__":
    unittest.main()
