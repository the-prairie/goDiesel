import tempfile
import unittest
from pathlib import Path

from route_imports import imported_route_from_spec


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


if __name__ == "__main__":
    unittest.main()
