"""Time and position together, because position alone was the old defect."""

import unittest
from datetime import datetime, timedelta, timezone

from route_media import (
    haversine_m,
    match_photo_to_route,
)

START = datetime(2025, 11, 26, 21, 21, 5, tzinfo=timezone.utc)
TEMPORAL = {
    "status": "recorded",
    "start_time_utc": "2025-11-26T21:21:05Z",
    "elapsed_time_s": 3600,
}

# An out-and-back: out along a line, then back over the same coordinates.
OUT_AND_BACK = [
    {"lat": 35.0000, "lng": 139.0000, "d": 0.0, "elapsed_s": 0},
    {"lat": 35.0100, "lng": 139.0000, "d": 1112.0, "elapsed_s": 600},
    {"lat": 35.0200, "lng": 139.0000, "d": 2224.0, "elapsed_s": 1200},
    {"lat": 35.0100, "lng": 139.0000, "d": 3336.0, "elapsed_s": 2400},
    {"lat": 35.0000, "lng": 139.0000, "d": 4448.0, "elapsed_s": 3600},
]


def photo(lat, lng, minutes=None):
    item = {"lat": lat, "lng": lng}
    if minutes is not None:
        item["taken_utc"] = START + timedelta(minutes=minutes)
    return item


class MatchPhotoToRouteTest(unittest.TestCase):
    def test_time_and_position_together_give_high_confidence(self):
        result = match_photo_to_route(photo(35.0200, 139.0000, 20), OUT_AND_BACK, TEMPORAL)

        self.assertEqual(result["confidence"], "high")
        self.assertEqual(result["evidence"], "recorded")
        self.assertAlmostEqual(result["at_distance_m"], 2224.0)

    def test_time_disambiguates_an_out_and_back(self):
        """The reason position alone is not enough.

        The same coordinates occur at 1112 m on the way out and 3336 m on the
        way back. Only the clock can choose between them.
        """
        outward = match_photo_to_route(photo(35.0100, 139.0000, 10), OUT_AND_BACK, TEMPORAL)
        homeward = match_photo_to_route(photo(35.0100, 139.0000, 40), OUT_AND_BACK, TEMPORAL)

        self.assertEqual(outward["at_distance_m"], 1112.0)
        self.assertEqual(homeward["at_distance_m"], 3336.0)
        self.assertEqual(outward["confidence"], "high")
        self.assertEqual(homeward["confidence"], "high")

    def test_a_photograph_from_another_day_does_not_match(self):
        """The old matcher's exact failure: no date filter at all."""
        item = photo(35.0200, 139.0000)
        item["taken_utc"] = START - timedelta(days=400)

        result = match_photo_to_route(item, OUT_AND_BACK, TEMPORAL)

        self.assertEqual(result["confidence"], "medium")
        self.assertIn("time is unconfirmed", result["reason"])

    def test_a_photograph_far_from_the_route_is_refused(self):
        """500 km away is what the removed matcher accepted."""
        result = match_photo_to_route(photo(41.9, 12.5), OUT_AND_BACK, TEMPORAL)

        self.assertEqual(result["confidence"], "none")
        self.assertEqual(result["evidence"], "hypothesis")

    def test_the_right_time_at_the_wrong_place_is_a_hypothesis(self):
        result = match_photo_to_route(photo(35.5000, 139.5000, 20), OUT_AND_BACK, TEMPORAL)

        self.assertEqual(result["confidence"], "low")
        self.assertEqual(result["evidence"], "hypothesis")

    def test_a_scouted_route_can_still_match_on_position(self):
        """A scouted route has no recorded time, so only position is available."""
        result = match_photo_to_route(
            photo(35.0200, 139.0000), OUT_AND_BACK, {"status": "unavailable"}
        )

        self.assertEqual(result["confidence"], "medium")
        self.assertAlmostEqual(result["at_distance_m"], 2224.0)

    def test_a_photograph_without_coordinates_cannot_be_placed(self):
        result = match_photo_to_route({"lat": None, "lng": None}, OUT_AND_BACK, TEMPORAL)

        self.assertEqual(result["confidence"], "none")
        self.assertIn("no coordinates", result["reason"])

    def test_no_geometry_means_no_match(self):
        result = match_photo_to_route(photo(35.0, 139.0, 1), [], TEMPORAL)

        self.assertEqual(result["confidence"], "none")


class TimeGatePositionInstrumentTest(unittest.TestCase):
    """Time decides which stretch. Position decides where within it.

    Measured on a real clip: anchoring by interpolated time alone moved the
    summit video 24 m away from a recorded point its GPS agreed with to 0.9 m.
    Anchoring by position alone cannot tell the two passes of an out-and-back
    apart. Only the combination is right in both cases.
    """

    def test_position_picks_the_anchor_inside_the_time_window(self):
        """Two recorded points fall inside the gate; the nearer one wins."""
        route = [
            {"lat": 35.0000, "lng": 139.0000, "d": 0.0, "elapsed_s": 0},
            {"lat": 35.0010, "lng": 139.0000, "d": 111.0, "elapsed_s": 60},
            {"lat": 35.0020, "lng": 139.0000, "d": 222.0, "elapsed_s": 120},
        ]
        temporal = {
            "status": "recorded",
            "start_time_utc": "2025-01-01T00:00:00Z",
            "elapsed_time_s": 120,
        }
        # Shot at 60 s, but standing exactly on the 120 s point.
        item = {"lat": 35.0020, "lng": 139.0000, "taken_utc": START.replace(
            year=2025, month=1, day=1, hour=0, minute=1, second=0
        )}

        result = match_photo_to_route(item, route, temporal)

        self.assertEqual(result["at_distance_m"], 222.0)
        self.assertLess(result["separation_m"], 1.0)

    def test_the_time_gate_still_excludes_a_distant_pass(self):
        """Without the gate, position alone would pick the wrong pass."""
        result = match_photo_to_route(
            photo(35.0100, 139.0000, 10), OUT_AND_BACK, TEMPORAL
        )

        self.assertEqual(result["at_distance_m"], 1112.0)


class HaversineTest(unittest.TestCase):
    def test_a_known_separation(self):
        # One hundredth of a degree of latitude is about 1.11 km.
        self.assertAlmostEqual(haversine_m(35.0, 139.0, 35.01, 139.0), 1112, delta=5)


if __name__ == "__main__":
    unittest.main()
