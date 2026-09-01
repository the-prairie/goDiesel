import hashlib
import tempfile
import unittest
from pathlib import Path

from datetime import date

from route_imports import (
    IMPORTED_GPX,
    STRAVA_EXPORT,
    imported_route_from_spec,
    route_metadata,
    route_source_kind,
)


class ImportedRouteTest(unittest.TestCase):
    def test_loads_route_metadata_from_a_repo_owned_gpx(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "route_sources" / "strava" / "route.gpx"
            source.parent.mkdir(parents=True)
            source.write_text("<gpx />")

            route = imported_route_from_spec(
                {
                    "source_gpx": "route_sources/strava/route.gpx",
                    "activity_name": "Appian Way",
                    "activity_type": "Run",
                    "date": "2026-08-04",
                    "description": "An imported route.",
                },
                root,
            )

            self.assertEqual(route.path, source.resolve())
            self.assertEqual(route.name, "Appian Way")
            self.assertEqual(route.activity_type, "Run")

    def test_rejects_sources_outside_route_sources(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "route.gpx"
            source.write_text("<gpx />")

            with self.assertRaisesRegex(ValueError, "inside route_sources"):
                imported_route_from_spec(
                    {
                        "source_gpx": "route.gpx",
                        "activity_name": "Unsafe route",
                        "activity_type": "Run",
                    },
                    root,
                )

    def test_rejects_invalid_imported_route_dates(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "route_sources" / "route.gpx"
            source.parent.mkdir(parents=True)
            source.write_text("<gpx />")

            with self.assertRaisesRegex(ValueError, "valid YYYY-MM-DD"):
                imported_route_from_spec(
                    {
                        "source_gpx": "route_sources/route.gpx",
                        "activity_name": "Invalid date route",
                        "activity_type": "Run",
                        "date": "2026-02-30",
                    },
                    root,
                )

    def test_revalidates_the_durable_source_checksum(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "route_sources" / "imported" / "route.gpx"
            source.parent.mkdir(parents=True)
            source.write_text("<gpx />")
            digest = hashlib.sha256(source.read_bytes()).hexdigest()
            spec = {
                "source_gpx": "route_sources/imported/route.gpx",
                "source_sha256": digest,
                "activity_name": "Durable route",
                "activity_type": "Run",
            }

            self.assertEqual(imported_route_from_spec(spec, root).source_sha256, digest)
            source.write_text("<gpx><changed /></gpx>")

            with self.assertRaisesRegex(ValueError, "checksum does not match"):
                imported_route_from_spec(spec, root)


if __name__ == "__main__":
    unittest.main()


class RouteSourceKindTest(unittest.TestCase):
    def test_a_route_with_a_source_file_is_an_imported_gpx(self):
        self.assertEqual(
            route_source_kind({"source_gpx": "route_sources/strava/route.gpx"}),
            IMPORTED_GPX,
        )

    def test_a_route_without_a_source_file_comes_from_the_strava_export(self):
        self.assertEqual(route_source_kind({"activity_id": "123"}), STRAVA_EXPORT)


class _Row(dict):
    """A minimal stand-in for one row of the Strava export."""


class RouteMetadataTest(unittest.TestCase):
    def _imported_spec(self, root):
        source = root / "route_sources" / "strava" / "route.gpx"
        source.parent.mkdir(parents=True)
        source.write_text("<gpx />")
        return {
            "source_gpx": "route_sources/strava/route.gpx",
            "activity_name": "Appian Way",
            "activity_type": "Run",
            "date": "2026-08-04",
            "description": "An imported route.",
        }

    def test_an_imported_route_describes_itself_without_an_export_row(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            metadata = route_metadata(self._imported_spec(root), root, None)

            self.assertIsNotNone(metadata)
            self.assertEqual(metadata.source_kind, IMPORTED_GPX)
            self.assertEqual(metadata.name, "Appian Way")
            self.assertEqual(metadata.activity_type, "Run")
            self.assertEqual(metadata.date, "2026-08-04")
            self.assertEqual(metadata.source_path.name, "route.gpx")

    def test_a_strava_route_reads_the_export_row(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            row = _Row(
                {
                    "Activity Name": "crosswalk sprints",
                    "Activity Type": "Run",
                    "Activity Description": "could not cross the bridge",
                    "date": date(2025, 11, 26),
                }
            )

            metadata = route_metadata({"activity_id": "1"}, root, row)

            self.assertEqual(metadata.source_kind, STRAVA_EXPORT)
            self.assertEqual(metadata.name, "crosswalk sprints")
            self.assertEqual(metadata.date, "2025-11-26")
            self.assertIsNone(metadata.source_path)

    def test_a_strava_route_without_a_row_cannot_be_described(self):
        with tempfile.TemporaryDirectory() as directory:
            metadata = route_metadata({"activity_id": "1"}, Path(directory), None)

            self.assertIsNone(metadata)

    def test_missing_export_values_become_empty_rather_than_the_text_nan(self):
        with tempfile.TemporaryDirectory() as directory:
            row = _Row(
                {
                    "Activity Name": "",
                    "Activity Type": "Ride",
                    "Activity Description": float("nan"),
                    "date": None,
                }
            )

            metadata = route_metadata({"activity_id": "1"}, Path(directory), row)

            self.assertEqual(metadata.name, "(unnamed)")
            self.assertEqual(metadata.description, "")
            self.assertEqual(metadata.date, "")
