"""Reading a photograph, and never republishing what it revealed."""

import tempfile
import unittest
from datetime import datetime, timezone
from fractions import Fraction
from pathlib import Path

from PIL import Image

from route_media import publish_photo, read_photo_metadata


def write_photo(path, *, lat=None, lng=None, gps_utc=None, local=None, size=(60, 40)):
    """Write a JPEG, optionally with GPS coordinates and timestamps."""
    image = Image.new("RGB", size, (90, 120, 90))
    exif = image.getexif()
    if lat is not None:
        gps = {
            1: "N" if lat >= 0 else "S",
            2: _dms(abs(lat)),
            3: "E" if lng >= 0 else "W",
            4: _dms(abs(lng)),
        }
        if gps_utc is not None:
            gps[29] = gps_utc.strftime("%Y:%m:%d")
            gps[7] = (
                Fraction(gps_utc.hour), Fraction(gps_utc.minute), Fraction(gps_utc.second)
            )
        exif.get_ifd(0x8825).update(gps)
    if local is not None:
        exif.get_ifd(0x8769)[0x9003] = local.strftime("%Y:%m:%d %H:%M:%S")
    image.save(path, "JPEG", exif=exif)
    return path


def _dms(value):
    degrees = int(value)
    minutes = int((value - degrees) * 60)
    seconds = (value - degrees - minutes / 60) * 3600
    return (Fraction(degrees), Fraction(minutes), Fraction(seconds).limit_denominator(10000))


class ReadPhotoMetadataTest(unittest.TestCase):
    def test_reads_coordinates(self):
        with tempfile.TemporaryDirectory() as directory:
            path = write_photo(Path(directory) / "a.jpg", lat=35.68, lng=139.77)

            data = read_photo_metadata(path)

            self.assertAlmostEqual(data["lat"], 35.68, places=3)
            self.assertAlmostEqual(data["lng"], 139.77, places=3)

    def test_reads_a_southern_and_western_position(self):
        with tempfile.TemporaryDirectory() as directory:
            path = write_photo(Path(directory) / "a.jpg", lat=-8.42, lng=-34.88)

            data = read_photo_metadata(path)

            self.assertLess(data["lat"], 0)
            self.assertLess(data["lng"], 0)

    def test_prefers_the_gps_clock_which_is_utc(self):
        taken = datetime(2025, 11, 26, 21, 30, 0, tzinfo=timezone.utc)
        with tempfile.TemporaryDirectory() as directory:
            path = write_photo(
                Path(directory) / "a.jpg", lat=35.68, lng=139.77, gps_utc=taken,
                local=datetime(2025, 11, 27, 6, 30, 0),
            )

            data = read_photo_metadata(path, fallback_time_zone="Asia/Tokyo")

            self.assertEqual(data["taken_utc"], taken)

    def test_falls_back_to_the_local_stamp_read_in_the_route_time_zone(self):
        """The trap the removed matcher walked into.

        DateTimeOriginal is local with no zone. Tokyo is UTC+9, so 06:30 local
        on the 27th is 21:30 UTC on the 26th. Reading it as UTC is nine hours
        wrong, which would place a photograph on the wrong part of a route, or
        on no route at all.
        """
        with tempfile.TemporaryDirectory() as directory:
            path = write_photo(
                Path(directory) / "a.jpg", lat=35.68, lng=139.77,
                local=datetime(2025, 11, 27, 6, 30, 0),
            )

            data = read_photo_metadata(path, fallback_time_zone="Asia/Tokyo")

            self.assertEqual(
                data["taken_utc"], datetime(2025, 11, 26, 21, 30, tzinfo=timezone.utc)
            )

    def test_a_local_stamp_without_a_zone_is_not_guessed(self):
        with tempfile.TemporaryDirectory() as directory:
            path = write_photo(
                Path(directory) / "a.jpg", lat=35.68, lng=139.77,
                local=datetime(2025, 11, 27, 6, 30, 0),
            )

            self.assertIsNone(read_photo_metadata(path)["taken_utc"])

    def test_a_screenshot_has_no_position(self):
        with tempfile.TemporaryDirectory() as directory:
            path = write_photo(Path(directory) / "a.jpg")

            data = read_photo_metadata(path)

            self.assertIsNone(data["lat"])
            self.assertIsNone(data["taken_utc"])


class PublishPhotoTest(unittest.TestCase):
    def test_a_published_photograph_carries_no_exif(self):
        """Read the location, then remove it from what ships."""
        taken = datetime(2025, 11, 26, 21, 30, 0, tzinfo=timezone.utc)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = write_photo(
                root / "in.jpg", lat=35.68, lng=139.77, gps_utc=taken, size=(2400, 1600)
            )
            self.assertIsNotNone(read_photo_metadata(source)["lat"])

            published = publish_photo(source, root / "out", "slug-1", "abc123")

            full = root / "out" / "abc123.jpg"
            self.assertTrue(full.is_file())
            self.assertTrue((root / "out" / "abc123-thumb.jpg").is_file())
            stripped = read_photo_metadata(full)
            self.assertIsNone(stripped["lat"])
            self.assertIsNone(stripped["taken_utc"])
            self.assertLessEqual(published["width"], 1600)
            self.assertEqual(published["url"], "media/slug-1/abc123.jpg")


if __name__ == "__main__":
    unittest.main()
