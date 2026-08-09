"""Video ingest, proven against two real iPhone clips from a real route.

The fixtures are one-second cuts of videos shot during Kyoto route 17654151284
on 25 November 2025. They are cut with `-c copy -movflags use_metadata_tags`, so
they carry the original Apple metadata while staying small. The expected anchors
below were measured against the full-length originals and must not drift.
"""

import json
import shutil
import tempfile
import unittest
from datetime import timedelta
from pathlib import Path

from route_media import (
    extract_frame,
    frame_photo,
    match_photo_to_route,
    read_video_metadata,
)

ROOT = Path(__file__).resolve().parent
FIXTURES = ROOT / "route_sources" / "video-fixtures"
KYOTO = ROOT / "app/public/data/routes/17654151284.json"

# Measured against the full originals, not the trimmed fixtures.
EXPECTED = {
    "kyoto-stairway.mov": {"at_distance_m": 7519.3, "altitude_m": 285.845},
    "kyoto-summit.mov": {"at_distance_m": 8632.4, "altitude_m": 469.875},
}


def kyoto_route():
    detail = json.loads(KYOTO.read_text(encoding="utf-8"))
    return detail["route"], detail["provenance"]["temporal"]


@unittest.skipUnless(shutil.which("ffprobe"), "ffprobe is required to read a video")
class VideoIngestTest(unittest.TestCase):
    def test_the_apple_creation_date_carries_a_utc_offset(self):
        """A photograph's DateTimeOriginal does not, which is why video is better."""
        video = read_video_metadata(FIXTURES / "kyoto-stairway.mov")

        self.assertIsNotNone(video["taken_utc"])
        self.assertEqual(video["taken_utc"].isoformat(), "2025-11-24T22:50:41+00:00")

    def test_position_and_altitude_are_read(self):
        video = read_video_metadata(FIXTURES / "kyoto-summit.mov")

        self.assertAlmostEqual(video["lat"], 35.0196, places=4)
        self.assertAlmostEqual(video["lng"], 135.8116, places=4)
        self.assertAlmostEqual(video["altitude_m"], 469.875, places=2)
        self.assertEqual(video["model"], "iPhone 13")

    def test_both_videos_place_on_the_route_with_high_confidence(self):
        route, temporal = kyoto_route()

        for name, expected in EXPECTED.items():
            with self.subTest(video=name):
                video = read_video_metadata(FIXTURES / name)
                match = match_photo_to_route(frame_photo(video, 0), route, temporal)

                self.assertEqual(match["confidence"], "high")
                self.assertEqual(match["evidence"], "recorded")
                self.assertAlmostEqual(
                    match["at_distance_m"], expected["at_distance_m"], delta=1.0
                )

    def test_recorded_elevation_agrees_with_the_video_altitude(self):
        """An independent control: the matcher never reads altitude.

        GPS altitude is two to three times less accurate than horizontal
        position, so agreement within 40 m confirms the anchor from a signal
        the match did not use.
        """
        route, temporal = kyoto_route()

        for name, expected in EXPECTED.items():
            with self.subTest(video=name):
                video = read_video_metadata(FIXTURES / name)
                match = match_photo_to_route(frame_photo(video, 0), route, temporal)
                point = min(
                    route, key=lambda p: abs(p["d"] - match["at_distance_m"])
                )

                self.assertAlmostEqual(
                    point["elev"], expected["altitude_m"], delta=40.0
                )

    def test_a_later_frame_anchors_further_along_the_route(self):
        """The whole point of video: one clip yields several placed frames."""
        route, temporal = kyoto_route()
        video = read_video_metadata(FIXTURES / "kyoto-stairway.mov")

        first = match_photo_to_route(frame_photo(video, 0), route, temporal)
        later = match_photo_to_route(frame_photo(video, 600), route, temporal)

        self.assertEqual(first["confidence"], "high")
        self.assertGreater(later["at_distance_m"], first["at_distance_m"])

    @unittest.skipUnless(shutil.which("ffmpeg"), "ffmpeg is required to cut a frame")
    def test_an_extracted_frame_carries_no_metadata_of_its_own(self):
        from route_media import read_photo_metadata

        with tempfile.TemporaryDirectory() as directory:
            frame = extract_frame(
                FIXTURES / "kyoto-summit.mov", 0.5, Path(directory) / "frame.png"
            )

            self.assertTrue(frame.is_file())
            self.assertIsNone(read_photo_metadata(frame)["lat"])


if __name__ == "__main__":
    unittest.main()
