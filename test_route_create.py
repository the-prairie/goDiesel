import hashlib
import io
import json
import tempfile
import unittest
from contextlib import redirect_stderr
from pathlib import Path
from unittest.mock import patch

from PIL import Image

from route_create import RouteCreateError, apply_proposal, main, propose_request


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

PARTIAL_ELEVATION_GPX = """<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="goDiesel test" xmlns="http://www.topografix.com/GPX/1/1">
  <trk><name>Broken Ridge</name><trkseg>
    <trkpt lat="50.0000" lon="-114.0000"><ele>1450</ele></trkpt>
    <trkpt lat="50.0100" lon="-114.0100" />
    <trkpt lat="50.0200" lon="-114.0000"><ele>1490</ele></trkpt>
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

    def write_generated_detail(
        self,
        slug,
        *,
        distance_m=1_500,
        elevation_status="recorded",
        temporal_status="unavailable",
    ):
        detail = self.root / "app/public/data/routes" / f"{slug}.json"
        detail.parent.mkdir(parents=True, exist_ok=True)
        elevations = (1_450, 1_510) if elevation_status == "recorded" else (None, None)
        detail.write_text(
            json.dumps(
                {
                    "route": [
                        {"d": 0, "elev": elevations[0]},
                        {"d": distance_m, "elev": elevations[1]},
                    ],
                    "elevation_status": elevation_status,
                    "provenance": {"temporal": {"status": temporal_status}},
                }
            ),
            encoding="utf-8",
        )

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

    def test_partial_elevation_is_rejected_before_canonical_writes(self):
        self.source.write_text(PARTIAL_ELEVATION_GPX, encoding="utf-8")

        with self.assertRaises(RouteCreateError) as raised:
            propose_request(self.request(), self.root)

        self.assertEqual(raised.exception.code, "source.partial_elevation")
        self.assertEqual(json.loads((self.root / "quests.json").read_text())["routes"], [])

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

    def test_whitespace_identity_fields_are_rejected_before_staging(self):
        for field in ("route_name", "region"):
            with self.subTest(field=field), self.assertRaises(RouteCreateError) as raised:
                propose_request(self.request(**{field: "   "}), self.root)
            self.assertEqual(raised.exception.code, f"request.missing_{field}")
        self.assertFalse((self.root / ".route-share/staging").exists())

    def test_existing_route_rejects_mode_inapplicable_fields(self):
        (self.root / "quests.json").write_text(
            json.dumps({"routes": [{"activity_id": "123", "status": "approved"}]}),
            encoding="utf-8",
        )
        with self.assertRaises(RouteCreateError) as raised:
            propose_request(
                {"schema_version": 1, "existing_slug": "123", "lifecycle": "completed"},
                self.root,
            )
        self.assertEqual(raised.exception.code, "request.mode_field")

    def test_completed_route_requires_owner_recorded_evidence(self):
        with self.assertRaises(RouteCreateError) as raised:
            propose_request(self.request(lifecycle="completed"), self.root)

        self.assertEqual(raised.exception.code, "request.lifecycle_contradiction")

    def test_completed_route_requires_a_date_before_canonical_writes(self):
        with self.assertRaises(RouteCreateError) as raised:
            propose_request(
                self.request(
                    lifecycle="completed",
                    completion_evidence={
                        "kind": "owner_recorded",
                        "description": "Recorded by the owner.",
                    },
                ),
                self.root,
            )

        self.assertEqual(raised.exception.code, "request.missing_activity_date")
        self.assertEqual(json.loads((self.root / "quests.json").read_text())["routes"], [])

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
            "curation": {
                "vibe": "Old words.",
                "caveats": ["Carry water"],
                "review_status": "draft",
            },
        }
        (self.root / "quests.json").write_text(
            json.dumps({"routes": [existing]}, indent=2) + "\n",
            encoding="utf-8",
        )
        self.write_generated_detail("123")

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
        self.assertEqual(proposal["route_spec"]["curation"]["caveats"], ["Carry water"])
        self.assertEqual(proposal["route_spec"]["curation"]["vibe"], "A quiet coastal line.")
        self.assertEqual(proposal["route_spec"]["curation"]["review_status"], "draft")

    def test_existing_route_annotations_are_bounded_before_canonical_writes(self):
        existing = {"activity_id": "123", "status": "approved", "region": "Crete"}
        (self.root / "quests.json").write_text(
            json.dumps({"routes": [existing]}, indent=2) + "\n",
            encoding="utf-8",
        )
        detail = self.root / "app/public/data/routes/123.json"
        detail.parent.mkdir(parents=True)
        detail.write_text(
            json.dumps({"route": [{"d": 0}, {"d": 1_000}]}),
            encoding="utf-8",
        )

        with self.assertRaises(RouteCreateError) as raised:
            propose_request(
                {
                    "schema_version": 1,
                    "existing_slug": "123",
                    "annotations": [
                        {
                            "id": "outside",
                            "at_distance_m": 99_999,
                            "kind": "warning",
                            "evidence": "hypothesis",
                            "body": "Outside the route.",
                        }
                    ],
                },
                self.root,
            )

        self.assertEqual(raised.exception.code, "request.invalid_annotations")
        self.assertEqual(
            json.loads((self.root / "quests.json").read_text())["routes"],
            [existing],
        )

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

    def test_retry_after_validation_failure_revalidates_canonical_state(self):
        proposal = propose_request(self.request(), self.root)

        with self.assertRaises(RouteCreateError) as raised:
            apply_proposal(
                proposal,
                self.root,
                rebuild=lambda: (_ for _ in ()).throw(RuntimeError("transient")),
            )
        self.assertEqual(raised.exception.code, "create.validation_failed")

        validation = {"publishable": True}
        retried = apply_proposal(proposal, self.root, rebuild=lambda: validation)

        self.assertEqual(retried["result"], "already_applied")
        self.assertEqual(retried["validation"], validation)
        recovery = self.root / ".route-share" / "recovery" / f"{proposal['proposal_id']}.json"
        self.assertFalse(recovery.exists())

    def test_apply_rejects_semantically_tampered_create_proposals(self):
        mutations = (
            lambda proposal: proposal["route_spec"].update(activity_id="123456789"),
            lambda proposal: proposal["route_spec"].update(source_sha256="0" * 64),
            lambda proposal: proposal["route_spec"].update(
                lifecycle="completed",
                date="2026-08-30",
            ),
        )
        for mutation in mutations:
            proposal = propose_request(self.request(), self.root)
            mutation(proposal)
            with self.subTest(mutation=mutation), self.assertRaises(RouteCreateError) as raised:
                apply_proposal(proposal, self.root, rebuild=lambda: None)
            self.assertEqual(raised.exception.code, "proposal.semantic_mismatch")
            self.assertEqual(json.loads((self.root / "quests.json").read_text())["routes"], [])

    def test_apply_revalidates_observations_and_annotation_bounds_before_writes(self):
        proposal = propose_request(
            self.request(
                annotations=[
                    {
                        "id": "ridge-note",
                        "at_distance_m": 100,
                        "kind": "warning",
                        "evidence": "hypothesis",
                        "body": "Stay on the supplied line.",
                    }
                ]
            ),
            self.root,
        )
        proposal["route_spec"]["annotations"][0]["at_distance_m"] = 999_999

        with self.assertRaises(RouteCreateError) as raised:
            apply_proposal(proposal, self.root, rebuild=lambda: None)

        self.assertEqual(raised.exception.code, "proposal.semantic_mismatch")
        self.assertEqual(json.loads((self.root / "quests.json").read_text())["routes"], [])
        self.assertFalse((self.root / "route_sources").exists())

    def test_request_annotations_cannot_supply_public_media_paths(self):
        with self.assertRaises(RouteCreateError) as raised:
            propose_request(
                self.request(
                    annotations=[
                        {
                            "id": "bypass",
                            "at_distance_m": 100,
                            "kind": "image",
                            "evidence": "hypothesis",
                            "body": "Unregistered media.",
                            "media": {
                                "url": "media/gpx-bypass/original.jpg",
                                "thumb_url": "media/gpx-bypass/thumb.jpg",
                                "width": 10,
                                "height": 10,
                            },
                        }
                    ]
                ),
                self.root,
            )
        self.assertEqual(raised.exception.code, "request.schema")

    def test_prompt_annotations_cannot_claim_unsupported_evidence(self):
        with self.assertRaises(RouteCreateError) as raised:
            propose_request(
                self.request(
                    annotations=[
                        {
                            "id": "unsupported-water-claim",
                            "at_distance_m": 100,
                            "kind": "landmark",
                            "evidence": "recorded",
                            "body": "Drinking water is guaranteed year-round.",
                        }
                    ]
                ),
                self.root,
            )

        self.assertEqual(raised.exception.code, "request.schema")

    def test_retry_uses_durable_source_when_staging_is_absent(self):
        proposal = propose_request(self.request(), self.root)
        apply_proposal(proposal, self.root, rebuild=lambda: None)
        staged = self.root / proposal["source"]["staged_path"]
        staged.unlink()

        retried = apply_proposal(proposal, self.root, rebuild=lambda: {"publishable": True})

        self.assertEqual(retried["result"], "already_applied")
        self.assertTrue(retried["validation"]["publishable"])

    def test_idempotent_retry_detects_canonical_route_drift(self):
        proposal = propose_request(self.request(), self.root)
        apply_proposal(proposal, self.root, rebuild=lambda: None)
        config = json.loads((self.root / "quests.json").read_text())
        config["routes"][0]["activity_name"] = "Unapproved name"
        (self.root / "quests.json").write_text(json.dumps(config) + "\n")

        with self.assertRaises(RouteCreateError) as raised:
            apply_proposal(proposal, self.root, rebuild=lambda: None)

        self.assertEqual(raised.exception.code, "route.changed_since_apply")

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

        (self.root / proposal["source"]["staged_path"]).unlink()
        for item in proposal["media"]:
            (self.root / item["staged_path"]).unlink()
        retried = apply_proposal(proposal, self.root, rebuild=lambda: {"publishable": True})
        self.assertEqual(retried["result"], "already_applied")

    def test_apply_rejects_media_from_another_proposal(self):
        first_photo = self.root / "owner-files" / "first.jpg"
        second_photo = self.root / "owner-files" / "second.jpg"
        Image.new("RGB", (16, 16), color=(10, 20, 30)).save(first_photo, "JPEG")
        Image.new("RGB", (16, 16), color=(40, 50, 60)).save(second_photo, "JPEG")
        media = lambda path: [{"path": str(path), "association": {"kind": "route"}}]
        first = propose_request(
            self.request(desired_route_id="gpx-first-media", media=media(first_photo)),
            self.root,
        )
        second = propose_request(
            self.request(desired_route_id="gpx-second-media", media=media(second_photo)),
            self.root,
        )
        first["media"] = second["media"]

        with self.assertRaises(RouteCreateError) as raised:
            apply_proposal(first, self.root, rebuild=lambda: None)

        self.assertEqual(raised.exception.code, "proposal.semantic_mismatch")
        self.assertEqual(json.loads((self.root / "quests.json").read_text())["routes"], [])

    def test_one_image_can_be_registered_for_two_annotations_and_retried(self):
        photo = self.root / "owner-files" / "shared.jpg"
        Image.new("RGB", (24, 16), color=(30, 90, 120)).save(photo, "JPEG")
        annotations = [
            {
                "id": annotation_id,
                "at_distance_m": distance,
                "kind": "warning",
                "evidence": "hypothesis",
                "body": body,
            }
            for annotation_id, distance, body in (
                ("first-view", 100, "First review point."),
                ("second-view", 200, "Second review point."),
            )
        ]
        proposal = propose_request(
            self.request(
                annotations=annotations,
                media=[
                    {
                        "path": str(photo),
                        "association": {"kind": "annotation", "annotation_id": annotation["id"]},
                    }
                    for annotation in annotations
                ],
            ),
            self.root,
        )

        apply_proposal(proposal, self.root, rebuild=lambda: None)
        route = json.loads((self.root / "quests.json").read_text())["routes"][0]
        self.assertEqual(len(route["source_media"]), 2)
        self.assertEqual(
            {item["association"]["annotation_id"] for item in route["source_media"]},
            {"first-view", "second-view"},
        )
        for item in proposal["media"]:
            (self.root / item["staged_path"]).unlink()
        retried = apply_proposal(proposal, self.root, rebuild=lambda: {"publishable": True})
        self.assertEqual(retried["result"], "already_applied")

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

    def test_invalid_optional_image_is_omitted_without_blocking_creation(self):
        invalid = self.root / "owner-files" / "not-an-image.jpg"
        invalid.write_text("not an image", encoding="utf-8")
        proposal = propose_request(
            self.request(
                annotations=[
                    {
                        "id": "invalid-photo",
                        "at_distance_m": 100,
                        "kind": "image",
                        "evidence": "hypothesis",
                        "body": "This annotation depends on the unreadable image.",
                    }
                ],
                media=[
                    {
                        "path": str(invalid),
                        "association": {
                            "kind": "annotation",
                            "annotation_id": "invalid-photo",
                        },
                    }
                ],
            ),
            self.root,
        )

        self.assertEqual(proposal["media"], [])
        self.assertNotIn("annotations", proposal["route_spec"])
        self.assertEqual(
            [warning["code"] for warning in proposal["warnings"][-2:]],
            ["media.invalid_image_omitted", "annotation.image_omitted"],
        )
        result = apply_proposal(proposal, self.root, rebuild=lambda: None)
        self.assertEqual(result["result"], "created")
        self.assertFalse((self.root / "route_sources/media").exists())

    def test_existing_route_media_update_preserves_prior_source_provenance(self):
        first_photo = self.root / "owner-files" / "first.jpg"
        second_photo = self.root / "owner-files" / "second.jpg"
        Image.new("RGB", (16, 16), color=(10, 20, 30)).save(first_photo, "JPEG")
        Image.new("RGB", (16, 16), color=(40, 50, 60)).save(second_photo, "JPEG")
        annotation = {
            "id": "ridge-view",
            "at_distance_m": 100,
            "kind": "warning",
            "evidence": "hypothesis",
            "body": "The ridge view.",
        }
        first = propose_request(
            self.request(
                annotations=[annotation],
                media=[
                    {
                        "path": str(first_photo),
                        "association": {"kind": "annotation", "annotation_id": "ridge-view"},
                    }
                ],
            ),
            self.root,
        )
        apply_proposal(first, self.root, rebuild=lambda: None)
        slug = first["route_spec"]["activity_id"]
        self.write_generated_detail(
            slug,
            distance_m=first["observations"]["distance_m"],
            temporal_status=first["observations"]["temporal"]["status"],
        )

        second = propose_request(
            {
                "schema_version": 1,
                "existing_slug": slug,
                "media": [
                    {
                        "path": str(second_photo),
                        "association": {"kind": "annotation", "annotation_id": "ridge-view"},
                    }
                ],
            },
            self.root,
        )
        apply_proposal(second, self.root, rebuild=lambda: None)
        route = json.loads((self.root / "quests.json").read_text())["routes"][0]

        self.assertEqual(len(route["source_media"]), 2)
        self.assertEqual(
            {record["sha256"] for record in route["source_media"]},
            {first["media"][0]["sha256"], second["media"][0]["sha256"]},
        )

    def test_existing_route_can_add_a_new_image_annotation(self):
        first = propose_request(self.request(), self.root)
        apply_proposal(first, self.root, rebuild=lambda: None)
        slug = first["route_spec"]["activity_id"]
        self.write_generated_detail(
            slug,
            distance_m=first["observations"]["distance_m"],
            temporal_status=first["observations"]["temporal"]["status"],
        )
        photo = self.root / "owner-files" / "new-annotation.jpg"
        Image.new("RGB", (16, 12), color=(70, 80, 90)).save(photo, "JPEG")
        update = propose_request(
            {
                "schema_version": 1,
                "existing_slug": slug,
                "annotations": [
                    {
                        "id": "new-image",
                        "at_distance_m": 100,
                        "kind": "image",
                        "evidence": "hypothesis",
                        "body": "Owner-selected image for this point.",
                    }
                ],
                "media": [
                    {
                        "path": str(photo),
                        "association": {"kind": "annotation", "annotation_id": "new-image"},
                    }
                ],
            },
            self.root,
        )

        apply_proposal(update, self.root, rebuild=lambda: None)
        route = json.loads((self.root / "quests.json").read_text())["routes"][0]
        self.assertTrue(route["annotations"][0]["media"]["url"].startswith(f"media/{slug}/"))

    def test_update_retry_validates_media_inherited_from_an_earlier_proposal(self):
        photo = self.root / "owner-files" / "route.jpg"
        Image.new("RGB", (16, 12), color=(20, 30, 40)).save(photo, "JPEG")
        first = propose_request(
            self.request(media=[{"path": str(photo), "association": {"kind": "route"}}]),
            self.root,
        )
        apply_proposal(first, self.root, rebuild=lambda: None)
        slug = first["route_spec"]["activity_id"]
        self.write_generated_detail(
            slug,
            distance_m=first["observations"]["distance_m"],
            temporal_status=first["observations"]["temporal"]["status"],
        )
        update = propose_request(
            {
                "schema_version": 1,
                "existing_slug": slug,
                "curation": {"vibe": "A revised route premise."},
            },
            self.root,
        )
        apply_proposal(update, self.root, rebuild=lambda: None)
        route = json.loads((self.root / "quests.json").read_text())["routes"][0]
        (self.root / route["source_media"][0]["path"]).unlink()

        with self.assertRaises(RouteCreateError) as raised:
            apply_proposal(update, self.root, rebuild=lambda: {"publishable": True})

        self.assertEqual(raised.exception.code, "media.missing_durable")

    def test_apply_rejects_tampered_capture_metadata(self):
        photo = self.root / "owner-files" / "metadata.jpg"
        Image.new("RGB", (16, 12), color=(20, 30, 40)).save(photo, "JPEG")
        proposal = propose_request(
            self.request(media=[{"path": str(photo), "association": {"kind": "route"}}]),
            self.root,
        )
        proposal["media"][0]["capture_metadata"] = {"status": "invented"}

        with self.assertRaises(RouteCreateError) as raised:
            apply_proposal(proposal, self.root, rebuild=lambda: None)

        self.assertEqual(raised.exception.code, "proposal.semantic_mismatch")

    def test_rebuild_failure_preserves_exit_code_without_streaming_private_paths(self):
        proposal = propose_request(self.request(), self.root)
        private_path = self.root / "owner-files" / "secret.gpx"
        rebuild = self.root / "rebuild.sh"
        rebuild.write_text(
            f"#!/bin/bash\nprintf '%s\\n' '{private_path}' >&2\nexit 7\n",
            encoding="utf-8",
        )
        rebuild.chmod(0o755)
        stderr = io.StringIO()

        with redirect_stderr(stderr), self.assertRaises(RouteCreateError) as raised:
            apply_proposal(proposal, self.root)

        self.assertEqual(raised.exception.exit_code, 7)
        self.assertEqual(stderr.getvalue(), "")
        recovery = self.root / ".route-share/recovery" / f"{proposal['proposal_id']}.json"
        report = json.loads(recovery.read_text(encoding="utf-8"))
        self.assertEqual(report["downstream_exit_code"], 7)
        self.assertNotIn(str(self.root), json.dumps(report))

    def test_cli_returns_the_downstream_validation_exit_code(self):
        proposal_path = self.root / "proposal.json"
        proposal_path.write_text("{}\n", encoding="utf-8")
        stderr = io.StringIO()

        with (
            patch(
                "route_create.apply_proposal",
                side_effect=RouteCreateError(
                    "create.validation_failed",
                    "validation failed",
                    exit_code=7,
                ),
            ),
            redirect_stderr(stderr),
        ):
            result = main(["create", "--proposal", str(proposal_path)])

        self.assertEqual(result, 7)
        self.assertEqual(json.loads(stderr.getvalue())["error"]["code"], "create.validation_failed")

    def test_unreadable_request_report_does_not_expose_absolute_paths(self):
        private_path = self.root / "private-owner-folder" / "missing-request.json"
        stderr = io.StringIO()

        with redirect_stderr(stderr):
            result = main(["propose", "--request", str(private_path)])

        self.assertEqual(result, 1)
        report = stderr.getvalue()
        self.assertIn("missing-request.json", report)
        self.assertNotIn(str(self.root), report)

    def test_repository_and_recovery_reports_redact_absolute_paths(self):
        missing_root = self.root / "private-owner-root"
        with self.assertRaises(RouteCreateError) as raised:
            propose_request(self.request(), missing_root)
        self.assertEqual(raised.exception.code, "repository.invalid_routes")
        self.assertNotIn(str(missing_root), str(raised.exception))

        proposal = propose_request(self.request(), self.root)
        private_path = self.root / "owner-files" / "secret.gpx"
        with self.assertRaises(RouteCreateError):
            apply_proposal(
                proposal,
                self.root,
                rebuild=lambda: (_ for _ in ()).throw(RuntimeError(str(private_path))),
            )
        recovery = self.root / ".route-share/recovery" / f"{proposal['proposal_id']}.json"
        self.assertNotIn(str(self.root), recovery.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
