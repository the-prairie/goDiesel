"""Bounded App Walk capability adapter; no canonical writers or release effects."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
from hashlib import sha256
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import signal
import subprocess
import sys
from typing import Any
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent
STATUS_EXIT = {"passed": 0, "failed": 1, "blocked": 2, "not_run": 2}
PATTERNS = ("app/walks/**/*.mjs", "app/*config.*", "app/package*.json", "app/src/**", "app/public/**", "godiesel_app_walk.py", "godiesel_evidence.py", "scripts/godiesel", "system/*.json")


def digest(value: Any) -> str:
    return sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def timestamp() -> str:
    return datetime.now(timezone.utc).isoformat()


def issue(code: str, message: str) -> dict[str, str]:
    return {"code": f"GODIESEL_WALK_{code}", "message": message, "remediation": "Inspect the private App Walk report and docs/agents/app-walk.md."}


def envelope(verb: str, status: str, result: Any = None, blockers: list | None = None) -> dict:
    # Preserve the existing outer result schema. Domain/evidence retain failed vs blocked.
    return {"schema_version": 1, "document_type": "godiesel-capability-result", "capability": "app-walk", "verb": verb,
            "status": "passed" if status == "passed" else "blocked", "authority": "read-only" if verb == "inspect" else "ephemeral-local",
            "authorized": verb in {"inspect", "verify"}, "exit_code": STATUS_EXIT.get(status, 2), "result": result,
            "result_contract": "godiesel-app-walk", "blockers": blockers or [], "warnings": [], "receipt": None, "evidence": None}


def normalize_target(value: str, profile: str) -> str:
    u = urlsplit(value)
    if u.username or u.password or u.query or u.fragment or u.path not in {"", "/"}:
        raise ValueError("Target must be a bare application origin.")
    if profile == "controlled":
        if u.scheme != "http" or u.hostname not in {"127.0.0.1", "localhost", "::1"}:
            raise ValueError("Controlled walks require an HTTP loopback origin.")
    elif profile != "live" or u.scheme != "https" or (u.port not in {None, 443}) or not re.fullmatch(r"(?:[a-z0-9-]+\.)?godiesel\.pages\.dev", u.hostname or ""):
        raise ValueError("Live walks require an authorized HTTPS goDiesel Pages origin.")
    hostname = f"[{u.hostname}]" if ":" in (u.hostname or "") else u.hostname
    port = f":{u.port}" if u.port and not (u.scheme == "https" and u.port == 443) and not (u.scheme == "http" and u.port == 80) else ""
    return f"{u.scheme}://{hostname}{port}"


def fingerprint(root: Path) -> list[dict[str, str]]:
    """Aggregate files, absent patterns, modes and link targets; never read linked files."""
    covered = []
    for index, pattern in enumerate(PATTERNS):
        records = []
        for item in sorted(root.glob(pattern)):
            if item.is_symlink():
                records.append((str(item.relative_to(root)), item.lstat().st_mode, "link", os.readlink(item)))
            elif item.is_file():
                h = sha256()
                with item.open("rb") as stream:
                    for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                        h.update(chunk)
                records.append((str(item.relative_to(root)), item.stat().st_mode, "file", h.hexdigest()))
        covered.append({"category": "contract" if pattern.startswith("system/") else "data" if pattern == "app/public/**" else "configuration" if "config" in pattern or "package" in pattern else "implementation", "name": f"walk-input-{index}", "state": "matched" if records else "absent", "sha256": digest(records)})
    return covered


def run_child(command: list[str], root: Path, timeout: int) -> subprocess.CompletedProcess:
    """Bound the process group too, so a timed-out browser is not left behind."""
    child = subprocess.Popen(command, cwd=root, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, start_new_session=os.name == "posix")
    try:
        out, err = child.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        if os.name == "posix": os.killpg(child.pid, signal.SIGTERM)
        else: child.terminate()
        try: child.communicate(timeout=3)
        except subprocess.TimeoutExpired:
            if os.name == "posix": os.killpg(child.pid, signal.SIGKILL)
            else: child.kill()
            child.communicate()
        raise
    if len(out) > 100_000:
        raise ValueError("Runner output exceeded its contract.")
    return subprocess.CompletedProcess(command, child.returncode, out, err)


def read_result(root: Path, payload: dict, args: argparse.Namespace, started: str, existing: set[str], returncode: int) -> tuple[dict, Path]:
    if payload.get("status") not in STATUS_EXIT or STATUS_EXIT[payload["status"]] != returncode:
        raise ValueError("Process exit and result disagree.")
    run_id = payload.get("id", "")
    if not re.fullmatch(r"[0-9TZ.:-]+-[a-f0-9]{8}", run_id) or run_id in existing:
        raise ValueError("A new run identity is required; previous evidence cannot be reused.")
    expected = Path(".godiesel") / "walks" / run_id / "report.json"
    if payload.get("report") != expected.as_posix() or payload.get("html") != (expected.parent / "index.html").as_posix():
        raise ValueError("Unexpected report path.")
    location = root / expected
    for ancestor in [root / ".godiesel", root / ".godiesel/walks", location.parent, location]:
        if ancestor.is_symlink(): raise ValueError("Evidence cannot be a symlink.")
    if location.stat().st_size > 4_000_000: raise ValueError("Report is too large.")
    html = location.with_name("index.html")
    if html.is_symlink() or not html.is_file(): raise ValueError("Missing or linked HTML report.")
    report = json.loads(location.read_text())
    if report.get("document_type") != "godiesel-app-walk" or report.get("schema_version") != 1 or report.get("id") != run_id:
        raise ValueError("Invalid report identity.")
    began = datetime.fromisoformat(report["started_at"].replace("Z", "+00:00"))
    ended = datetime.fromisoformat(report["finished_at"].replace("Z", "+00:00"))
    if began < datetime.fromisoformat(started) or ended < began or ended > datetime.now(timezone.utc):
        raise ValueError("Evidence timestamps do not bound this invocation.")
    for key, value in [("status", payload["status"]), ("profile", args.profile), ("target", args.target), ("mission", args.mission), ("driver", args.driver)]:
        if report.get(key) != value: raise ValueError(f"Report {key} does not match this invocation.")
    for key in ("checks", "findings", "checkpoints", "actions"):
        if not isinstance(report.get(key), list) or any(not isinstance(item, dict) for item in report[key]):
            raise ValueError("Invalid evidence collection.")
    checks = report["checks"]
    if any(c.get("status") not in STATUS_EXIT or not isinstance(c.get("id"), str) for c in checks):
        raise ValueError("Unknown check status or missing identity.")
    if len({c["id"] for c in checks}) != len(checks): raise ValueError("Duplicate checks.")
    failed = any(c.get("status") == "failed" for c in checks) or any(f.get("kind") == "defect" for f in report.get("findings", []))
    incomplete = any(c.get("status") in {"blocked", "not_run"} for c in checks) or not any(c.get("id") == "mission" and c.get("status") == "passed" for c in checks)
    computed = "failed" if failed else "blocked" if incomplete else "passed"
    if computed != report["status"]: raise ValueError("Report status contradicts its checks.")
    for frame in report.get("checkpoints", []):
        name = frame.get("image", "")
        if not re.fullmatch(r"frame-\d{3}\.png", name): raise ValueError("Invalid frame path.")
        image = location.parent / name
        if image.is_symlink() or not image.is_file(): raise ValueError("Missing or linked screenshot.")
    if report["status"] == "passed" and (not report["actions"] or not report["checkpoints"]):
        raise ValueError("A successful visual walk needs actions and screenshots.")
    return report, location


def inspect(root: Path) -> dict:
    manifest = json.loads((root / "system/capabilities.json").read_text())
    capability = next(c for c in manifest["capabilities"] if c["id"] == "app-walk")
    return envelope("inspect", "passed", {"capability": capability, "node_present": bool(shutil.which("node")),
                                         "live_status": "not_run", "proof_reuse": "not supported; walks are fresh observations"})


def verify(root: Path, args: argparse.Namespace, runner=run_child) -> dict:
    if args.reuse:
        return envelope("verify", "blocked", {"status": "blocked"}, [issue("REUSE_FORBIDDEN", "A walk is a fresh observation and cannot reuse yesterday's result.")])
    args.target = normalize_target(args.target, args.profile)
    if not 1 <= args.time_budget <= 900: raise ValueError("Invalid time budget.")
    node = shutil.which("node")
    if not node: return envelope("verify", "blocked", {"status": "blocked"}, [issue("NODE_UNAVAILABLE", "Node.js is unavailable.")])
    # Never allow ignored evidence locations to escape through symlinks.
    for part in (root / ".godiesel", root / ".godiesel/walks", root / ".godiesel/evidence"):
        if part.is_symlink() or (part.exists() and not part.is_dir()):
            return envelope("verify", "blocked", {"status": "blocked"}, [issue("UNSAFE_OUTPUT", "Evidence directories must be real local directories.")])
    started = timestamp()
    before = fingerprint(root)
    existing = {p.name for p in (root / ".godiesel/walks").glob("*")}
    command = [node, "app/walks/run.mjs", "--profile", args.profile, "--target", args.target + "/", "--mission", args.mission,
               "--viewport", args.viewport, "--session", args.session, "--driver", args.driver, "--time-budget", str(args.time_budget)]
    for name in ["seed", "action_budget", "request_budget"]:
        if getattr(args, name) is not None: command.extend(["--" + name.replace("_", "-"), str(getattr(args, name))])
    if args.headed: command.append("--headed")
    if args.capture_raw: command.append("--capture-raw")
    report_path = None
    try:
        completed = runner(command, root, args.time_budget + 45)
        payload = json.loads(completed.stdout)
        report, report_path = read_result(root, payload, args, started, existing, completed.returncode)
        result = envelope("verify", report["status"], payload)
    except (ValueError, OSError, KeyError, TypeError, subprocess.TimeoutExpired):
        report = {"status": "blocked"}
        result = envelope("verify", "blocked", {"status": "blocked"}, [issue("INCOMPLETE_RESULT", "The runner did not produce a fresh, complete, matching report.")])
    after = fingerprint(root)
    if before != after:
        report = {"status": "blocked"}
        result = envelope("verify", "blocked", {**result["result"], "status": "blocked", "observation_status": result["result"].get("status")}, [issue("INPUTS_CHANGED", "Covered inputs changed during the walk; the result is not a valid proof.")])
    from godiesel_evidence import write_evidence_receipt
    artifacts = [] if report_path is None else [{"kind": "app-walk-report", "path": report_path.relative_to(root).as_posix(), "sha256": sha256(report_path.read_bytes()).hexdigest()}]
    finished = timestamp()
    result["evidence"] = write_evidence_receipt(root, capability="app-walk", verb="verify", authority="ephemeral-local", started_at=started, finished_at=finished,
        status=report["status"], inputs=[], covered_inputs=before, proof_fingerprint=digest([before, args.target, started]),
        selection={"mode": "explicit", "tiers": ["live" if args.profile == "live" else "focused"], "impact_rules": []},
        gates=[{"id": "app-walk", "tier": "live" if args.profile == "live" else "focused", "command": shlex.join(command), "cwd": ".", "provider": args.profile,
                "started_at": started, "finished_at": finished, "status": report["status"], "exit_code": result["exit_code"], "output_sha256": digest(result["result"])}],
        configuration=[], warnings=result["blockers"], external_target={"kind": "app-walk-target", "name_sha256": digest(args.target)}, artifacts=artifacts)
    if result["evidence"] is None:
        result = envelope("verify", "blocked", {**result["result"], "status": "blocked", "observation_status": result["result"].get("status")}, [issue("EVIDENCE_UNAVAILABLE", "The general evidence receipt could not be recorded.")])
    return result


def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="godiesel")
    p.add_argument("verb", choices=["inspect", "verify"]); p.add_argument("capability", choices=["app-walk"])
    p.add_argument("--profile", choices=["controlled", "live"], default="controlled")
    p.add_argument("--target"); p.add_argument("--mission", default="memory")
    p.add_argument("--viewport", choices=["desktop", "phone", "landscape"], default="desktop")
    p.add_argument("--session", choices=["fresh", "returning"], default="fresh")
    p.add_argument("--driver", choices=["guided", "agent"], default="guided")
    p.add_argument("--time-budget", type=int, default=240); p.add_argument("--action-budget", type=int); p.add_argument("--request-budget", type=int)
    p.add_argument("--seed"); p.add_argument("--headed", action="store_true"); p.add_argument("--capture-raw", action="store_true")
    p.add_argument("--reuse", action="store_true"); p.add_argument("--json", action="store_true")
    return p


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    args.target = args.target or ("https://godiesel.pages.dev/" if args.profile == "live" else "http://127.0.0.1:8792/")
    try:
        result = inspect(ROOT) if args.verb == "inspect" else verify(ROOT, args)
    except (ValueError, OSError, KeyError, StopIteration):
        result = envelope(args.verb, "blocked", {"status": "blocked"}, [issue("CONFIGURATION", "The App Walk configuration or local capability contract is invalid.")])
    if args.json: print(json.dumps(result, separators=(",", ":"), sort_keys=True))
    else:
        domain_status = result["result"].get("status", result["status"]) if isinstance(result["result"], dict) else result["status"]
        print(f"{domain_status.upper()}: App Walk")
        if isinstance(result["result"], dict) and result["result"].get("html"): print(f"Field notes: {result['result']['html']}")
        for problem in result["blockers"]: print(problem["message"])
    return result["exit_code"]


if __name__ == "__main__": raise SystemExit(main())
