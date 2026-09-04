import json
import os
import select
import subprocess
import threading
from hashlib import sha256
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError

import pytest
from jsonschema import Draft202012Validator

import godiesel_verification
from godiesel_control import main
from godiesel_route_share import execute_route_share
from godiesel_verification import (
    ProofInputMonitor,
    _pattern_input,
    build_proof_snapshot,
    explain_verification,
    read_target_build_identity,
    reuse_verification,
)


ROOT = Path(__file__).resolve().parent


def test_target_build_identity_rejects_redirects():
    class RedirectHandler(BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(302)
            self.send_header("Location", "https://example.test/build-identity.json")
            self.end_headers()

        def log_message(self, format, *args):
            return

    server = ThreadingHTTPServer(("127.0.0.1", 0), RedirectHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        with pytest.raises(HTTPError):
            read_target_build_identity(f"http://127.0.0.1:{server.server_port}/")
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


def test_target_build_identity_verifies_every_manifest_asset():
    asset = b"exact application bytes\n"
    control = b"/*\n  X-Frame-Options: DENY\n"
    manifest = {
        "schema_version": 1,
        "document_type": "godiesel-artifact-manifest",
        "files": [
            {
                "path": "_headers",
                "size": len(control),
                "sha256": sha256(control).hexdigest(),
                "delivery": "deployment-control",
            },
            {
                "path": "assets/application.js",
                "size": len(asset),
                "sha256": sha256(asset).hexdigest(),
                "delivery": "served-asset",
            }
        ],
    }
    manifest_bytes = f"{json.dumps(manifest, separators=(',', ':'))}\n".encode()
    identity = {
        "schema_version": 1,
        "document_type": "godiesel-build-identity",
        "artifact_kind": "built-artifact",
        "artifact_manifest_sha256": sha256(manifest_bytes).hexdigest(),
        "commit": "a" * 40,
        "tree": "b" * 40,
        "build_id": "12345678-1234-4234-8234-123456789abc",
    }
    responses = {
        "/build-identity.json": f"{json.dumps(identity)}\n".encode(),
        "/artifact-manifest.json": manifest_bytes,
        "/assets/application.js": asset,
    }
    requests: list[str] = []

    class ArtifactHandler(BaseHTTPRequestHandler):
        def do_GET(self):
            requests.append(self.path)
            payload = responses.get(self.path)
            if payload is None:
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def log_message(self, format, *args):
            return

    server = ThreadingHTTPServer(("127.0.0.1", 0), ArtifactHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    target = f"http://127.0.0.1:{server.server_port}/"
    try:
        assert read_target_build_identity(target) == identity
        assert "/_headers" not in requests
        responses["/assets/application.js"] = b"fake! application bytes\n"
        with pytest.raises(ValueError, match="does not match its manifest"):
            read_target_build_identity(target)
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


def test_target_build_identity_rejects_invalid_identity_before_manifest_fetch():
    requests: list[str] = []
    identity = {
        "schema_version": 1,
        "document_type": "godiesel-build-identity",
        "artifact_kind": "built-artifact",
        "artifact_manifest_sha256": "a" * 64,
        "commit": "b" * 40,
        "tree": "c" * 40,
        "build_id": "not-a-uuid",
    }

    class IdentityHandler(BaseHTTPRequestHandler):
        def do_GET(self):
            requests.append(self.path)
            self.send_response(200)
            payload = json.dumps(identity).encode()
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def log_message(self, format, *args):
            return

    server = ThreadingHTTPServer(("127.0.0.1", 0), IdentityHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        with pytest.raises(ValueError, match="invalid build id"):
            read_target_build_identity(f"http://127.0.0.1:{server.server_port}/")
        assert requests == ["/build-identity.json"]
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


class RecordingRunner:
    def __init__(self):
        self.calls: list[list[str]] = []

    def __call__(self, command: list[str], **kwargs: object):
        self.calls.append(command)
        return subprocess.CompletedProcess(
            command,
            0,
            "verified\n",
            "",
        )


def test_trailing_recursive_pattern_fingerprints_nested_files(tmp_path: Path):
    detail = tmp_path / "generated/routes/route-1.json"
    detail.parent.mkdir(parents=True)
    detail.write_text('{"status":"published"}\n', encoding="utf-8")

    before, before_issue = _pattern_input(
        tmp_path,
        category="data",
        pattern="generated/**",
    )
    detail.write_text('{"status":"draft"}\n', encoding="utf-8")
    after, after_issue = _pattern_input(
        tmp_path,
        category="data",
        pattern="generated/**",
    )

    assert before_issue is None
    assert after_issue is None
    assert before is not None
    assert after is not None
    assert before["state"] == "matched"
    assert after["state"] == "matched"
    assert before["sha256"] != after["sha256"]


@pytest.mark.parametrize("target_state", ["external", "broken"])
def test_proof_snapshot_blocks_unsafe_covered_input_symlink(
    tmp_path: Path,
    target_state: str,
):
    _write_reuse_fixture(tmp_path)
    linked_input = tmp_path / "implementation.py"
    linked_input.unlink()
    target = tmp_path.parent / f"{tmp_path.name}-{target_state}.py"
    if target_state == "external":
        target.write_text("external\n", encoding="utf-8")
    linked_input.symlink_to(target)

    snapshot = build_proof_snapshot(
        tmp_path,
        "route-share",
        tiers=["focused"],
        environ={},
    )

    assert snapshot["status"] == "blocked"
    assert snapshot["blockers"][0]["code"] == "GODIESEL_COVERED_INPUT_SYMLINK_UNSAFE"


def test_proof_snapshot_blocks_covered_symlink_cycle(tmp_path: Path):
    _write_reuse_fixture(tmp_path)
    linked_input = tmp_path / "implementation.py"
    linked_input.unlink()
    linked_input.symlink_to("implementation.py")

    snapshot = build_proof_snapshot(
        tmp_path, "route-share", tiers=["focused"], environ={}
    )

    assert snapshot["status"] == "blocked"
    assert snapshot["blockers"][0]["code"] == "GODIESEL_COVERED_INPUT_SYMLINK_UNSAFE"


def test_proof_snapshot_blocks_a_contained_covered_input_symlink(tmp_path: Path):
    _write_reuse_fixture(tmp_path)
    linked_input = tmp_path / "implementation.py"
    linked_input.unlink()
    target = tmp_path / "implementation-target.py"
    target.write_text("from helper import VALUE\n", encoding="utf-8")
    (tmp_path / "helper.py").write_text("VALUE = 1\n", encoding="utf-8")
    linked_input.symlink_to(target.name)

    snapshot = build_proof_snapshot(
        tmp_path,
        "route-share",
        tiers=["focused"],
        environ={},
    )

    assert snapshot["status"] == "blocked"
    assert snapshot["blockers"][0]["code"] == "GODIESEL_COVERED_INPUT_SYMLINK_UNSAFE"


@pytest.mark.parametrize("target_state", ["external", "broken"])
def test_proof_snapshot_blocks_unsafe_covered_directory_symlink(
    tmp_path: Path,
    target_state: str,
):
    _write_reuse_fixture(tmp_path)
    manifest_path = tmp_path / "system/capabilities.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["impact_rules"][0]["paths"] = ["generated/**"]
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    external = tmp_path.parent / f"{tmp_path.name}-{target_state}-directory"
    if target_state == "external":
        external.mkdir()
        (external / "implementation.py").write_text("external\n", encoding="utf-8")
    (tmp_path / "generated").symlink_to(external, target_is_directory=True)

    snapshot = build_proof_snapshot(
        tmp_path,
        "route-share",
        tiers=["focused"],
        environ={},
    )

    assert snapshot["status"] == "blocked"
    assert snapshot["blockers"][0]["code"] == "GODIESEL_COVERED_INPUT_SYMLINK_UNSAFE"


def test_proof_snapshot_blocks_unreadable_covered_input(
    tmp_path: Path,
    monkeypatch,
):
    _write_reuse_fixture(tmp_path)

    def unreadable(_path: Path) -> str:
        raise PermissionError("not readable")

    monkeypatch.setattr("godiesel_verification._file_digest", unreadable)

    snapshot = build_proof_snapshot(
        tmp_path,
        "route-share",
        tiers=["focused"],
        environ={},
    )

    assert snapshot["status"] == "blocked"
    assert snapshot["blockers"][0]["code"] == "GODIESEL_COVERED_INPUT_UNAVAILABLE"


def test_proof_snapshot_blocks_unreadable_recursive_directory(tmp_path: Path):
    _write_reuse_fixture(tmp_path)
    manifest_path = tmp_path / "system/capabilities.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["impact_rules"][0]["paths"] = ["secret/**"]
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    secret = tmp_path / "secret"
    secret.mkdir()
    nested = secret / "nested"
    nested.mkdir()
    (nested / "hidden.json").write_text("{}\n", encoding="utf-8")
    nested.chmod(0)
    try:
        snapshot = build_proof_snapshot(
            tmp_path, "route-share", tiers=["focused"], environ={}
        )
    finally:
        nested.chmod(0o700)

    assert snapshot["status"] == "blocked"
    assert snapshot["blockers"][0]["code"] == "GODIESEL_COVERED_INPUT_UNAVAILABLE"


def test_monitor_detects_transient_file_in_nested_recursive_directory(tmp_path: Path):
    nested = tmp_path / "covered/nested"
    nested.mkdir(parents=True)
    (nested / "existing.py").write_text("value = 1\n", encoding="utf-8")
    snapshot = {
        "covered_inputs": [
            {"name": "covered/**", "state": "matched", "category": "implementation"}
        ]
    }
    monitor = ProofInputMonitor(tmp_path, snapshot)
    transient = nested / "transient.py"
    transient.write_text("value = 2\n", encoding="utf-8")
    transient.unlink()
    try:
        assert monitor.changed() is True
    finally:
        monitor.close()


def test_monitor_ignores_executing_unchanged_covered_script(tmp_path: Path):
    covered = tmp_path / "covered.sh"
    covered.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
    covered.chmod(0o755)
    snapshot = {
        "covered_inputs": [
            {"name": "covered.sh", "state": "matched", "category": "implementation"}
        ]
    }
    monitor = ProofInputMonitor(tmp_path, snapshot)
    subprocess.run([str(covered)], check=True)
    try:
        assert monitor.changed() is False
    finally:
        monitor.close()


def test_monitor_detects_covered_file_mode_change(tmp_path: Path):
    covered = tmp_path / "covered.sh"
    covered.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
    covered.chmod(0o644)
    snapshot = {
        "covered_inputs": [
            {"name": "covered.sh", "state": "matched", "category": "implementation"}
        ]
    }
    monitor = ProofInputMonitor(tmp_path, snapshot)
    covered.chmod(0o755)
    try:
        assert monitor.changed() is True
    finally:
        monitor.close()


def test_monitor_detects_transient_covered_file_mode_change(tmp_path: Path):
    covered = tmp_path / "covered.sh"
    covered.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
    covered.chmod(0o644)
    snapshot = {
        "covered_inputs": [
            {"name": "covered.sh", "state": "matched", "category": "implementation"}
        ]
    }
    monitor = ProofInputMonitor(tmp_path, snapshot)
    covered.chmod(0o755)
    covered.chmod(0o644)
    try:
        assert monitor.changed() is True
    finally:
        monitor.close()


def test_monitor_ignores_unrelated_sibling_when_recursive_root_is_absent(
    tmp_path: Path,
):
    covered = tmp_path / "covered"
    covered.mkdir()
    snapshot = {
        "covered_inputs": [
            {
                "name": "covered/missing/**",
                "state": "absent",
                "category": "implementation",
            }
        ]
    }
    monitor = ProofInputMonitor(tmp_path, snapshot)
    unrelated = covered / "unrelated.tmp"
    unrelated.write_text("transient\n", encoding="utf-8")
    unrelated.unlink()
    try:
        assert monitor.changed() is False
    finally:
        monitor.close()


def test_catalogue_monitor_detects_transient_root_recovery_artifacts(
    tmp_path: Path,
):
    (tmp_path / "app/public/data/routes").mkdir(parents=True)
    (tmp_path / "app/src/data/generated").mkdir(parents=True)
    monitor = godiesel_verification.catalogue_recovery_monitor(tmp_path)
    recovery = tmp_path / ".quests.json.rollback"
    recovery.write_text("{}\n", encoding="utf-8")
    recovery.unlink()
    try:
        assert monitor.changed() is True
    finally:
        monitor.close()


def test_monitor_fails_closed_when_watch_registration_fails(
    tmp_path: Path,
    monkeypatch,
):
    covered = tmp_path / "covered.py"
    covered.write_text("value = 1\n", encoding="utf-8")
    snapshot = {
        "covered_inputs": [
            {"name": "covered.py", "state": "matched", "category": "implementation"}
        ]
    }
    if hasattr(select, "kqueue"):
        monkeypatch.setattr(os, "open", lambda *args, **kwargs: (_ for _ in ()).throw(OSError()))
    else:
        descriptor = os.open(os.devnull, os.O_RDONLY)

        class FailedInotify:
            def inotify_init1(self, _flags):
                return descriptor

            def inotify_add_watch(self, _fd, _path, _mask):
                return -1

        monkeypatch.setattr("godiesel_verification.ctypes.CDLL", lambda *args, **kwargs: FailedInotify())

    monitor = ProofInputMonitor(tmp_path, snapshot)
    try:
        assert monitor.changed() is True
    finally:
        monitor.close()


def test_route_generation_proof_fingerprints_private_sources_without_paths(
    tmp_path: Path,
    monkeypatch,
):
    _write_reuse_fixture(tmp_path)
    manifest_path = tmp_path / "system/capabilities.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["capabilities"][0]["id"] = "route-generation"
    for rule in manifest["impact_rules"]:
        rule["capabilities"] = ["route-generation"]
        for gate in rule["gates"]:
            gate["capability"] = "route-generation"
        for invariant in rule["invariants"]:
            invariant["capability"] = "route-generation"
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    (tmp_path / "quests.json").write_text(
        json.dumps({"routes": [{"activity_id": "123", "status": "approved"}]}),
        encoding="utf-8",
    )
    private_root = tmp_path / "private"
    private_root.mkdir()
    metadata = private_root / "activities.csv"
    geometry = private_root / "123.gpx"
    metadata.write_text("Filename,Activity Name\nactivities/123.gpx,Test\n", encoding="utf-8")
    geometry.write_text("<gpx />\n", encoding="utf-8")
    monkeypatch.setattr(
        "godiesel_verification.DEFAULT_DIESEL_DIARIES_ROOT",
        private_root,
    )
    monkeypatch.setattr(
        "godiesel_verification.find_strava_activity_file",
        lambda activity_id: geometry if activity_id == "123" else None,
    )

    before = build_proof_snapshot(
        tmp_path, "route-generation", tiers=["focused"], environ={}
    )
    geometry.write_text("<gpx><trk /></gpx>\n", encoding="utf-8")
    after = build_proof_snapshot(
        tmp_path, "route-generation", tiers=["focused"], environ={}
    )

    private_input = next(
        item
        for item in before["covered_inputs"]
        if item["name"] == "external-private:route-generation-sources"
    )
    assert before["status"] == "passed"
    assert after["status"] == "passed"
    assert before["proof_fingerprint"] != after["proof_fingerprint"]
    assert str(private_root) not in json.dumps(before["covered_inputs"])
    assert private_input["state"] == "matched"
    assert set(before["_monitor_paths"]) == {str(metadata), str(geometry)}


@pytest.mark.parametrize("linked_source", ["metadata", "geometry"])
def test_route_generation_proof_rejects_symlinked_private_sources(
    tmp_path: Path,
    monkeypatch,
    linked_source: str,
):
    (tmp_path / "quests.json").write_text(
        json.dumps({"routes": [{"activity_id": "123", "status": "approved"}]}),
        encoding="utf-8",
    )
    private_root = tmp_path / "private"
    private_root.mkdir()
    metadata = private_root / "activities.csv"
    geometry = private_root / "123.gpx"
    metadata.write_text("Filename,Activity Name\nactivities/123.gpx,Test\n", encoding="utf-8")
    geometry.write_text("<gpx />\n", encoding="utf-8")
    linked_path = metadata if linked_source == "metadata" else geometry
    target = private_root / f"real-{linked_path.name}"
    linked_path.replace(target)
    linked_path.symlink_to(target.name)
    monkeypatch.setattr(
        "godiesel_verification.DEFAULT_DIESEL_DIARIES_ROOT",
        private_root,
    )
    monkeypatch.setattr(
        "godiesel_verification.find_strava_activity_file",
        lambda activity_id: geometry if activity_id == "123" else None,
    )

    source_input, monitor_paths, issue = (
        godiesel_verification.external_route_source_fingerprint(tmp_path)
    )

    assert source_input is None
    assert monitor_paths == []
    assert issue["code"] == "GODIESEL_PRIVATE_ROUTE_SOURCE_UNAVAILABLE"


@pytest.mark.parametrize(
    "metadata_bytes",
    [
        b"\xff",
        b"Filename,Activity Name\nactivities/999.gpx,Wrong route\n",
    ],
)
def test_route_generation_proof_blocks_unusable_private_metadata(
    tmp_path: Path,
    monkeypatch,
    metadata_bytes: bytes,
):
    _write_reuse_fixture(tmp_path)
    manifest_path = tmp_path / "system/capabilities.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["capabilities"][0]["id"] = "route-generation"
    for rule in manifest["impact_rules"]:
        rule["capabilities"] = ["route-generation"]
        for gate in rule["gates"]:
            gate["capability"] = "route-generation"
        for invariant in rule["invariants"]:
            invariant["capability"] = "route-generation"
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    (tmp_path / "quests.json").write_text(
        json.dumps({"routes": [{"activity_id": "123", "status": "approved"}]}),
        encoding="utf-8",
    )
    private_root = tmp_path / "private"
    private_root.mkdir()
    metadata = private_root / "activities.csv"
    geometry = private_root / "123.gpx"
    metadata.write_bytes(metadata_bytes)
    geometry.write_text("<gpx />\n", encoding="utf-8")
    monkeypatch.setattr(
        "godiesel_verification.DEFAULT_DIESEL_DIARIES_ROOT",
        private_root,
    )
    monkeypatch.setattr(
        "godiesel_verification.find_strava_activity_file",
        lambda activity_id: geometry if activity_id == "123" else None,
    )

    snapshot = build_proof_snapshot(
        tmp_path, "route-generation", tiers=["focused"], environ={}
    )

    assert snapshot["status"] == "blocked"
    assert snapshot["blockers"][-1]["code"] == (
        "GODIESEL_PRIVATE_ROUTE_SOURCE_UNAVAILABLE"
    )


@pytest.mark.parametrize("path", [r"C:\\outside\\proof.py", "C:/outside/proof.py"])
def test_verification_rejects_windows_absolute_paths(tmp_path: Path, path: str):
    _write_reuse_fixture(tmp_path)

    result = explain_verification(tmp_path, changed_paths=[path])

    assert result["status"] == "blocked"
    assert result["blockers"][0]["code"] == "GODIESEL_CHANGED_PATH_INVALID"


def _write_reuse_fixture(root: Path) -> None:
    (root / "app/public/data").mkdir(parents=True, exist_ok=True)
    (root / "system").mkdir()
    for name in (
        "evidence-receipt.schema.json",
        "verification-reuse.schema.json",
        "capabilities.schema.json",
    ):
        (root / "system" / name).write_text(
            (ROOT / "system" / name).read_text(encoding="utf-8"),
            encoding="utf-8",
        )
    capability = next(
        capability
        for capability in json.loads(
            (ROOT / "system/capabilities.json").read_text(encoding="utf-8")
        )["capabilities"]
        if capability["id"] == "route-share"
    )
    capability["configuration"] = [
        {
            "name": "PROVIDER_PROJECT",
            "required_for": ["verify:live"],
            "sensitive": False,
        }
    ]
    capability["verification"] = {
        "focused": [{"command": "verify-focused", "cwd": "."}],
        "ticket": [],
        "release": [{"command": "verify-release", "cwd": "."}],
        "live": [{"command": "verify-live", "cwd": "."}],
    }
    categories = {
        "implementation": "implementation.py",
        "contract": "contract.json",
        "fixture": "fixture.json",
        "configuration": ".gitignore",
        "data": "data.json",
        "provider": "provider.json",
    }
    impact_rules = [
        {
            "id": f"fixture-{category}",
            "paths": [path],
            "capabilities": ["route-share"],
            "category": category,
            "gates": [{"capability": "route-share", "tier": "focused"}],
            "invariants": [
                {"capability": "route-share", "id": "single-route-microsite"}
            ],
            "reason": f"Fixture {category} input.",
        }
        for category, path in categories.items()
    ]
    impact_rules.extend(
        [
            {
                "id": "fixture-route-microsite-runtime",
                "paths": [
                    "app/src/Route.tsx",
                    "app/e2e/single-route-microsite.spec.ts",
                    "admin_curation.py",
                ],
                "capabilities": ["route-share"],
                "category": "implementation",
                "gates": [{"capability": "route-share", "tier": "focused"}],
                "invariants": [
                    {"capability": "route-share", "id": "single-route-microsite"}
                ],
                "reason": "Fixture route runtime input.",
            },
            {
                "id": "fixture-route-microsite-build",
                "paths": [
                    "app/package.json",
                    "app/scripts/check-bundle-budget.mjs",
                    "make-dist.sh",
                    "scripts/scope-route-microsite.mjs",
                ],
                "capabilities": ["route-share"],
                "category": "configuration",
                "gates": [{"capability": "route-share", "tier": "focused"}],
                "invariants": [
                    {"capability": "route-share", "id": "single-route-microsite"}
                ],
                "reason": "Fixture route build input.",
            },
            {
                "id": "fixture-route-microsite-media",
                "paths": ["app/public/media/route-1/photo.jpg"],
                "capabilities": ["route-share"],
                "category": "data",
                "gates": [{"capability": "route-share", "tier": "focused"}],
                "invariants": [
                    {"capability": "route-share", "id": "source-truth"}
                ],
                "reason": "Fixture public route media input.",
            },
            {
                "id": "fixture-live-provider",
                "paths": ["provider.json"],
                "capabilities": ["route-share"],
                "category": "provider",
                "gates": [{"capability": "route-share", "tier": "live"}],
                "invariants": [
                    {"capability": "route-share", "id": "single-route-microsite"}
                ],
                "reason": "Fixture live provider input.",
            },
            {
                "id": "fixture-documentation",
                "paths": ["docs/**"],
                "capabilities": ["route-share"],
                "category": "documentation",
                "gates": [],
                "invariants": [
                    {"capability": "route-share", "id": "source-truth"}
                ],
                "reason": "Fixture documentation input.",
            },
        ]
    )
    (root / "system/capabilities.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "document_type": "godiesel-capability-manifest",
                "capabilities": [capability],
                "impact_rules": impact_rules,
            }
        ),
        encoding="utf-8",
    )
    for path in categories.values():
        destination = root / path
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(
            ".godiesel/\n.route-share/\n"
            if path == ".gitignore"
            else f"{path}\n",
            encoding="utf-8",
        )
    for path in (
        "app/src/Route.tsx",
        "app/e2e/single-route-microsite.spec.ts",
        "app/package.json",
        "app/scripts/check-bundle-budget.mjs",
        "make-dist.sh",
        "scripts/scope-route-microsite.mjs",
        "app/public/media/route-1/photo.jpg",
        "admin_curation.py",
    ):
        destination = root / path
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(f"{path}\n", encoding="utf-8")
    (root / "docs").mkdir()
    (root / "docs/guide.md").write_text("guide\n", encoding="utf-8")
    subprocess.run(["git", "init", "-q"], cwd=root, check=True)
    subprocess.run(
        ["git", "config", "user.email", "fixture@example.test"],
        cwd=root,
        check=True,
    )
    subprocess.run(
        ["git", "config", "user.name", "Fixture"], cwd=root, check=True
    )
    subprocess.run(["git", "add", "."], cwd=root, check=True)
    subprocess.run(
        ["git", "commit", "-qm", "fixture"], cwd=root, check=True
    )


def _record_proof(root: Path) -> tuple[dict[str, object], RecordingRunner]:
    runner = RecordingRunner()
    result = execute_route_share(
        root,
        "verify",
        slug="route-1",
        environ={},
        runner=runner,
    )
    assert result["status"] == "passed"
    return result, runner


def test_verification_explanation_schema_is_valid():
    schema = json.loads(
        (ROOT / "system/verification-explanation.schema.json").read_text()
    )
    reuse_schema = json.loads(
        (ROOT / "system/verification-reuse.schema.json").read_text()
    )

    Draft202012Validator.check_schema(schema)
    Draft202012Validator.check_schema(reuse_schema)


@pytest.mark.parametrize("malformation", ["missing-authority", "duplicate-rule-id"])
def test_verification_rejects_manifest_semantic_failures(
    tmp_path: Path,
    malformation: str,
):
    system = tmp_path / "system"
    system.mkdir()
    for name in ("capabilities.json", "capabilities.schema.json"):
        (system / name).write_text(
            (ROOT / "system" / name).read_text(encoding="utf-8"),
            encoding="utf-8",
        )
    manifest_path = system / "capabilities.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if malformation == "missing-authority":
        manifest["capabilities"][0].pop("authority")
    else:
        manifest["impact_rules"][1]["id"] = manifest["impact_rules"][0]["id"]
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    snapshot = build_proof_snapshot(tmp_path, "route-share", tiers=["focused"])
    explanation = explain_verification(tmp_path, changed_paths=["godiesel_control.py"])

    assert snapshot["status"] == "blocked"
    assert snapshot["blockers"][0]["code"] == "GODIESEL_MANIFEST_INVALID"
    assert explanation["status"] == "blocked"
    assert explanation["blockers"][0]["code"] == "GODIESEL_MANIFEST_INVALID"


@pytest.mark.parametrize(
    ("changed_path", "capability", "category", "required_tier", "invariant"),
    [
        (
            "godiesel_control.py",
            "route-share",
            "implementation",
            "focused",
            "single-route-microsite",
        ),
        ("system/result.schema.json", "route-share", "contract", "focused", "source-truth"),
        (
            "test_godiesel_route_share.py",
            "route-share",
            "fixture",
            "focused",
            "single-route-microsite",
        ),
        (".gitignore", "route-share", "configuration", "focused", "source-truth"),
        ("make-dist.sh", "route-share", "configuration", "release", "single-route-microsite"),
        (
            "app/src/services/google-maps-loader.ts",
            "application-release",
            "provider",
            "live",
            "provider-proof-honesty",
        ),
        (
            "route_provenance.py",
            "route-generation",
            "implementation",
            "focused",
            "single-writer",
        ),
        (
            "test_route_create.py",
            "route-share",
            "fixture",
            "focused",
            "source-truth",
        ),
        (
            "test_route_provenance.py",
            "route-generation",
            "fixture",
            "focused",
            "single-writer",
        ),
        (
            "route_annotations.py",
            "owner-curation",
            "implementation",
            "focused",
            "owner-authored-provenance",
        ),
    ],
)
def test_explain_maps_paths_to_capabilities_and_required_gates(
    changed_path: str,
    capability: str,
    category: str,
    required_tier: str,
    invariant: str,
):
    result = explain_verification(ROOT, changed_paths=[changed_path])

    assert result["status"] == "passed"
    explanation = result["result"]
    classification = explanation["classifications"][0]
    assert classification["path"] == changed_path
    assert capability in classification["capabilities"]
    assert category in classification["categories"]
    assert {
        "capability": capability,
        "id": invariant,
    } in classification["invariants"]
    assert required_tier in {gate["tier"] for gate in explanation["selected_gates"]}
    Draft202012Validator(
        json.loads(
            (ROOT / "system/verification-explanation.schema.json").read_text()
        )
    ).validate(explanation)


@pytest.mark.parametrize(
    ("changed_path", "expected_gates"),
    [
        (
            "test_route_create.py",
            {
                (
                    "route-share",
                    "focused",
                    "./scripts/route.sh check <slug>",
                )
            },
        ),
        (
            "test_route_provenance.py",
            {
                (
                    "route-share",
                    "focused",
                    "./scripts/route.sh check <slug>",
                ),
                (
                    "route-generation",
                    "focused",
                    "python -m pytest -q -p no:cacheprovider test_godiesel_local_capabilities.py test_react_app.py test_route_provenance.py",
                ),
                (
                    "owner-curation",
                    "focused",
                    "python -m pytest -q -p no:cacheprovider test_godiesel_local_capabilities.py test_admin_curation.py test_curation_publish.py test_route_provenance.py",
                ),
            },
        ),
    ],
)
def test_route_fixtures_select_exact_executing_gates(
    changed_path: str,
    expected_gates: set[tuple[str, str, str]],
):
    result = explain_verification(ROOT, changed_paths=[changed_path])

    assert result["status"] == "passed"
    explanation = result["result"]
    assert {
        (gate["capability"], gate["tier"], gate["command"])
        for gate in explanation["selected_gates"]
    } == expected_gates
    assert explanation["classifications"][0]["categories"] == ["fixture"]


@pytest.mark.parametrize(
    ("capability", "fixture_paths"),
    [
        ("route-share", {"test_route_create.py", "test_route_provenance.py"}),
        ("route-generation", {"test_route_provenance.py"}),
        ("owner-curation", {"test_route_provenance.py"}),
    ],
)
def test_route_fixture_gates_fingerprint_every_executed_test(
    capability: str,
    fixture_paths: set[str],
):
    snapshot = build_proof_snapshot(ROOT, capability, tiers=["focused"])

    assert snapshot["status"] == "passed"
    covered_fixture_paths = {
        item["name"]
        for item in snapshot["covered_inputs"]
        if item["category"] == "fixture"
    }
    assert fixture_paths <= covered_fixture_paths


def test_documentation_only_change_selects_no_runtime_gate():
    result = explain_verification(
        ROOT,
        changed_paths=["docs/agents/route-share.md"],
    )

    assert result["status"] == "passed"
    assert result["result"]["selected_gates"] == []
    assert result["result"]["classifications"][0]["categories"] == [
        "documentation"
    ]


def test_unclassified_path_blocks_instead_of_choosing_a_small_gate():
    result = explain_verification(ROOT, changed_paths=["mystery/input.bin"])

    assert result["status"] == "blocked"
    assert result["exit_code"] == 2
    assert result["result"]["unclassified_paths"] == ["mystery/input.bin"]
    assert result["blockers"][0]["code"] == "GODIESEL_UNCLASSIFIED_PATH"


def test_browser_snapshot_change_selects_playwright_inclusive_ticket_gate():
    result = explain_verification(
        ROOT,
        changed_paths=["app/e2e/example.spec.ts-snapshots/example-desktop-darwin.png"],
    )

    selected = {
        (gate["capability"], gate["tier"], gate["command"])
        for gate in result["result"]["selected_gates"]
    }
    assert (
        "application-release",
        "ticket",
        "npm --prefix app run verify",
    ) in selected


def test_cli_verify_explain_emits_json_without_executing_a_gate(monkeypatch, capsys):
    def fail_execute(*args: object, **kwargs: object) -> object:
        raise AssertionError("route verification must not execute during explanation")

    monkeypatch.setattr("godiesel_control.execute_route_share", fail_execute)

    exit_code = main(
        [
            "verify",
            "system",
            "--explain",
            "--changed-path",
            "godiesel_control.py",
            "--json",
        ]
    )

    assert exit_code == 0
    result = json.loads(capsys.readouterr().out)
    assert result["capability"] == "system"
    assert result["verb"] == "verify"
    assert result["result"]["execution"] == "not_run"
    assert result["receipt"] is None
    assert result["evidence"] is None


@pytest.mark.parametrize(
    ("path", "expected_commands"),
    [
        (
            "app/src/providers/google-maps-loader.ts",
            {
                "./scripts/verify-provider-readiness.sh earth-replay",
                "./scripts/verify-provider-readiness.sh google-3d",
            },
        ),
        (
            "godiesel_local_capabilities.py",
            {
                "./scripts/verify-provider-readiness.sh atlas",
                "./scripts/verify-provider-readiness.sh earth-replay",
                "./scripts/verify-provider-readiness.sh google-3d",
            },
        ),
        (
            "app/src/providers/cesium-render-quality.ts",
            {
                "./scripts/verify-provider-readiness.sh atlas",
                "./scripts/verify-provider-readiness.sh earth-replay",
            },
        ),
        (
            "app/src/providers/render-health.ts",
            {
                "./scripts/verify-provider-readiness.sh atlas",
                "./scripts/verify-provider-readiness.sh earth-replay",
            },
        ),
        (
            "app/src/providers/provider-error.ts",
            {
                "./scripts/verify-provider-readiness.sh earth-replay",
                "./scripts/verify-provider-readiness.sh google-3d",
            },
        ),
        (
            "app/src/providers/new-provider-adapter.ts",
            {
                "./scripts/verify-provider-readiness.sh atlas",
                "./scripts/verify-provider-readiness.sh earth-replay",
                "./scripts/verify-provider-readiness.sh google-3d",
            },
        ),
        (
            "app/src/surfaces/replay/cinematic/native-cinematic-renderer.ts",
            {"./scripts/verify-provider-readiness.sh google-3d"},
        ),
        (
            "app/src/domain/geometry/recorded-light.ts",
            {
                "./scripts/verify-provider-readiness.sh earth-replay",
                "./scripts/verify-provider-readiness.sh google-3d",
            },
        ),
        (
            "app/src/surfaces/replay/components/recorded-light-layer.tsx",
            {
                "./scripts/verify-provider-readiness.sh earth-replay",
                "./scripts/verify-provider-readiness.sh google-3d",
            },
        ),
        (
            "app/src/surfaces/atlas/cesium-atlas-world-engine.ts",
            {"./scripts/verify-provider-readiness.sh atlas"},
        ),
        (
            "app/src/surfaces/atlas/components/cesium-atlas-globe.tsx",
            {"./scripts/verify-provider-readiness.sh atlas"},
        ),
        (
            "app/src/surfaces/atlas/atlas-region-camera.ts",
            {"./scripts/verify-provider-readiness.sh atlas"},
        ),
        (
            "app/src/surfaces/replay/renderers/cesium-replay-engine.ts",
            {"./scripts/verify-provider-readiness.sh earth-replay"},
        ),
        (
            "app/src/surfaces/replay/components/earth-replay-stage.tsx",
            {"./scripts/verify-provider-readiness.sh earth-replay"},
        ),
        (
            "app/src/surfaces/replay/renderers/google-route-navigator-engine.ts",
            {
                "./scripts/verify-provider-readiness.sh earth-replay",
                "./scripts/verify-provider-readiness.sh google-3d",
            },
        ),
        (
            "app/src/surfaces/replay/renderers/replay-camera-clearance.ts",
            {"./scripts/verify-provider-readiness.sh earth-replay"},
        ),
        (
            "app/src/surfaces/replay/renderers/new-provider-engine.ts",
            {
                "./scripts/verify-provider-readiness.sh atlas",
                "./scripts/verify-provider-readiness.sh earth-replay",
                "./scripts/verify-provider-readiness.sh google-3d",
            },
        ),
        (
            "app/src/surfaces/replay/story-flight/replay-camera-framing.ts",
            {
                "./scripts/verify-provider-readiness.sh earth-replay",
                "./scripts/verify-provider-readiness.sh google-3d",
            },
        ),
        (
            "app/src/surfaces/replay/scene/route-camera-stabilizer.ts",
            {
                "./scripts/verify-provider-readiness.sh earth-replay",
                "./scripts/verify-provider-readiness.sh google-3d",
            },
        ),
        (
            "app/e2e/new-provider-live.spec.ts",
            {
                "./scripts/verify-provider-readiness.sh atlas",
                "./scripts/verify-provider-readiness.sh earth-replay",
                "./scripts/verify-provider-readiness.sh google-3d",
            },
        ),
        *[
            (
                path,
                {
                    "./scripts/verify-provider-readiness.sh atlas",
                    "./scripts/verify-provider-readiness.sh earth-replay",
                    "./scripts/verify-provider-readiness.sh google-3d",
                },
            )
            for path in (
                "app/scripts/finalize-build-identity.mjs",
                "system/build-identity.schema.json",
                "system/artifact-manifest.schema.json",
                "app/playwright.live.config.ts",
                "app/package.json",
                "app/package-lock.json",
                "godiesel_evidence.py",
                "godiesel_verification.py",
                "system/evidence-receipt.schema.json",
                "system/verification-reuse.schema.json",
            )
        ],
    ],
)
def test_provider_or_camera_change_selects_exact_live_provider_proof(
    path: str,
    expected_commands: set[str],
):
    result = explain_verification(
        ROOT,
        changed_paths=[path],
    )

    selected = {
        gate["command"]
        for gate in result["result"]["selected_gates"]
        if gate["capability"] == "provider-readiness" and gate["tier"] == "live"
    }
    assert selected == expected_commands


@pytest.mark.parametrize(
    "path",
    [
        "test_godiesel_local_capabilities.py",
        "test_godiesel_verification.py",
    ],
)
def test_monolithic_control_plane_tests_do_not_select_live_provider_gates(path: str):
    result = explain_verification(ROOT, changed_paths=[path])

    selected = {
        gate["command"]
        for gate in result["result"]["selected_gates"]
        if gate["provider"] == "live-provider"
    }

    assert selected == set()


def test_exact_command_proof_inputs_do_not_include_other_commands(tmp_path: Path):
    _write_reuse_fixture(tmp_path)
    manifest_path = tmp_path / "system/capabilities.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    live = manifest["capabilities"][0]["verification"]["live"]
    live[0]["proof_inputs"] = [
        {"category": "provider", "paths": ["provider.json"]}
    ]
    live.append(
        {
            "command": "verify-other-live",
            "cwd": ".",
            "proof_inputs": [
                {"category": "provider", "paths": ["other-provider.json"]}
            ],
        }
    )
    (tmp_path / "other-provider.json").write_text("other\n", encoding="utf-8")
    next(
        rule
        for rule in manifest["impact_rules"]
        if rule["id"] == "fixture-live-provider"
    )["paths"].append("other-provider.json")
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    snapshot = build_proof_snapshot(
        tmp_path,
        "route-share",
        tiers=["live"],
        commands=["verify-live"],
        environ={"PROVIDER_PROJECT": "target-a"},
        provider_target="target-a",
    )

    names = {item["name"] for item in snapshot["covered_inputs"]}
    assert "provider.json" in names
    assert "other-provider.json" not in names
    assert "implementation.py" not in names


@pytest.mark.parametrize(
    ("entry_path", "dependency_path", "entry_source", "before_source", "after_source"),
    [
        (
            "app/src/entry.ts",
            "app/src/runtime.ts",
            'import { value } from "./runtime";\n',
            "export const value = 1;\n",
            "export const value = 2;\n",
        ),
        (
            "entry.py",
            "runtime.py",
            "from runtime import value\n",
            "value = 1\n",
            "value = 2\n",
        ),
        (
            "app/src/entry.cjs",
            "app/src/runtime.cjs",
            'const runtime = require("./runtime");\n',
            "module.exports = { value: 1 };\n",
            "module.exports = { value: 2 };\n",
        ),
    ],
)
def test_exact_command_proof_fingerprint_includes_transitive_local_imports(
    tmp_path: Path,
    entry_path: str,
    dependency_path: str,
    entry_source: str,
    before_source: str,
    after_source: str,
):
    _write_reuse_fixture(tmp_path)
    manifest_path = tmp_path / "system/capabilities.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["capabilities"][0]["verification"]["live"][0]["proof_inputs"] = [
        {"category": "implementation", "paths": [entry_path]}
    ]
    manifest["impact_rules"][-2]["paths"] = [entry_path]
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    entry = tmp_path / entry_path
    dependency = tmp_path / dependency_path
    entry.parent.mkdir(parents=True, exist_ok=True)
    entry.write_text(entry_source, encoding="utf-8")
    dependency.write_text(before_source, encoding="utf-8")

    before = build_proof_snapshot(
        tmp_path,
        "route-share",
        tiers=["live"],
        commands=["verify-live"],
        environ={"PROVIDER_PROJECT": "target-a"},
        provider_target="target-a",
    )
    dependency.write_text(after_source, encoding="utf-8")
    after = build_proof_snapshot(
        tmp_path,
        "route-share",
        tiers=["live"],
        commands=["verify-live"],
        environ={"PROVIDER_PROJECT": "target-a"},
        provider_target="target-a",
    )

    assert before["status"] == "passed"
    assert after["status"] == "passed"
    assert before["proof_fingerprint"] != after["proof_fingerprint"]


def test_dependency_change_selects_the_exact_live_gate(tmp_path: Path):
    _write_reuse_fixture(tmp_path)
    manifest_path = tmp_path / "system/capabilities.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["capabilities"][0]["verification"]["live"][0]["proof_inputs"] = [
        {"category": "provider", "paths": ["app/src/entry.ts"]}
    ]
    manifest["impact_rules"][-2]["paths"] = ["app/src/entry.ts"]
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    entry = tmp_path / "app/src/entry.ts"
    dependency = tmp_path / "app/src/runtime.ts"
    entry.parent.mkdir(parents=True, exist_ok=True)
    entry.write_text('import { value } from "./runtime";\n', encoding="utf-8")
    dependency.write_text("export const value = 1;\n", encoding="utf-8")

    result = explain_verification(tmp_path, changed_paths=["app/src/runtime.ts"])

    assert result["status"] == "passed"
    assert result["result"]["selected_gates"] == [
        {
            "capability": "route-share",
            "tier": "live",
            "command": "verify-live",
            "cwd": ".",
            "provider": "live-provider",
            "reasons": ["Fixture live provider input."],
            "required_by": ["app/src/runtime.ts"],
        }
    ]


def test_dependency_change_preserves_every_gate_on_matching_rule(tmp_path: Path):
    _write_reuse_fixture(tmp_path)
    manifest_path = tmp_path / "system/capabilities.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    proof_input = [{"category": "implementation", "paths": ["app/src/entry.ts"]}]
    manifest["capabilities"][0]["verification"]["focused"][0]["proof_inputs"] = proof_input
    manifest["capabilities"][0]["verification"]["live"][0]["proof_inputs"] = proof_input
    rule = manifest["impact_rules"][-2]
    rule["paths"] = ["app/src/entry.ts"]
    rule["gates"] = [
        {"capability": "route-share", "tier": "focused"},
        {"capability": "route-share", "tier": "live"},
    ]
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    entry = tmp_path / "app/src/entry.ts"
    dependency = tmp_path / "app/src/runtime.ts"
    entry.parent.mkdir(parents=True, exist_ok=True)
    entry.write_text('import { value } from "./runtime";\n', encoding="utf-8")
    dependency.write_text("export const value = 1;\n", encoding="utf-8")

    result = explain_verification(tmp_path, changed_paths=["app/src/runtime.ts"])

    assert result["status"] == "passed"
    assert {gate["tier"] for gate in result["result"]["selected_gates"]} == {
        "focused",
        "live",
    }


def test_dependency_selection_does_not_borrow_an_unrelated_seed(tmp_path: Path):
    _write_reuse_fixture(tmp_path)
    manifest_path = tmp_path / "system/capabilities.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["capabilities"][0]["verification"]["live"][0]["proof_inputs"] = [
        {
            "category": "implementation",
            "paths": ["app/src/owned.ts", "app/src/unrelated.ts"],
        }
    ]
    manifest["impact_rules"][-2]["paths"] = ["app/src/owned.ts"]
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    source_root = tmp_path / "app/src"
    source_root.mkdir(parents=True, exist_ok=True)
    (source_root / "owned.ts").write_text("export const owned = 1;\n", encoding="utf-8")
    (source_root / "unrelated.ts").write_text(
        'import { value } from "./runtime";\n', encoding="utf-8"
    )
    (source_root / "runtime.ts").write_text("export const value = 1;\n", encoding="utf-8")

    result = explain_verification(tmp_path, changed_paths=["app/src/runtime.ts"])

    assert result["status"] == "blocked"
    assert result["result"]["selected_gates"] == []
    assert result["result"]["unclassified_paths"] == ["app/src/runtime.ts"]


def test_transitive_external_directory_symlink_blocks_snapshot(tmp_path: Path):
    _write_reuse_fixture(tmp_path)
    manifest_path = tmp_path / "system/capabilities.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["capabilities"][0]["verification"]["live"][0]["proof_inputs"] = [
        {"category": "implementation", "paths": ["app/src/entry.ts"]}
    ]
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    entry = tmp_path / "app/src/entry.ts"
    entry.parent.mkdir(parents=True, exist_ok=True)
    entry.write_text('import { value } from "./linked/runtime";\n', encoding="utf-8")
    external = tmp_path.parent / f"{tmp_path.name}-external-runtime"
    external.mkdir()
    (external / "runtime.ts").write_text("export const value = 1;\n", encoding="utf-8")
    (entry.parent / "linked").symlink_to(external, target_is_directory=True)

    snapshot = build_proof_snapshot(
        tmp_path,
        "route-share",
        tiers=["live"],
        commands=["verify-live"],
        environ={"PROVIDER_PROJECT": "target-a"},
        provider_target="target-a",
    )

    assert snapshot["status"] == "blocked"
    assert snapshot["blockers"][0]["code"] == "GODIESEL_COVERED_INPUT_SYMLINK_UNSAFE"


def test_reuse_returns_the_existing_proof_without_executing_a_gate(tmp_path: Path):
    _write_reuse_fixture(tmp_path)
    recorded, runner = _record_proof(tmp_path)

    reused = reuse_verification(
        tmp_path,
        "route-share",
        slug="route-1",
        environ={},
    )

    assert runner.calls == [[str(tmp_path / "scripts/route.sh"), "check", "route-1"]]
    assert reused["status"] == "passed"
    assert reused["result"]["reused"] is True
    assert reused["result"]["source_receipt"] == recorded["evidence"]["path"]
    assert reused["evidence"] == recorded["evidence"]
    assert reused["receipt"] is None
    Draft202012Validator(
        json.loads((ROOT / "system/verification-reuse.schema.json").read_text())
    ).validate(reused["result"])


def test_reuse_rejects_missing_bound_artifact(tmp_path: Path):
    _write_reuse_fixture(tmp_path)
    recorded, _runner = _record_proof(tmp_path)
    receipt = json.loads(
        (tmp_path / recorded["evidence"]["path"]).read_text(encoding="utf-8")
    )
    (tmp_path / receipt["artifacts"][0]["path"]).unlink()

    reused = reuse_verification(
        tmp_path,
        "route-share",
        slug="route-1",
        environ={},
    )

    assert reused["status"] == "blocked"
    assert reused["blockers"][0]["code"] == "GODIESEL_PROOF_ARTIFACT_INVALID"
    Draft202012Validator(
        json.loads((ROOT / "system/verification-reuse.schema.json").read_text())
    ).validate(reused["result"])


def test_reuse_rejects_route_share_proof_without_bound_artifacts(tmp_path: Path):
    _write_reuse_fixture(tmp_path)
    recorded, _runner = _record_proof(tmp_path)
    receipt_path = tmp_path / recorded["evidence"]["path"]
    receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
    receipt["artifacts"] = []
    receipt_path.write_text(json.dumps(receipt), encoding="utf-8")

    reused = reuse_verification(
        tmp_path,
        "route-share",
        slug="route-1",
        environ={},
    )

    assert reused["status"] == "blocked"
    assert reused["blockers"][0]["code"] == "GODIESEL_PROOF_ARTIFACT_INVALID"


def test_reuse_observes_transient_recovery_changes_during_snapshot(
    tmp_path: Path,
    monkeypatch,
):
    _write_reuse_fixture(tmp_path)
    _record_proof(tmp_path)
    staging = tmp_path / "app/public/data/.routes-staging-interrupted"
    original_snapshot = godiesel_verification.build_proof_snapshot
    calls = 0

    def racing_snapshot(*args, **kwargs):
        nonlocal calls
        if calls == 0:
            staging.mkdir()
            staging.rmdir()
        calls += 1
        return original_snapshot(*args, **kwargs)

    monkeypatch.setattr(godiesel_verification, "build_proof_snapshot", racing_snapshot)

    reused = reuse_verification(
        tmp_path,
        "route-share",
        slug="route-1",
        environ={},
    )

    assert reused["status"] == "blocked"
    assert reused["result"]["reused"] is False
    assert reused["blockers"][0]["code"] == (
        "GODIESEL_ROUTE_GENERATION_RECOVERY_CHANGED"
    )


def test_reuse_rejects_a_passed_receipt_with_a_failed_gate(tmp_path: Path):
    _write_reuse_fixture(tmp_path)
    recorded, _runner = _record_proof(tmp_path)
    receipt_path = tmp_path / recorded["evidence"]["path"]
    receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
    receipt["gates"][0]["status"] = "failed"
    receipt["gates"][0]["exit_code"] = 1
    receipt_path.write_text(json.dumps(receipt), encoding="utf-8")
    schema = json.loads(
        (tmp_path / "system/evidence-receipt.schema.json").read_text(encoding="utf-8")
    )

    reused = reuse_verification(
        tmp_path,
        "route-share",
        slug="route-1",
        environ={},
    )

    assert Draft202012Validator(schema).is_valid(receipt) is False
    assert reused["status"] == "blocked"
    assert reused["blockers"][-1]["code"] == "GODIESEL_REUSABLE_PROOF_NOT_FOUND"


def test_documentation_change_does_not_invalidate_runtime_proof(tmp_path: Path):
    _write_reuse_fixture(tmp_path)
    _record_proof(tmp_path)
    (tmp_path / "docs/guide.md").write_text("updated guide\n", encoding="utf-8")

    reused = reuse_verification(
        tmp_path,
        "route-share",
        slug="route-1",
        environ={},
    )

    assert reused["status"] == "passed"


@pytest.mark.parametrize(
    ("category", "path"),
    [
        ("implementation", "implementation.py"),
        ("contract", "contract.json"),
        ("fixture", "fixture.json"),
        ("configuration", ".gitignore"),
        ("data", "data.json"),
        ("provider", "provider.json"),
    ],
)
def test_covered_input_change_blocks_reuse(
    tmp_path: Path,
    category: str,
    path: str,
):
    _write_reuse_fixture(tmp_path)
    _record_proof(tmp_path)
    with (tmp_path / path).open("a", encoding="utf-8") as destination:
        destination.write("changed\n")

    reused = reuse_verification(
        tmp_path,
        "route-share",
        slug="route-1",
        environ={},
    )

    assert reused["status"] == "blocked"
    assert reused["blockers"][0]["code"] == "GODIESEL_PROOF_INVALIDATED"
    assert category in {
        item["category"] for item in reused["result"]["invalidated_inputs"]
    }


def test_provider_target_changes_the_live_proof_fingerprint(tmp_path: Path):
    _write_reuse_fixture(tmp_path)

    first = build_proof_snapshot(
        tmp_path,
        "route-share",
        tiers=["live"],
        environ={"PROVIDER_PROJECT": "target-a"},
        provider_target="target-a",
    )
    second = build_proof_snapshot(
        tmp_path,
        "route-share",
        tiers=["live"],
        environ={"PROVIDER_PROJECT": "target-b"},
        provider_target="target-b",
    )

    assert first["proof_fingerprint"] != second["proof_fingerprint"]
    assert "provider" in {item["category"] for item in first["covered_inputs"]}


def test_live_proof_can_select_one_exact_manifest_command(tmp_path: Path):
    _write_reuse_fixture(tmp_path)
    manifest_path = tmp_path / "system/capabilities.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["capabilities"][0]["verification"]["live"].append(
        {"command": "verify-other-live", "cwd": "."}
    )
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    snapshot = build_proof_snapshot(
        tmp_path,
        "route-share",
        tiers=["live"],
        commands=["verify-live"],
        environ={"PROVIDER_PROJECT": "target-a"},
        provider_target="target-a",
    )

    assert snapshot["status"] == "passed"
    assert snapshot["gates"] == [
        {"tier": "live", "command": "verify-live", "cwd": "."}
    ]


def test_proof_blocks_a_command_not_declared_by_the_selected_tier(tmp_path: Path):
    _write_reuse_fixture(tmp_path)

    snapshot = build_proof_snapshot(
        tmp_path,
        "route-share",
        tiers=["live"],
        commands=["not-declared"],
        environ={"PROVIDER_PROJECT": "target-a"},
        provider_target="target-a",
    )

    assert snapshot["status"] == "blocked"
    assert snapshot["blockers"][0]["code"] == "GODIESEL_VERIFICATION_COMMAND_UNKNOWN"


def test_missing_live_configuration_is_blocked_not_passed(tmp_path: Path):
    _write_reuse_fixture(tmp_path)

    snapshot = build_proof_snapshot(
        tmp_path,
        "route-share",
        tiers=["live"],
        environ={},
        provider_target="target-a",
    )

    assert snapshot["status"] == "blocked"
    assert snapshot["blockers"][0]["code"] == "GODIESEL_LIVE_CONFIGURATION_MISSING"


def test_missing_live_target_is_blocked_not_passed(tmp_path: Path):
    _write_reuse_fixture(tmp_path)

    snapshot = build_proof_snapshot(
        tmp_path,
        "route-share",
        tiers=["live"],
        environ={"PROVIDER_PROJECT": "target-a"},
    )

    assert snapshot["status"] == "blocked"
    assert snapshot["blockers"][0]["code"] == "GODIESEL_LIVE_TARGET_MISSING"


def test_release_tier_is_fingerprinted_and_unknown_tiers_block(tmp_path: Path):
    _write_reuse_fixture(tmp_path)

    release = build_proof_snapshot(
        tmp_path,
        "route-share",
        tiers=["release"],
        environ={},
    )
    unknown = build_proof_snapshot(
        tmp_path,
        "route-share",
        tiers=["imaginary"],
        environ={},
    )

    assert release["status"] == "passed"
    assert release["gates"] == [
        {"tier": "release", "command": "verify-release", "cwd": "."}
    ]
    assert unknown["status"] == "blocked"
    assert unknown["blockers"][0]["code"] == "GODIESEL_VERIFICATION_TIER_UNKNOWN"


def test_route_share_focused_proof_covers_the_executed_microsite_gate():
    snapshot = build_proof_snapshot(
        ROOT,
        "route-share",
        tiers=["focused"],
        environ={},
    )

    assert snapshot["status"] == "passed"
    assert snapshot["gates"] == [
        {
            "tier": "focused",
            "command": "./scripts/route.sh check <slug>",
            "cwd": ".",
        }
    ]
    covered_names = {item["name"] for item in snapshot["covered_inputs"]}
    assert {
        "app/src/**",
        "app/e2e/single-route-microsite.spec.ts",
        "app/public/media/**",
        "app/package.json",
        "app/package-lock.json",
        "app/*config.*",
        "admin_curation.py",
        "curation_publish.py",
        "make-dist.sh",
        "quest_meta.py",
        "requirements.txt",
        "route_annotations.py",
        "route_imports.py",
        "app/scripts/check-bundle-budget.mjs",
        "scripts/check-provider-key.mjs",
        "scripts/scope-route-microsite.mjs",
        "scripts/validate-route-microsite.mjs",
    }.issubset(covered_names)


def test_executable_mode_change_invalidates_reuse(tmp_path: Path):
    _write_reuse_fixture(tmp_path)
    executable = tmp_path / "implementation.py"
    executable.chmod(0o755)
    _record_proof(tmp_path)
    executable.chmod(0o644)

    reused = reuse_verification(
        tmp_path,
        "route-share",
        slug="route-1",
        environ={},
    )

    assert reused["status"] == "blocked"
    assert reused["blockers"][0]["code"] == "GODIESEL_PROOF_INVALIDATED"
    assert {item["category"] for item in reused["result"]["invalidated_inputs"]} == {
        "implementation"
    }


@pytest.mark.parametrize(
    "path",
    [
        "app/src/Route.tsx",
        "app/e2e/single-route-microsite.spec.ts",
        "app/package.json",
        "admin_curation.py",
        "app/scripts/check-bundle-budget.mjs",
        "scripts/scope-route-microsite.mjs",
        "app/public/media/route-1/photo.jpg",
    ],
)
def test_route_microsite_dependency_change_invalidates_reuse(
    tmp_path: Path,
    path: str,
):
    _write_reuse_fixture(tmp_path)
    _record_proof(tmp_path)
    with (tmp_path / path).open("a", encoding="utf-8") as destination:
        destination.write("changed\n")

    reused = reuse_verification(
        tmp_path,
        "route-share",
        slug="route-1",
        environ={},
    )

    assert reused["status"] == "blocked"
    assert reused["blockers"][0]["code"] == "GODIESEL_PROOF_INVALIDATED"


def test_cli_verify_reuse_dispatches_without_running_route_verification(
    monkeypatch,
    capsys,
):
    captured: dict[str, object] = {}

    def fake_reuse(root: Path, capability: str, **kwargs: object):
        captured.update({"root": root, "capability": capability, **kwargs})
        return {
            "status": "passed",
            "exit_code": 0,
            "capability": capability,
            "verb": "verify",
        }

    def fail_execute(*args: object, **kwargs: object):
        raise AssertionError("route verification must not execute during reuse")

    monkeypatch.setattr("godiesel_control.reuse_verification", fake_reuse)
    monkeypatch.setattr("godiesel_control.execute_route_share", fail_execute)

    exit_code = main(
        ["verify", "route-share", "route-1", "--reuse", "--json"]
    )

    assert exit_code == 0
    assert captured["capability"] == "route-share"
    assert captured["slug"] == "route-1"
    assert json.loads(capsys.readouterr().out)["status"] == "passed"


@pytest.mark.parametrize(
    "arguments",
    [
        ["verify", "route-share", "route-1", "--reuse", "--preview"],
        [
            "verify",
            "route-share",
            "route-1",
            "--reuse",
            "--preview",
            "--detach",
        ],
    ],
)
def test_cli_rejects_reuse_with_preview_modes(arguments, capsys):
    with pytest.raises(SystemExit) as raised:
        main(arguments)

    assert raised.value.code == 2
    assert "--reuse cannot be combined with --preview or --detach" in capsys.readouterr().err


@pytest.mark.parametrize("target", ["route-generation", "owner-curation"])
def test_cli_rejects_route_share_preview_flags_for_other_targets(target, capsys):
    with pytest.raises(SystemExit) as raised:
        main(["verify", target, "--reuse", "--preview"])

    assert raised.value.code == 2
    assert "--preview and --detach only support route-share" in capsys.readouterr().err
