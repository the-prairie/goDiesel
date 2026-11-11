"""admin.sh against stub servers on free high ports. Nothing real is started."""
import json
import os
import shutil
import socket
import subprocess
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent
FORBIDDEN_PORTS = {8766, 8787, 8791}


def free_port():
    while True:
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            port = probe.getsockname()[1]
        if port not in FORBIDDEN_PORTS:
            return port


class Stub:
    def __init__(self, port, status=None):
        payload = json.dumps(status).encode() if status is not None else b"<html></html>"

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                return

            def do_GET(self):
                self.send_response(200)
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

        self.server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def close(self):
        self.server.shutdown()
        self.server.server_close()


@pytest.fixture
def launcher(tmp_path):
    checkout = tmp_path / "checkout"
    checkout.mkdir()
    shutil.copy2(ROOT / "admin.sh", checkout / "admin.sh")
    marks = tmp_path / "marks"
    marks.mkdir()
    # A writer that never serves, so nothing answers on the admin port.
    (checkout / "admin.py").write_text(
        f"open({str(marks / 'admin-started')!r}, 'w').close()\n"
    )
    shims = tmp_path / "bin"
    shims.mkdir()
    for name in ("npm", "open"):
        shim = shims / name
        shim.write_text(f'#!/bin/sh\necho "$@" >> "{marks / name}"\n')
        shim.chmod(0o755)
    admin_port, app_port = free_port(), free_port()
    stubs = []

    def run(admin_status=None, app=False, attempts=4):
        if admin_status is not None:
            stubs.append(Stub(admin_port, admin_status))
        if app:
            stubs.append(Stub(app_port))
        env = {
            **os.environ,
            "PATH": f"{shims}:{os.environ['PATH']}",
            "GODIESEL_ADMIN_PORT": str(admin_port),
            "GODIESEL_APP_PORT": str(app_port),
            "GODIESEL_ADMIN_READY_ATTEMPTS": str(attempts),
        }
        return subprocess.run(
            [str(checkout / "admin.sh")],  # its own shebang, /bin/bash on macOS
            env=env,
            capture_output=True,
            text=True,
            timeout=30,
        )

    run.checkout = checkout.resolve()
    run.marks = marks
    run.app_port = app_port
    yield run
    for stub in stubs:
        stub.close()


def status(checkout_root, pid=4242):
    return {
        "writer_available": True,
        "mode": "local-owner",
        "generation_status": "ready",
        "generated_at": None,
        "checkout_root": checkout_root,
        "pid": pid,
    }


def test_a_writer_serving_another_checkout_is_refused(launcher, tmp_path):
    other = str(tmp_path / "some-other-worktree")
    result = launcher(admin_status=status(other), app=True)
    assert result.returncode != 0
    assert other in result.stderr
    assert str(launcher.checkout) in result.stderr
    assert "4242" in result.stderr
    assert not (launcher.marks / "open").exists()
    assert not (launcher.marks / "npm").exists()
    assert not (launcher.marks / "admin-started").exists()


def test_a_writer_that_does_not_report_its_checkout_is_refused(launcher):
    legacy = status(None)
    del legacy["checkout_root"], legacy["pid"]
    result = launcher(admin_status=legacy, app=True)
    assert result.returncode != 0
    assert "does not report its checkout" in result.stderr
    assert not (launcher.marks / "open").exists()


def test_readiness_timeout_exits_without_opening_the_browser(launcher):
    result = launcher()
    assert result.returncode != 0
    assert "not ready" in result.stderr
    assert (launcher.marks / "admin-started").exists()
    assert (launcher.marks / "npm").exists()
    assert not (launcher.marks / "open").exists()


def test_a_writer_for_this_checkout_opens_the_admin(launcher):
    result = launcher(admin_status=status(str(launcher.checkout)), app=True)
    assert result.returncode == 0, result.stderr
    assert (launcher.marks / "open").read_text().strip() == (
        f"http://127.0.0.1:{launcher.app_port}/#/admin"
    )
    assert not (launcher.marks / "admin-started").exists()
    assert "unbound variable" not in result.stderr
