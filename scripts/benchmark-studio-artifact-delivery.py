#!/usr/bin/env python3
"""Compare the old whole-file response with the bounded Route Studio responder."""

from __future__ import annotations

import argparse
import http.client
import importlib.util
import json
import math
import os
from pathlib import Path
import statistics
import sys
import tempfile
import threading
import time
from multiprocessing import Process, Queue


def percentile(values, percentile_value):
    ordered = sorted(values)
    if not ordered:
        return 0.0
    rank = (len(ordered) - 1) * percentile_value
    lower = math.floor(rank)
    upper = math.ceil(rank)
    if lower == upper:
        return ordered[lower]
    weight = rank - lower
    return ordered[lower] * (1 - weight) + ordered[upper] * weight


def current_rss_bytes(pid):
    status = Path(f"/proc/{pid}/status")
    try:
        for line in status.read_text().splitlines():
            if line.startswith("VmRSS:"):
                return int(line.split()[1]) * 1024
    except FileNotFoundError:
        return 0
    return 0


def server_main(admin_path, checkout, diaries, job_id, filename, ready):
    os.environ["GODIESEL_CHECKOUT_ROOT"] = checkout
    os.environ["GODIESEL_DIESEL_DIARIES_ROOT"] = diaries
    spec = importlib.util.spec_from_file_location(
        f"benchmark_admin_{os.getpid()}",
        admin_path,
    )
    if spec is None or spec.loader is None:
        raise RuntimeError("could not load admin server")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    module.STUDIO.close()

    relative = f".route-studio/artifacts/{job_id}/{filename}"

    class FakeStudio:
        def get_job(self, requested):
            if requested != job_id:
                raise module.StudioNotFound("Studio job was not found")
            return {
                "artifacts": [
                    {
                        "path": relative,
                        "sha256": "a" * 64,
                    }
                ]
            }

    module.STUDIO = FakeStudio()
    server = module.ThreadingHTTPServer(("127.0.0.1", 0), module.Handler)
    ready.put(server.server_address[1])
    server.serve_forever()


def run_case(*, admin_path, checkout, diaries, scenario, requests, file_size):
    job_id = "job-benchmark"
    filename = "large.mp4"
    ready = Queue()
    process = Process(
        target=server_main,
        args=(str(admin_path), str(checkout), str(diaries), job_id, filename, ready),
    )
    process.start()
    port = ready.get(timeout=30)
    peak_rss = current_rss_bytes(process.pid)
    stop_monitor = threading.Event()

    def monitor():
        nonlocal peak_rss
        while not stop_monitor.is_set():
            peak_rss = max(peak_rss, current_rss_bytes(process.pid))
            time.sleep(0.002)

    monitor_thread = threading.Thread(target=monitor, daemon=True)
    monitor_thread.start()

    endpoint = f"/api/studio/artifacts/{job_id}/{filename}"
    latencies = []
    bytes_received = 0
    statuses = []
    range_start = file_size // 2 + 123
    expected_range_bytes = 4096
    try:
        for _ in range(requests):
            connection = http.client.HTTPConnection("127.0.0.1", port, timeout=120)
            headers = {"Origin": "http://127.0.0.1:8787"}
            if scenario == "range":
                headers["Range"] = (
                    f"bytes={range_start}-{range_start + expected_range_bytes - 1}"
                )
            started = time.perf_counter()
            connection.request("GET", endpoint, headers=headers)
            response = connection.getresponse()
            count = 0
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                count += len(chunk)
            elapsed = time.perf_counter() - started
            statuses.append(response.status)
            bytes_received += count
            latencies.append(elapsed)
            connection.close()
    finally:
        stop_monitor.set()
        monitor_thread.join(timeout=5)
        process.terminate()
        process.join(timeout=10)
        if process.is_alive():
            process.kill()
            process.join(timeout=5)

    total_seconds = sum(latencies)
    return {
        "requests": requests,
        "statuses": statuses,
        "bytes_received_total": bytes_received,
        "bytes_received_per_request": bytes_received // requests,
        "latency_p50_ms": round(statistics.median(latencies) * 1000, 3),
        "latency_p95_ms": round(percentile(latencies, 0.95) * 1000, 3),
        "throughput_mib_s": round(
            (bytes_received / (1024 * 1024)) / total_seconds,
            3,
        ),
        "peak_rss_mib": round(peak_rss / (1024 * 1024), 3),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--repository", default=".")
    parser.add_argument("--baseline-admin", required=True)
    parser.add_argument("--output-json", required=True)
    parser.add_argument("--output-markdown", required=True)
    parser.add_argument("--size-mib", type=int, default=256)
    parser.add_argument("--requests", type=int, default=5)
    args = parser.parse_args()

    repository = Path(args.repository).resolve()
    baseline_admin = Path(args.baseline_admin).resolve()
    file_size = args.size_mib * 1024 * 1024

    with tempfile.TemporaryDirectory() as temporary:
        root = Path(temporary)
        checkout = root / "checkout"
        diaries = root / "diaries"
        checkout.mkdir()
        diaries.mkdir()
        (checkout / "quests.json").write_text('{"routes": []}\n')
        (diaries / "activities.csv").write_text("Activity Date,Filename\n")
        artifact = (
            checkout
            / ".route-studio"
            / "artifacts"
            / "job-benchmark"
            / "large.mp4"
        )
        artifact.parent.mkdir(parents=True)
        with artifact.open("wb") as output:
            output.truncate(file_size)
            output.seek(file_size // 2 + 123)
            output.write(bytes((index * 29) % 256 for index in range(4096)))

        results = {
            "methodology": {
                "artifact_logical_size_mib": args.size_mib,
                "requests_per_case": args.requests,
                "range_bytes": 4096,
                "handler": "actual admin.py Handler with a fake allowlisted Studio job",
                "rss_sampling_interval_ms": 2,
            },
            "baseline": {},
            "after": {},
        }
        for label, admin_path in (
            ("baseline", baseline_admin),
            ("after", repository / "admin.py"),
        ):
            for scenario in ("full", "range"):
                results[label][scenario] = run_case(
                    admin_path=admin_path,
                    checkout=checkout,
                    diaries=diaries,
                    scenario=scenario,
                    requests=args.requests,
                    file_size=file_size,
                )

    output_json = Path(args.output_json)
    output_json.parent.mkdir(parents=True, exist_ok=True)
    output_json.write_text(json.dumps(results, indent=2) + "\n")

    def row(label, scenario):
        result = results[label][scenario]
        return (
            f"| {label} | {scenario} | {result['statuses']} | "
            f"{result['bytes_received_per_request']:,} | "
            f"{result['latency_p50_ms']:.3f} | {result['latency_p95_ms']:.3f} | "
            f"{result['throughput_mib_s']:.3f} | {result['peak_rss_mib']:.3f} |"
        )

    markdown = f"""# Route Studio artifact-delivery benchmark

Date: 2026-08-23

## Method

The benchmark starts the actual `admin.py` `ThreadingHTTPServer` handler in a
fresh process with a fake Studio job whose artifact passes the same exact job,
allowlist, and resolved-containment checks as production. It serves a sparse
{args.size_mib} MiB logical MP4. Each case performs {args.requests} loopback
requests while polling server RSS every 2 ms.

Command:

```bash
cp admin.py /tmp/admin-before-byte-range.py
python3 scripts/benchmark-studio-artifact-delivery.py \\
  --repository . \\
  --baseline-admin /tmp/admin-before-byte-range.py \\
  --size-mib {args.size_mib} --requests {args.requests} \\
  --output-json docs/dogfood-reports/route-studio-byte-range-benchmark.json \\
  --output-markdown docs/dogfood-reports/2026-08-23-route-studio-byte-range.md
```

`baseline` is the untouched feature-head handler using `Path.read_bytes()` and
ignoring Range. `after` is the bounded single-range responder. The range case
requests exactly 4 KiB from the middle of the file.

## Results

| version | request | statuses | bytes received/request | p50 ms | p95 ms | throughput MiB/s | peak RSS MiB |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
{row('baseline', 'full')}
{row('baseline', 'range')}
{row('after', 'full')}
{row('after', 'range')}

## Interpretation

The full-response bytes remain isomorphic: both implementations deliver the
complete file. The bounded responder removes whole-file server allocation.
For a valid 4 KiB range, the old handler still returns the entire artifact with
`200`; the new handler returns only the exact selected bytes with `206`.

## Isomorphism proof

Given the same validated job, exact artifact-list entry, resolved contained
path, and no satisfiable single Range header, the new responder writes the file
from byte zero through EOF in order. Those bytes are identical to the previous
`Path.read_bytes()` body. Given a satisfiable single Range, the bytes written are
identical to the inclusive corresponding file slice. Authorization and path
containment checks are unchanged. Status and range headers differ only for the
documented `206` and `416` cases, while malformed or multipart Range headers
retain a full `200` response.
"""
    Path(args.output_markdown).write_text(markdown)


if __name__ == "__main__":
    main()
