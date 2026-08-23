#!/usr/bin/env python3
"""Apply the isolated Route Studio byte-range integration to the feature head."""

from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]


def patch_admin() -> None:
    path = ROOT / "admin.py"
    text = path.read_text()
    if "from http_file_delivery import" not in text:
        old = "from route_studio import RouteStudio, StudioConflict, StudioError, StudioNotFound\n"
        new = (
            "from http_file_delivery import (\n"
            "    ArtifactNotFound,\n"
            "    resolve_studio_artifact,\n"
            "    serve_file,\n"
            ")\n"
            + old
        )
        if old not in text:
            raise RuntimeError("route_studio import anchor was not found")
        text = text.replace(old, new, 1)

    handler_marker = (
        "class Handler(BaseHTTPRequestHandler):\n"
        "    def log_message(self, fmt, *args):\n"
        "        return  # silent\n\n"
    )
    if "def _send_cors_headers" not in text:
        if handler_marker not in text:
            raise RuntimeError("Handler anchor was not found")
        text = text.replace(
            handler_marker,
            handler_marker
            + "    def _send_cors_headers(self, expose_headers=()):\n"
            + "        origin = self.headers.get('Origin')\n"
            + "        if origin in ALLOWED_ORIGINS:\n"
            + "            self.send_header('Access-Control-Allow-Origin', origin)\n"
            + "            self.send_header('Vary', 'Origin')\n"
            + "            if expose_headers:\n"
            + "                self.send_header(\n"
            + "                    'Access-Control-Expose-Headers',\n"
            + "                    ', '.join(expose_headers),\n"
            + "                )\n\n",
            1,
        )

    old_cors = (
        "        origin = self.headers.get('Origin')\n"
        "        if origin in ALLOWED_ORIGINS:\n"
        "            self.send_header('Access-Control-Allow-Origin', origin)\n"
        "            self.send_header('Vary', 'Origin')\n"
        "        self.end_headers()\n"
    )
    if old_cors in text:
        text = text.replace(
            old_cors,
            "        self._send_cors_headers()\n        self.end_headers()\n",
            1,
        )

    if "def _serve_studio_artifact" not in text:
        marker = "    def do_GET(self):\n"
        if marker not in text:
            raise RuntimeError("do_GET anchor was not found")
        methods = '''    def _send_empty(self, status, *, ctype='application/json'):
        self.send_response(status)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', '0')
        self.send_header('Cache-Control', 'no-store')
        self._send_cors_headers()
        self.end_headers()

    def _serve_file(self, path, *, content_type, etag_sha256=None, head_only=False):
        serve_file(
            self,
            path,
            content_type=content_type,
            add_cors_headers=self._send_cors_headers,
            etag_sha256=etag_sha256,
            head_only=head_only,
        )

    def _serve_studio_artifact(self, path, *, head_only=False):
        artifact_match = re.fullmatch(r'/api/studio/artifacts/([^/]+)/([^/]+)', path)
        if not artifact_match:
            return False

        job_id, filename = artifact_match.groups()
        try:
            job = STUDIO.get_job(job_id)
        except StudioNotFound as error:
            if head_only:
                self._send_empty(404)
            else:
                self._send(404, {'error': str(error)})
            return True

        try:
            artifact_path, artifact = resolve_studio_artifact(
                QUESTS,
                job,
                job_id,
                filename,
            )
        except ArtifactNotFound as error:
            if head_only:
                self._send_empty(404)
            else:
                self._send(404, {'error': str(error)})
            return True

        artifact_sha256 = artifact.get('sha256')
        self._serve_file(
            artifact_path,
            content_type='video/mp4',
            etag_sha256=(
                artifact_sha256
                if isinstance(artifact_sha256, str) and artifact_sha256
                else None
            ),
            head_only=head_only,
        )
        return True

    def do_HEAD(self):
        path = urlparse(self.path).path
        if self._serve_studio_artifact(path, head_only=True):
            return
        self._send_empty(404)

'''
        text = text.replace(marker, methods + marker, 1)

    if "artifact_path.read_bytes()" in text:
        start = text.find(
            "        artifact_match = re.fullmatch(r'/api/studio/artifacts/([^/]+)/([^/]+)', path)"
        )
        end = text.find("        studio_match = re.fullmatch", start)
        if start == -1 or end == -1:
            raise RuntimeError("artifact handler boundaries were not found")
        old_block = text[start:end]
        if "artifact_path.read_bytes()" not in old_block:
            raise RuntimeError("whole-file response was outside expected block")
        text = (
            text[:start]
            + "        if self._serve_studio_artifact(path):\n            return\n"
            + text[end:]
        )

    old_headers = (
        "self.send_header('Access-Control-Allow-Headers', "
        "'Content-Type, X-Source-Filename')"
    )
    if old_headers in text:
        text = text.replace(
            old_headers,
            "self.send_header('Access-Control-Allow-Headers', "
            "'Content-Type, X-Source-Filename, Range')",
            1,
        )
    old_methods = (
        "self.send_header('Access-Control-Allow-Methods', "
        "'GET, POST, DELETE, OPTIONS')"
    )
    if old_methods in text:
        text = text.replace(
            old_methods,
            "self.send_header('Access-Control-Allow-Methods', "
            "'GET, HEAD, POST, DELETE, OPTIONS')",
            1,
        )

    if "artifact_path.read_bytes()" in text:
        raise RuntimeError("whole-file artifact response remains")
    path.write_text(text)


def patch_playwright() -> None:
    path = ROOT / "app/e2e/route-studio.spec.ts"
    text = path.read_text()
    title = "completed teaser preloads metadata and seeks through byte ranges"
    if title in text:
        return
    signature = re.search(r"function rawJob\((.*?)\)", text, re.S)
    if signature is None:
        raise RuntimeError("rawJob fixture was not found")
    params = signature.group(1).strip()
    if not params or "=" in params:
        call = "rawJob()"
    elif "," not in params:
        call = 'rawJob("rendered")'
    else:
        raise RuntimeError(f"unsupported rawJob signature: {params}")

    test = f'''\n\ntest("{title}", async ({{ page }}) => {{
  await mockAdminStatus(page, true);
  const rendered = {call};
  rendered.status = "rendered";
  rendered.render_attempts = [{{
    id: "attempt-range",
    status: "complete",
    progress: 1,
    output_path: ".route-studio/artifacts/job-abc/range-teaser.mp4",
    render_fingerprint: "range-fixture",
  }}];
  await mockStudio(page, rendered);

  const {{ readFile }} = await import("node:fs/promises");
  const {{ fileURLToPath }} = await import("node:url");
  const media = await readFile(fileURLToPath(new URL("./fixtures/route-studio/range-teaser.mp4", import.meta.url)));
  let partialResponses = 0;
  const mediaErrors: string[] = [];
  page.on("console", (message) => {{
    if (message.type() === "error") mediaErrors.push(message.text());
  }});
  page.on("pageerror", (error) => mediaErrors.push(error.message));

  await page.route(`${{adminApi}}/api/studio/artifacts/job-abc/range-teaser.mp4`, async (route) => {{
    const value = route.request().headers().range;
    if (!value || !/^bytes=\\d*-\\d*$/.test(value)) {{
      await route.fulfill({{
        status: 200,
        headers: {{
          "Accept-Ranges": "bytes",
          "Cache-Control": "private, no-store",
          "Content-Length": String(media.length),
          "Content-Type": "video/mp4",
        }},
        body: media,
      }});
      return;
    }}

    const [, first, last] = /^bytes=(\\d*)-(\\d*)$/.exec(value)!;
    let start: number;
    let end: number;
    if (first) {{
      start = Number(first);
      end = last ? Math.min(Number(last), media.length - 1) : media.length - 1;
    }} else {{
      const suffix = Number(last);
      start = Math.max(media.length - suffix, 0);
      end = media.length - 1;
    }}
    if (start >= media.length || end < start) {{
      await route.fulfill({{
        status: 416,
        headers: {{
          "Accept-Ranges": "bytes",
          "Content-Length": "0",
          "Content-Range": `bytes */${{media.length}}`,
          "Content-Type": "video/mp4",
        }},
        body: Buffer.alloc(0),
      }});
      return;
    }}

    partialResponses += 1;
    const body = media.subarray(start, end + 1);
    await route.fulfill({{
      status: 206,
      headers: {{
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, no-store",
        "Content-Length": String(body.length),
        "Content-Range": `bytes ${{start}}-${{end}}/${{media.length}}`,
        "Content-Type": "video/mp4",
      }},
      body,
    }});
  }});

  await page.goto("/#/admin/studio/job-abc");
  const video = page.getByTestId("studio-teaser");
  await expect(video).toBeVisible();
  await video.evaluate((element) => new Promise<void>((resolve, reject) => {{
    const mediaElement = element as HTMLVideoElement;
    if (mediaElement.readyState >= HTMLMediaElement.HAVE_METADATA) {{
      resolve();
      return;
    }}
    mediaElement.addEventListener("loadedmetadata", () => resolve(), {{ once: true }});
    mediaElement.addEventListener("error", () => reject(new Error("media metadata failed to load")), {{ once: true }});
  }}));

  const duration = await video.evaluate((element) => (element as HTMLVideoElement).duration);
  expect(Number.isFinite(duration)).toBe(true);
  expect(duration).toBeGreaterThan(0);
  await video.evaluate((element) => new Promise<void>((resolve, reject) => {{
    const mediaElement = element as HTMLVideoElement;
    mediaElement.addEventListener("seeked", () => resolve(), {{ once: true }});
    mediaElement.addEventListener("error", () => reject(new Error("media seek failed")), {{ once: true }});
    mediaElement.currentTime = mediaElement.duration * 0.75;
  }}));

  const currentTime = await video.evaluate((element) => (element as HTMLVideoElement).currentTime);
  expect(currentTime).toBeGreaterThan(duration * 0.6);
  expect(partialResponses).toBeGreaterThan(0);
  expect(mediaErrors).toEqual([]);
}});\n'''
    path.write_text(text + test)


def create_media_fixture() -> None:
    target = ROOT / "app/e2e/fixtures/route-studio/range-teaser.mp4"
    target.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "color=c=black:s=320x180:d=2:r=24",
            "-f",
            "lavfi",
            "-i",
            "anullsrc=channel_layout=stereo:sample_rate=48000",
            "-shortest",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-crf",
            "30",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "64k",
            "-movflags",
            "+faststart",
            str(target),
        ],
        check=True,
    )


def main() -> None:
    patch_admin()
    patch_playwright()
    create_media_fixture()


if __name__ == "__main__":
    main()
