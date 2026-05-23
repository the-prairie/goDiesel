import unittest

from quest_meta import build_quest_meta, elevation_gain_m


class QuestMetaTests(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
