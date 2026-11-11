import json
import unittest
from pathlib import Path

from quest_meta import (
    build_quest_meta,
    build_replay_metadata,
    build_route_curation,
    curated_best_in_earth_ids,
    elevation_gain_m,
)


class QuestMetaTests(unittest.TestCase):
    def test_build_route_curation_accepts_complete_reviewed_editorial_data(self):
        curation = build_route_curation({
            "vibe": "Quiet temple lanes opening into a sustained climb.",
            "ideal_use": "A long, unhurried exploration day.",
            "terrain": ["Paved lanes", "Steep hillside roads"],
            "difficulty": "Demanding",
            "highlights": ["Temple district", "Eastern hills"],
            "caveats": ["Expect frequent road crossings"],
            "seasonality": "Best in cool, dry weather.",
            "editorial_note": "A city route preserved for its contrast and scale.",
            "review_status": "reviewed",
        })

        self.assertEqual(curation["review_status"], "reviewed")
        self.assertEqual(curation["terrain"], ["Paved lanes", "Steep hillside roads"])

    def test_build_route_curation_omits_missing_draft_fields(self):
        self.assertEqual(
            build_route_curation({
                "vibe": "Riverside miles through the city.",
                "review_status": "draft",
            }),
            {
                "vibe": "Riverside miles through the city.",
                "review_status": "draft",
            },
        )

    def test_build_route_curation_rejects_incomplete_reviewed_data(self):
        with self.assertRaisesRegex(ValueError, "reviewed curation is missing ideal_use"):
            build_route_curation({
                "vibe": "Riverside miles through the city.",
                "review_status": "reviewed",
            })

    def test_build_route_curation_rejects_unknown_fields(self):
        with self.assertRaisesRegex(ValueError, "curation has unknown fields: vbie"):
            build_route_curation({
                "vbie": "Typo that must not disappear silently.",
                "review_status": "draft",
            })

    def test_replay_metadata_requires_two_route_points(self):
        best_ids = {"route-1"}

        for point_count in (0, 1):
            replay = build_replay_metadata("route-1", point_count, best_ids)
            self.assertFalse(replay["replay_eligible"])
            self.assertFalse(replay["best_in_earth"])
            self.assertEqual(replay["mode"], "atlas")
            self.assertEqual(replay["geometry_status"], "missing")

        ready = build_replay_metadata("route-1", 2, best_ids)
        self.assertTrue(ready["replay_eligible"])
        self.assertTrue(ready["best_in_earth"])
        self.assertEqual(ready["mode"], "earth")
        self.assertEqual(ready["geometry_status"], "ready")

        planned = build_replay_metadata("route-1", 2, best_ids, "planned")
        self.assertFalse(planned["replay_eligible"])
        self.assertFalse(planned["best_in_earth"])
        self.assertEqual(planned["mode"], "atlas")
        self.assertEqual(planned["geometry_status"], "ready")

        discovered = build_replay_metadata("route-2", 2, best_ids, "discovered")
        self.assertTrue(discovered["replay_eligible"])
        self.assertFalse(discovered["best_in_earth"])
        self.assertEqual(discovered["mode"], "atlas")

        with self.assertRaisesRegex(ValueError, "replay lifecycle"):
            build_replay_metadata("route-1", 2, best_ids, "unknown")

    def test_elevation_gain_only_counts_climbs(self):
        route = [
            {"elev": 100},
            {"elev": 130},
            {"elev": 120},
            {"elev": 170},
        ]

        self.assertEqual(elevation_gain_m(route), 80)

    def test_short_flat_city_run_becomes_local_spark(self):
        meta = build_quest_meta(
            activity_type="Run",
            distance_km=4.8,
            elevation_gain=18,
            region_label="Tokyo, Japan",
            activity_name="crosswalk sprints",
        )

        self.assertEqual(meta["effort_tier"], "Easy")
        self.assertEqual(meta["theme"], "Local Spark")
        self.assertEqual(meta["xp"], 90)
        self.assertIn("Complete a 4.8 km run", meta["completion_rule"])

    def test_long_climbing_ride_becomes_big_day(self):
        meta = build_quest_meta(
            activity_type="Ride",
            distance_km=84.2,
            elevation_gain=1240,
            region_label="Victoria, BC",
            activity_name="island roll",
        )

        self.assertEqual(meta["effort_tier"], "Epic")
        self.assertEqual(meta["theme"], "Big Day")
        self.assertEqual(meta["xp"], 1240)
        self.assertIn("1,240 m of climbing", meta["completion_rule"])

    def test_unknown_elevation_does_not_claim_a_zero_climb(self):
        meta = build_quest_meta(
            activity_type="Run",
            distance_km=12.4,
            elevation_gain=None,
            region_label="High Plateau",
            activity_name="Imported line",
        )

        self.assertIsNone(meta["elevation_gain_m"])
        self.assertEqual(meta["elevation_status"], "unavailable")
        self.assertEqual(
            meta["completion_rule"], "Complete a 12.4 km run in High Plateau."
        )
        self.assertNotIn("climb", meta["completion_rule"])
        # Scoring falls back to distance alone rather than inventing a climb.
        self.assertEqual(meta["effort_tier"], "Moderate")
        self.assertEqual(meta["xp"], 150)

    def test_recorded_elevation_carries_no_status_field(self):
        meta = build_quest_meta(
            activity_type="Run",
            distance_km=4.8,
            elevation_gain=0,
            region_label="Tokyo, Japan",
            activity_name="crosswalk sprints",
        )

        self.assertEqual(meta["elevation_gain_m"], 0)
        self.assertNotIn("elevation_status", meta)
        self.assertIn("about 0 m of climbing", meta["completion_rule"])

    def test_best_in_earth_comes_from_quests_json(self):
        quests_path = Path(__file__).resolve().parent / "quests.json"
        routes = json.loads(quests_path.read_text())["routes"]
        self.assertEqual(
            curated_best_in_earth_ids(routes),
            {
                "13935098460",
                "14349820520",
                "17636880071",
                "17654151284",
                "13358070690",
                "9959792315",
                "9934715694",
            },
        )
        with self.assertRaisesRegex(ValueError, "best_in_earth"):
            curated_best_in_earth_ids([{"activity_id": "1", "best_in_earth": "yes"}])


if __name__ == "__main__":
    unittest.main()


# Route triage status is a closed set. A missing or unrecognised status means
# pending, which is never published, in every reader.
import pytest

from quest_meta import ROUTE_STATUSES, normalize_route_status, validate_route_status


QUESTS_JSON = Path(__file__).resolve().parent / "quests.json"


def test_route_statuses_are_closed():
    assert ROUTE_STATUSES == ("pending", "approved", "archived")


@pytest.mark.parametrize("raw,expected", [
    ("pending", "pending"),
    ("approved", "approved"),
    ("archived", "archived"),
    ("rejected", "archived"),
    (None, "pending"),
    ("", "pending"),
    ("Approved", "pending"),
    (" approved", "pending"),
    ("published", "pending"),
    (True, "pending"),
    (["approved"], "pending"),
    ({"status": "approved"}, "pending"),
])
def test_normalize_route_status(raw, expected):
    assert normalize_route_status(raw) == expected


@pytest.mark.parametrize("status", ROUTE_STATUSES)
def test_validate_route_status_accepts_the_closed_set(status):
    assert validate_route_status(status) == status


@pytest.mark.parametrize("status", ["rejected", None, "", "Approved", "published", 1])
def test_validate_route_status_rejects_anything_else_on_write(status):
    with pytest.raises(ValueError, match="status must be one of: pending, approved, archived"):
        validate_route_status(status)


def test_committed_quests_json_has_only_known_route_statuses():
    """Proof that a missing status defaulting to pending changes no published output.

    build.py once read a missing status as approved. Every committed route
    carries an explicit status from the closed set (plus legacy `rejected`),
    so reading a missing one as pending cannot unpublish anything today.
    """
    config = json.loads(QUESTS_JSON.read_text(encoding="utf-8"))
    routes = config.get("routes", config.get("quests", []))
    assert routes
    offending = [
        (route.get("activity_id"), route.get("status", "<missing>"))
        for route in routes
        if route.get("status") not in {*ROUTE_STATUSES, "rejected"}
    ]
    assert offending == []
    legacy_approved = [
        route for route in routes if route.get("status", "approved") == "approved"
    ]
    normalized_approved = [
        route for route in routes if normalize_route_status(route.get("status")) == "approved"
    ]
    assert normalized_approved == legacy_approved
