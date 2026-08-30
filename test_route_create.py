import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from PIL import Image

from route_create import RouteCreateError, apply_proposal, propose_request


TIMED_GPX = """<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="goDiesel test" xmlns="http://www.topografix.com/GPX/1/1">
  <trk><name>Ridge Traverse</name><trkseg>
    <trkpt lat="50.0000" lon="-114.0000"><ele>1450</ele><time>2026-08-20T14:00:00Z</time></trkpt>
    <trkpt lat="50.0100" lon="-114.0100"><ele>1510</ele><time>2026-08-20T14:12:00Z</time></trkpt>
    <trkpt lat="50.0200" lon="-114.0000"><ele>1490</ele><time>2026-08-20T14:25:00Z</time></trkpt>
  </trkseg></trk>
</gpx>
"""

NO_ELEVATION_GPX = """<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="goDiesel test" xmlns="http://www.topografix.com/GPX/1/1">
  <trk><name>High Plateau</name><trkseg>
    <trkpt lat="27.9800" lon="86.9000" />
    <trkpt lat="27.9900" lon="86.9100" />
    <trkpt lat="28.0000" lon="86.9200" />
  </trkseg></trk>
</gpx>
"""


class RouteCreateTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        (self.root / "quests.json").write_text(
            json.dumps({"_comment": "test", "routes": []}, indent=2) + "\n",
            encoding="utf-8",
        )
        self.source = self.root / "owner-files" / "ridge.gpx"
        self.source.parent.mkdir()
        self.source.write_text(TIMED_GPX, encoding="utf-8")

    def tearDown(self):
        self.directory.cleanup()

    def request(self, **overrides):
        request = {
            "schema_version": 1,
            "gpx_path": str(self.source),
            "activity_type": "Run",
            "route_name": "Ridge Traverse",
            "region": "Kananaskis, Alberta",
            "source_description": "A supplied ridge route with an exposed return.",
        }
        request.update(overrides)
        return request

    def test_new_gpx_request_normalizes_to_a_redacted_closed_proposal(self):
        proposal = propose_request(self.request(), self.root)

        self.assertEqual(proposal["document_type"], "route-share-proposal")
        self.assertEqual(proposal["operation"], "create")
        self.assertEqual(proposal["route_spec"]["lifecycle"], "discovered")
        self.assertEqual(proposal["route_spec"]["date"], "")
        self.assertRegex(proposal["route_spec"]["activity_id"], r"^gpx-[0-9a-f]{32}$")
        self.assertEqual(
            proposal["source"]["sha256"],
            hashlib.sha256(TIMED_GPX.encode()).hexdigest(),
        )
        self.assertEqual(proposal["source"]["filename"], "ridge.gpx")
        self.assertNotIn(str(self.root), json.dumps(proposal))
        self.assertEqual(proposal["observations"]["temporal"]["status"], "recorded")
        self.assertEqual(proposal["observations"]["elevation"]["status"], "recorded")
        self.assertGreater(proposal["observations"]["distance_m"], 0)
        self.assertEqual(proposal["blocking_errors"], [])

    def test_missing_elevation_remains_unavailable(self):
        self.source.write_text(NO_ELEVATION_GPX, encoding="utf-8")

        proposal = propose_request(self.request(), self.root)

        self.assertEqual(proposal["observations"]["elevation"], {"status": "unavailable"})
        self.assertNotIn("elevation_gain_m", proposal["observations"])

    def test_unknown_request_fields_are_rejected_with_a_stable_code(self):
        with self.assertRaises(RouteCreateError) as raised:
            propose_request(self.request(guess_the_geometry=True), self.root)

        self.assertEqual(raised.exception.code, "request.unknown_field")

    def test_invalid_activity_date_and_activity_type_are_rejected(self):
        for request, code in (
            (self.request(activity_date="2026-02-30"), "request.invalid_date"),
            (self.request(activity_type="Hike"), "request.invalid_activity_type"),
        ):
            with self.subTest(code=code), self.assertRaises(RouteCreateError) as raised:
                propose_request(request, self.root)
            self.assertEqual(raised.exception.code, code)

    def test_completed_route_requires_owner_recorded_evidence(self):
        with self.assertRaises(RouteCreateError) as raised:
            propose_request(self.request(lifecycle="completed"), self.root)

        self.assertEqual(raised.exception.code, "request.lifecycle_contradiction")

    def test_source_symlink_escape_is_rejected(self):
        link = self.root / "route.gpx"
        link.symlink_to(self.source)

        with self.assertRaises(RouteCreateError) as raised:
            propose_request(self.request(gpx_path=str(link)), self.root)

        self.assertEqual(raised.exception.code, "request.unsafe_path")

    def test_existing_route_proposal_updates_in_place(self):
        existing = {
            "activity_id": "123",
            "status": "approved",
            "region": "Crete, Greece",
        }
        (self.root / "quests.json").write_text(
            json.dumps({"routes": [existing]}, indent=2) + "\n",
            encoding="utf-8",
        )

        proposal = propose_request(
            {
                "schema_version": 1,
                "existing_slug": "123",
                "curation": {"vibe": "A quiet coastal line."},
                "proposed_share_name": "crete-coast",
            },
            self.root,
        )

        self.assertEqual(proposal["operation"], "update")
        self.assertEqual(proposal["route_spec"]["activity_id"], "123")
        self.assertEqual(proposal["route_spec"]["curation"]["review_status"], "draft")

    def test_explicit_identity_collision_is_rejected(self):
        (self.root / "quests.json").write_text(
            json.dumps({"routes": [{"activity_id": "gpx-fixed", "status": "approved"}]}) + "\n",
            encoding="utf-8",
        )

        with self.assertRaises(RouteCreateError) as raised:
            propose_request(self.request(desired_route_id="gpx-fixed"), self.root)

        self.assertEqual(raised.exception.code, "route.identity_conflict")

    def test_apply_is_idempotent_and_registers_the_durable_source(self):
        proposal = propose_request(self.request(), self.root)

        first = apply_proposal(proposal, self.root, rebuild=lambda: None)
        second = apply_proposal(proposal, self.root, rebuild=lambda: None)

        slug = proposal["route_spec"]["activity_id"]
        durable = self.root / "route_sources" / "imported" / f"{slug}.gpx"
        config = json.loads((self.root / "quests.json").read_text(encoding="utf-8"))
        self.assertTrue(durable.is_file())
        self.assertEqual(len(config["routes"]), 1)
        self.assertEqual(config["routes"][0]["source_sha256"], proposal["source"]["sha256"])
        self.assertEqual(first["result"], "created")
        self.assertEqual(second["result"], "already_applied")

    def test_proposal_contract_rejects_unknown_fields_before_writes(self):
        proposal = propose_request(self.request(), self.root)
        proposal["invented_approval"] = True

        with self.assertRaises(RouteCreateError) as raised:
            apply_proposal(proposal, self.root, rebuild=lambda: None)

        self.assertEqual(raised.exception.code, "proposal.schema")
        self.assertEqual(json.loads((self.root / "quests.json").read_text())["routes"], [])

    def test_media_is_redacted_registered_and_published_only_for_its_annotation(self):
        photo = self.root / "owner-files" / "ridge.jpg"
        Image.new("RGB", (32, 24), color=(30, 90, 120)).save(photo, "JPEG")
        proposal = propose_request(
            self.request(
                annotations=[
                    {
                        "id": "ridge-warning",
                        "at_distance_m": 100,
                        "kind": "warning",
                        "evidence": "hypothesis",
                        "body": "The return is exposed.",
                    }
                ],
                media=[
                    {
                        "path": str(photo),
                        "association": {
                            "kind": "annotation",
                            "annotation_id": "ridge-warning",
                        },
                    }
                ],
            ),
            self.root,
        )

        self.assertNotIn(str(self.root), json.dumps(proposal))
        self.assertEqual(proposal["media"][0]["kind"], "image")
        apply_proposal(proposal, self.root, rebuild=lambda: None)
        route = json.loads((self.root / "quests.json").read_text())["routes"][0]

        durable = self.root / route["source_media"][0]["path"]
        published = self.root / "app" / "public" / route["annotations"][0]["media"]["url"]
        unrelated = self.root / "app" / "public" / "media" / "unrelated"
        self.assertTrue(durable.is_file())
        self.assertTrue(published.is_file())
        self.assertFalse(unrelated.exists())

    def test_media_annotation_association_must_name_a_supplied_annotation(self):
        photo = self.root / "owner-files" / "ridge.jpg"
        Image.new("RGB", (8, 8)).save(photo, "JPEG")

        with self.assertRaises(RouteCreateError) as raised:
            propose_request(
                self.request(
                    media=[
                        {
                            "path": str(photo),
                            "association": {
                                "kind": "annotation",
                                "annotation_id": "missing",
                            },
                        }
                    ]
                ),
                self.root,
            )

        self.assertEqual(raised.exception.code, "request.media_association_missing")


if __name__ == "__main__":
    unittest.main()
