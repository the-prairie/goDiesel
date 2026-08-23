import io
from pathlib import Path
import tempfile
import unittest

from http_file_delivery import (
    ArtifactNotFound,
    UnsatisfiableRange,
    parse_single_byte_range,
    resolve_studio_artifact,
    stream_bytes,
)


class ParseSingleByteRangeTests(unittest.TestCase):
    def test_missing_malformed_and_multipart_ranges_fall_back_to_full_response(self):
        for value in (
            None,
            "",
            "bytes=-",
            "items=0-9",
            "bytes=abc-def",
            "bytes=0 - 9",
            "bytes=0-1,4-5",
        ):
            with self.subTest(value=value):
                self.assertIsNone(parse_single_byte_range(value, 10_000))

    def test_prefix_open_ended_suffix_and_clamped_ranges(self):
        cases = {
            "bytes=0-999": (0, 999),
            "bytes=5000-": (5000, 9999),
            "bytes=-1000": (9000, 9999),
            "bytes=0-99999": (0, 9999),
            "bytes=-20000": (0, 9999),
            " bytes=3-3 ": (3, 3),
        }
        for value, expected in cases.items():
            with self.subTest(value=value):
                self.assertEqual(parse_single_byte_range(value, 10_000), expected)

    def test_well_formed_impossible_ranges_raise(self):
        for value, size in (
            ("bytes=10000-", 10_000),
            ("bytes=8000-7000", 10_000),
            ("bytes=-0", 10_000),
            ("bytes=0-0", 0),
            ("bytes=-1", 0),
        ):
            with self.subTest(value=value, size=size):
                with self.assertRaises(UnsatisfiableRange):
                    parse_single_byte_range(value, size)

    def test_negative_file_size_is_rejected(self):
        with self.assertRaises(ValueError):
            parse_single_byte_range(None, -1)


class StreamBytesTests(unittest.TestCase):
    def test_streams_only_the_requested_slice_in_bounded_reads(self):
        source = io.BytesIO(bytes(range(256)) * 32)
        destination = io.BytesIO()

        written = stream_bytes(
            source,
            destination,
            start=123,
            length=4097,
            chunk_size=257,
        )

        self.assertEqual(written, 4097)
        self.assertEqual(destination.getvalue(), source.getvalue()[123:4220])

    def test_disconnects_are_normal(self):
        class DisconnectingWriter:
            def __init__(self, error):
                self.error = error

            def write(self, _chunk):
                raise self.error

        for error in (
            BrokenPipeError(),
            ConnectionResetError(),
            ConnectionAbortedError(),
        ):
            with self.subTest(error=type(error).__name__):
                written = stream_bytes(
                    io.BytesIO(b"0123456789"),
                    DisconnectingWriter(error),
                    start=0,
                    length=10,
                    chunk_size=2,
                )
                self.assertEqual(written, 0)


class ResolveStudioArtifactTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.job_id = "job-abc"
        self.expected = f".route-studio/artifacts/{self.job_id}/teaser.mp4"
        self.path = self.root / self.expected
        self.path.parent.mkdir(parents=True)
        self.path.write_bytes(b"film")

    def tearDown(self):
        self.temporary.cleanup()

    def test_exact_allowlisted_contained_file_is_returned(self):
        record = {"path": self.expected, "sha256": "a" * 64}
        path, artifact = resolve_studio_artifact(
            self.root,
            {"artifacts": [record]},
            self.job_id,
            "teaser.mp4",
        )
        self.assertEqual(path, self.path.resolve())
        self.assertIs(artifact, record)

    def test_unlisted_file_is_not_found_even_when_it_exists(self):
        with self.assertRaises(ArtifactNotFound):
            resolve_studio_artifact(
                self.root,
                {"artifacts": []},
                self.job_id,
                "teaser.mp4",
            )

    def test_resolved_path_must_remain_directly_inside_the_job_artifact_root(self):
        outside = self.root / "outside.mp4"
        outside.write_bytes(b"outside")
        self.path.unlink()
        self.path.symlink_to(outside)
        with self.assertRaises(ArtifactNotFound):
            resolve_studio_artifact(
                self.root,
                {"artifacts": [{"path": self.expected}]},
                self.job_id,
                "teaser.mp4",
            )


if __name__ == "__main__":
    unittest.main()
