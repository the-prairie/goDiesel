import unittest

from route_manifest import manifest_discontinuities, simplify_route_for_manifest


def track(count, step=100.0):
    return [{"lat": 50 + i * 0.001, "lng": -115.0, "elev": 1000 + i, "d": i * step} for i in range(count)]


GAP = {
    "kind": "missing_position_records",
    "source": "recorded_position_absence",
    "start_d": 4_950.0,
    "end_d": 5_050.0,
    "elapsed_time_s": 15,
    "missing_record_count": 2,
}


class ManifestTraceTest(unittest.TestCase):
    def test_short_routes_are_unchanged(self):
        points = track(10)
        self.assertEqual(len(simplify_route_for_manifest(points)), 10)

    def test_without_gaps_sampling_is_unchanged(self):
        points = track(1000)
        simplified = simplify_route_for_manifest(points)
        self.assertEqual(len(simplified), 96)
        self.assertEqual(simplified[0][3], 0.0)
        self.assertEqual(simplified[-1][3], 99_900.0)

    def test_the_points_either_side_of_a_recorded_gap_are_kept(self):
        points = [p for p in track(1000, step=10.0) if not (4_950.0 < p["d"] < 5_050.0)]
        simplified = simplify_route_for_manifest(points, [GAP])
        distances = [p[3] for p in simplified]
        self.assertIn(4_950.0, distances)
        self.assertIn(5_050.0, distances)
        self.assertLessEqual(len(simplified), 98)
        self.assertEqual(distances, sorted(distances))

    def test_summaries_carry_recorded_gaps_without_derived_extras(self):
        self.assertEqual(
            manifest_discontinuities({"provenance": {"discontinuities": [GAP]}}),
            [{"kind": "missing_position_records", "source": "recorded_position_absence", "start_d": 4_950.0, "end_d": 5_050.0}],
        )
        self.assertEqual(manifest_discontinuities({"provenance": {"discontinuities": []}}), [])


if __name__ == "__main__":
    unittest.main()
