from __future__ import annotations

import hashlib
import http.client
import importlib.util
import os
from pathlib import Path
import socket
import sys
import tempfile
import threading
import unittest
from unittest import mock


REPOSITORY_ROOT = Path(__file__).resolve().parent
ALLOWED_ORIGIN = "http://127.0.0.1:8787"


class FakeStudio:
    def __init__(self, module, job_id: str, artifacts: list[dict[str, object]]):
        self.module = module
        self.job_id = job_id
        self.artifacts = artifacts

    def get_job(self, job_id: str):
        if job_id != self.job_id:
            raise self.module.StudioNotFound("Studio job was not found")
        return {"id": job_id, "artifacts": list(self.artifacts)}


class AdminArtifactDeliveryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory()
        cls.root = Path(cls.temporary.name)
        cls.checkout = cls.root / "checkout"
        cls.diaries = cls.root / "diaries"
        cls.checkout.mkdir()
        cls.diaries.mkdir()
        (cls.checkout / "quests.json").write_text('{"routes": []}\n', encoding="utf-8")
        (cls.diaries / "activities.csv").write_text(
            "Activity Date,Filename\n",
            encoding="utf-8",
        )

        previous_checkout = os.environ.get("GODIESEL_CHECKOUT_ROOT")
        previous_diaries = os.environ.get("GODIESEL_DIESEL_DIARIES_ROOT")
        os.environ["GODIESEL_CHECKOUT_ROOT"] = str(cls.checkout)
        os.environ["GODIESEL_DIESEL_DIARIES_ROOT"] = str(cls.diaries)
        try:
            spec = importlib.util.spec_from_file_location(
                "godiesel_admin_artifact_test",
                REPOSITORY_ROOT / "admin.py",
            )
            assert spec is not None and spec.loader is not None
            module = importlib.util.module_from_spec(spec)
            sys.modules[spec.name] = module
            spec.loader.exec_module(module)
            cls.admin = module
        finally:
            if previous_checkout is None:
                os.environ.pop("GODIESEL_CHECKOUT_ROOT", None)
            else:
                os.environ["GODIESEL_CHECKOUT_ROOT"] = previous_checkout
            if previous_diaries is None:
                os.environ.pop("GODIESEL_DIESEL_DIARIES_ROOT", None)
            else:
                os.environ["GODIESEL_DIESEL_DIARIES_ROOT"] = previous_diaries

        cls.admin.STUDIO.close()
        cls.job_id = "job-artifact"
        cls.filename = "teaser.mp4"
        cls.relative_path = f".route-studio/artifacts/{cls.job_id}/{cls.filename}"
        cls.artifact_path = cls.checkout / cls.relative_path
        cls.artifact_path.parent.mkdir(parents=True)
        cls.payload = bytes(range(256)) * 64
        cls.artifact_path.write_bytes(cls.payload)
        cls.record = {
            "path": cls.relative_path,
            "sha256": hashlib.sha256(cls.payload).hexdigest(),
        }
        cls.fake_studio = FakeStudio(cls.admin, cls.job_id, [cls.record])
        cls.admin.STUDIO = cls.fake_studio
        cls.server = cls.admin.ThreadingHTTPServer(
            ("127.0.0.1", 0),
            cls.admin.Handler,
        )
        cls.server_errors = []
        cls.server.handle_error = lambda request, client_address: cls.server_errors.append(client_address)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.port = cls.server.server_address[1]

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=5)
        sys.modules.pop("godiesel_admin_artifact_test", None)
        cls.temporary.cleanup()

    def setUp(self):
        self.artifact_path.unlink(missing_ok=True)
        self.artifact_path.parent.mkdir(parents=True, exist_ok=True)
        self.artifact_path.write_bytes(self.payload)
        self.record["sha256"] = hashlib.sha256(self.payload).hexdigest()
        self.fake_studio.artifacts = [self.record]

    @property
    def endpoint(self):
        return f"/api/studio/artifacts/{self.job_id}/{self.filename}"

    def request(self, method="GET", *, range_value=None, endpoint=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=30)
        headers = {"Origin": ALLOWED_ORIGIN}
        if range_value is not None:
            headers["Range"] = range_value
        connection.request(method, endpoint or self.endpoint, headers=headers)
        response = connection.getresponse()
        body = response.read()
        result = response.status, dict(response.getheaders()), body
        connection.close()
        return result

    def assert_common_headers(self, headers, content_length):
        self.assertEqual(headers["Accept-Ranges"], "bytes")
        self.assertEqual(headers["Cache-Control"], "private, no-store")
        self.assertEqual(headers["Content-Length"], str(content_length))
        self.assertEqual(headers["Content-Type"], "video/mp4")
        self.assertEqual(
            headers["Content-Disposition"],
            'inline; filename="teaser.mp4"',
        )
        self.assertEqual(headers["X-Content-Type-Options"], "nosniff")
        self.assertEqual(headers["Access-Control-Allow-Origin"], ALLOWED_ORIGIN)
        exposed = headers["Access-Control-Expose-Headers"]
        self.assertIn("Content-Range", exposed)
        self.assertIn("Accept-Ranges", exposed)

    def test_full_request_is_streamed_with_200(self):
        status, headers, body = self.request()
        self.assertEqual(status, 200)
        self.assert_common_headers(headers, len(self.payload))
        self.assertNotIn("Content-Range", headers)
        self.assertEqual(body, self.payload)

    def test_prefix_open_ended_and_suffix_ranges_are_exact(self):
        cases = (
            ("bytes=100-299", 100, 299),
            ("bytes=16000-", 16000, len(self.payload) - 1),
            ("bytes=-257", len(self.payload) - 257, len(self.payload) - 1),
            ("bytes=0-999999", 0, len(self.payload) - 1),
        )
        for value, start, end in cases:
            with self.subTest(value=value):
                status, headers, body = self.request(range_value=value)
                self.assertEqual(status, 206)
                self.assert_common_headers(headers, end - start + 1)
                self.assertEqual(
                    headers["Content-Range"],
                    f"bytes {start}-{end}/{len(self.payload)}",
                )
                self.assertEqual(body, self.payload[start : end + 1])

    def test_impossible_range_returns_416(self):
        status, headers, body = self.request(
            range_value=f"bytes={len(self.payload)}-",
        )
        self.assertEqual(status, 416)
        self.assert_common_headers(headers, 0)
        self.assertEqual(
            headers["Content-Range"],
            f"bytes */{len(self.payload)}",
        )
        self.assertEqual(body, b"")

    def test_malformed_and_multipart_ranges_fall_back_to_full_200(self):
        for value in ("not-a-range", "bytes=0-1,4-5"):
            with self.subTest(value=value):
                status, headers, body = self.request(range_value=value)
                self.assertEqual(status, 200)
                self.assert_common_headers(headers, len(self.payload))
                self.assertNotIn("Content-Range", headers)
                self.assertEqual(body, self.payload)

    def test_head_uses_same_validation_and_writes_no_body(self):
        status, headers, body = self.request(method="HEAD")
        self.assertEqual(status, 200)
        self.assert_common_headers(headers, len(self.payload))
        self.assertNotIn("Content-Range", headers)
        self.assertEqual(body, b"")

    def test_sparse_one_gibibyte_artifact_returns_only_requested_bytes(self):
        logical_size = 1024 * 1024 * 1024
        offset = 768 * 1024 * 1024 + 123
        expected = bytes((index * 17) % 256 for index in range(4096))
        with self.artifact_path.open("wb") as artifact:
            artifact.truncate(logical_size)
            artifact.seek(offset)
            artifact.write(expected)
        self.record["sha256"] = "f" * 64

        status, headers, body = self.request(
            range_value=f"bytes={offset}-{offset + len(expected) - 1}",
        )
        self.assertEqual(status, 206)
        self.assert_common_headers(headers, len(expected))
        self.assertEqual(
            headers["Content-Range"],
            f"bytes {offset}-{offset + len(expected) - 1}/{logical_size}",
        )
        self.assertEqual(body, expected)

    def test_path_read_bytes_is_never_used(self):
        with mock.patch.object(
            Path,
            "read_bytes",
            side_effect=AssertionError("whole-file reads are forbidden"),
        ):
            status, _, body = self.request(range_value="bytes=12-31")
        self.assertEqual(status, 206)
        self.assertEqual(body, self.payload[12:32])

    def test_browser_style_cancel_is_normal_and_server_remains_available(self):
        logical_size = 64 * 1024 * 1024
        with self.artifact_path.open("wb") as artifact:
            artifact.truncate(logical_size)
        self.record["sha256"] = "e" * 64
        before_errors = len(self.server_errors)

        with socket.create_connection(("127.0.0.1", self.port), timeout=10) as connection:
            request = (
                f"GET {self.endpoint} HTTP/1.1\r\n"
                f"Host: 127.0.0.1:{self.port}\r\n"
                f"Origin: {ALLOWED_ORIGIN}\r\n"
                "Connection: close\r\n\r\n"
            )
            connection.sendall(request.encode("ascii"))
            self.assertIn(b"200", connection.recv(2048))

        status, headers, body = self.request(method="HEAD")
        self.assertEqual(status, 200)
        self.assertEqual(headers["Content-Length"], str(logical_size))
        self.assertEqual(body, b"")
        self.assertEqual(len(self.server_errors), before_errors)

    def test_job_allowlist_and_resolved_containment_remain_strict(self):
        self.fake_studio.artifacts = []
        status, _, _ = self.request()
        self.assertEqual(status, 404)

        self.fake_studio.artifacts = [self.record]
        outside = self.checkout / "outside.mp4"
        outside.write_bytes(b"outside")
        self.artifact_path.unlink()
        self.artifact_path.symlink_to(outside)
        status, _, _ = self.request()
        self.assertEqual(status, 404)

        status, _, _ = self.request(
            endpoint=f"/api/studio/artifacts/missing/{self.filename}",
        )
        self.assertEqual(status, 404)

    def test_missing_head_artifact_returns_no_body(self):
        self.fake_studio.artifacts = []
        status, headers, body = self.request(method="HEAD")
        self.assertEqual(status, 404)
        self.assertEqual(headers["Content-Length"], "0")
        self.assertEqual(body, b"")


if __name__ == "__main__":
    unittest.main()
