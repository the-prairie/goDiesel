import unittest

from quest_meta import (
    build_quest_meta,
    build_replay_metadata,
    build_route_curation,
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

        self.assertEqual(meta["difficulty"], "Easy")
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

        self.assertEqual(meta["difficulty"], "Epic")
        self.assertEqual(meta["theme"], "Big Day")
        self.assertEqual(meta["xp"], 1240)
        self.assertIn("1,240 m of climbing", meta["completion_rule"])

    def test_unavailable_elevation_does_not_create_a_zero_climb_claim(self):
        meta = build_quest_meta(
            activity_type="Run",
            distance_km=12.4,
            elevation_gain=None,
            region_label="High Plateau",
            activity_name="Imported line",
        )

        self.assertIsNone(meta["elevation_gain_m"])
        self.assertEqual(
            meta["completion_rule"],
            "Complete a 12.4 km run in High Plateau.",
        )


if __name__ == "__main__":
    unittest.main()
