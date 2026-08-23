from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest
from unittest.mock import patch

import route_inbox
from route_inbox import RouteInbox, route_inbox_origin_allowed
from route_studio import RouteStudio


FIXTURES = Path(__file__).parent / "tests" / "fixtures" / "route-studio"


class RouteInboxTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name).resolve()
        self.inbox_root = self.root / "Downloads"
        self.inbox_root.mkdir()
        (self.root / "quests.json").write_text('{"routes": []}\n', encoding="utf-8")
        self.studio = RouteStudio(
            self.root,
            durable_source_root=self.root / "durable-route-sources",
        )
        self.inbox = RouteInbox(self.studio, [self.inbox_root])

    def tearDown(self):
        self.studio.close()
        self.temporary.cleanup()

    def test_owner_can_import_a_detected_gpx_without_duplicating_the_source(self):
        payload = (FIXTURES / "simple.gpx").read_bytes()
        (self.inbox_root / "Morning Run.gpx").write_bytes(payload)
        (self.inbox_root / "notes.txt").write_text("not a route", encoding="utf-8")

        listing = self.inbox.list_entries()

        self.assertEqual(listing["roots"], [str(self.inbox_root.resolve())])
        self.assertEqual([item["filename"] for item in listing["entries"]], ["Morning Run.gpx"])
        self.assertTrue(listing["entries"][0]["eligible"])
        self.assertFalse(listing["entries"][0]["imported"])
        self.assertIsNone(listing["entries"][0]["job_id"])

        first = self.inbox.import_entry(listing["entries"][0]["id"])
        second = self.inbox.import_entry(listing["entries"][0]["id"])

        self.assertFalse(first["exact_duplicate"])
        self.assertTrue(second["exact_duplicate"])
        self.assertEqual(first["job_id"], second["job_id"])
        reopened = self.inbox.list_entries()["entries"][0]
        self.assertTrue(reopened["imported"])
        self.assertEqual(reopened["job_id"], first["job_id"])

    def test_inbox_never_reads_nested_symlinked_or_oversized_files(self):
        payload = (FIXTURES / "simple.gpx").read_bytes()
        nested = self.inbox_root / "nested"
        nested.mkdir()
        (nested / "hidden.gpx").write_bytes(payload)
        outside = self.root / "outside.gpx"
        outside.write_bytes(payload)
        (self.inbox_root / "linked.gpx").symlink_to(outside)
        oversized = self.inbox_root / "oversized.gpx"
        with oversized.open("wb") as route_file:
            route_file.truncate(25 * 1024 * 1024 + 1)

        listing = self.inbox.list_entries()

        self.assertEqual([item["filename"] for item in listing["entries"]], ["oversized.gpx"])
        self.assertFalse(listing["entries"][0]["eligible"])
        self.assertIn("25 MiB", listing["entries"][0]["reason"])
        with self.assertRaisesRegex(ValueError, "not eligible"):
            self.inbox.import_entry(listing["entries"][0]["id"])

    def test_file_replacement_cannot_follow_a_symlink_or_bypass_the_size_cap(self):
        payload = (FIXTURES / "simple.gpx").read_bytes()
        route_path = self.inbox_root / "changing.gpx"
        route_path.write_bytes(payload)
        entry_id = self.inbox.list_entries()["entries"][0]["id"]
        outside = self.root / "outside.gpx"
        outside.write_bytes(payload)
        route_path.unlink()
        route_path.symlink_to(outside)

        with self.assertRaisesRegex(ValueError, "not found"):
            self.inbox.import_entry(entry_id)
        self.assertEqual(self.studio.list_jobs(), [])

        route_path.unlink()
        with route_path.open("wb") as route_file:
            route_file.truncate(25 * 1024 * 1024 + 1)
        with self.assertRaisesRegex(ValueError, "not eligible"):
            self.inbox.import_entry(entry_id)

    def test_symlinked_and_duplicate_roots_do_not_escape_or_duplicate_entries(self):
        payload = (FIXTURES / "simple.gpx").read_bytes()
        (self.inbox_root / "route.gpx").write_bytes(payload)
        linked_root = self.root / "Linked Downloads"
        linked_root.symlink_to(self.inbox_root, target_is_directory=True)

        duplicate_inbox = RouteInbox(
            self.studio,
            [self.inbox_root, self.inbox_root / ".", linked_root],
        )
        listing = duplicate_inbox.list_entries()

        self.assertEqual([item["filename"] for item in listing["entries"]], ["route.gpx"])
        self.assertEqual(len(listing["roots"]), 2)
        self.assertTrue(any("unavailable" in warning for warning in listing["warnings"]))
        imported = duplicate_inbox.import_entry(listing["entries"][0]["id"])
        self.assertFalse(imported["exact_duplicate"])

    def test_root_with_a_symlinked_ancestor_is_refused(self):
        payload = (FIXTURES / "simple.gpx").read_bytes()
        real_parent = self.root / "real-parent"
        real_downloads = real_parent / "Downloads"
        real_downloads.mkdir(parents=True)
        (real_downloads / "outside.gpx").write_bytes(payload)
        linked_parent = self.root / "linked-parent"
        linked_parent.symlink_to(real_parent, target_is_directory=True)

        listing = RouteInbox(
            self.studio, [linked_parent / "Downloads"]
        ).list_entries()

        self.assertEqual(listing["entries"], [])
        self.assertTrue(any("unavailable" in warning for warning in listing["warnings"]))

    def test_listing_and_import_bound_source_reads_to_visible_work(self):
        payload = (FIXTURES / "simple.gpx").read_bytes()
        for index in range(205):
            (self.inbox_root / f"route-{index:03}.gpx").write_bytes(payload)

        with (
            patch("route_inbox.MAX_SCAN_BYTES", 800),
            patch(
                "route_inbox._read_source", wraps=route_inbox._read_source
            ) as read_source,
        ):
            listing = self.inbox.list_entries()
            self.assertEqual(len(listing["entries"]), 200)
            self.assertEqual(read_source.call_count, 2)
            self.assertEqual(
                sum(entry["checksum_status"] == "checked" for entry in listing["entries"]),
                2,
            )

            read_source.reset_mock()
            self.inbox.import_entry(listing["entries"][0]["id"])
            self.assertEqual(read_source.call_count, 1)

    def test_source_rewritten_during_read_is_not_importable(self):
        payload = (FIXTURES / "simple.gpx").read_bytes()
        (self.inbox_root / "changing.gpx").write_bytes(payload)
        real_fstat = route_inbox.os.fstat
        calls = 0

        def changing_fstat(file_descriptor):
            nonlocal calls
            source_stat = real_fstat(file_descriptor)
            calls += 1
            if calls == 2:
                return SimpleNamespace(
                    st_mode=source_stat.st_mode,
                    st_dev=source_stat.st_dev,
                    st_ino=source_stat.st_ino,
                    st_size=source_stat.st_size,
                    st_mtime=source_stat.st_mtime,
                    st_mtime_ns=source_stat.st_mtime_ns + 1,
                    st_ctime_ns=source_stat.st_ctime_ns,
                )
            return source_stat

        with patch("route_inbox.os.fstat", side_effect=changing_fstat):
            listing = self.inbox.list_entries()

        self.assertFalse(listing["entries"][0]["eligible"])
        self.assertIn("changed", listing["entries"][0]["reason"].lower())

    def test_fit_exports_are_visible_but_not_misrepresented_as_importable(self):
        (self.inbox_root / "original.fit.gz").write_bytes(b"synthetic fit")

        entry = self.inbox.list_entries()["entries"][0]

        self.assertEqual(entry["source_format"], "fit")
        self.assertFalse(entry["eligible"])
        self.assertIn("GPX", entry["reason"])

    def test_inbox_browser_boundary_requires_an_explicit_allowed_origin(self):
        allowed = {"http://127.0.0.1:8787"}

        self.assertTrue(route_inbox_origin_allowed(
            {"Origin": "http://127.0.0.1:8787"}, allowed
        ))
        self.assertFalse(route_inbox_origin_allowed(
            {"Origin": "https://example.invalid"}, allowed
        ))
        self.assertFalse(route_inbox_origin_allowed({}, allowed))


if __name__ == "__main__":
    unittest.main()
