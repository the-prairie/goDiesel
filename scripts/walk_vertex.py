#!/usr/bin/env python3
"""Run a private Vertex App Walk in installed Chrome, without storing the API key."""
from __future__ import annotations

import argparse
import getpass
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import warnings

ROOT = Path(__file__).resolve().parents[1]


def find_chrome(explicit: str | None = None) -> Path:
    if explicit:
        candidate = Path(explicit).expanduser()
        if candidate.is_file():
            return candidate.resolve()
        raise ValueError("The selected Chrome executable does not exist.")
    candidates = [Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")]
    for variable in ("PROGRAMFILES", "PROGRAMFILES(X86)", "LOCALAPPDATA"):
        if os.environ.get(variable):
            candidates.append(Path(os.environ[variable]) / "Google/Chrome/Application/chrome.exe")
    for name in ("google-chrome", "google-chrome-stable"):
        found = shutil.which(name)
        if found:
            candidates.append(Path(found))
    for candidate in candidates:
        if candidate.is_file():
            return candidate.resolve()
    raise ValueError("Installed Google Chrome was not found. Run again with --chrome and its executable path.")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", required=True, help="Gemini model ID available to your Vertex API key")
    parser.add_argument("--mission", choices=["memory", "planning", "explore"], default="memory")
    parser.add_argument("--chrome", help="Optional installed Chrome executable path")
    args = parser.parse_args(argv)
    if not re.fullmatch(r"gemini-[a-zA-Z0-9.-]{1,90}", args.model):
        parser.error("Use a Gemini model ID, not a URL or API key.")
    try:
        chrome = find_chrome(args.chrome or os.environ.get("GODIESEL_WALK_BROWSER_PATH"))
        if not shutil.which("node"):
            raise ValueError("Node.js is required. Install the repository's supported Node version first.")
        if not (ROOT / "app/node_modules/playwright/package.json").is_file():
            raise ValueError("Application dependencies are missing. Run npm ci --prefix app first.")
        print("This starts a fresh Chrome session on the live goDiesel site.")
        print("Screenshots and interface text will be sent to Google Vertex's global API-key endpoint.")
        print("It makes up to 30 model calls using your Google Cloud quota/billing. Reports stay local.")
        # Explicit launcher invocation grants this provider opt-in, not publication rights.
        key = os.environ.get("GOOGLE_API_KEY")
        if not key:
            if not sys.stdin.isatty():
                raise ValueError("Use an interactive terminal for hidden key entry, or securely set GOOGLE_API_KEY.")
            with warnings.catch_warnings():
                warnings.simplefilter("error", getpass.GetPassWarning)
                key = getpass.getpass("Vertex API key (hidden; not saved): ")
        if not key or not re.fullmatch(r"[\x21-\x7e]{20,512}", key):
            raise ValueError("No valid Vertex key was provided.")
        env = dict(os.environ)
        env.update(GOOGLE_API_KEY=key, GODIESEL_WALK_PROVIDER="vertex", GODIESEL_WALK_MODEL=args.model,
                   GODIESEL_WALK_ALLOW_REMOTE_AGENT="1", GODIESEL_WALK_BROWSER_PATH=str(chrome))
        command = [sys.executable, str(ROOT / "godiesel_app_walk.py"), "verify", "app-walk",
                   "--profile", "live", "--target", "https://godiesel.pages.dev/", "--mission", args.mission,
                   "--driver", "agent", "--headed", "--time-budget", "600", "--request-budget", "6000", "--json"]
        try:
            return subprocess.run(command, cwd=ROOT, env=env, check=False).returncode
        finally:
            env.pop("GOOGLE_API_KEY", None)
            key = None
    except (ValueError, OSError, getpass.GetPassWarning, EOFError) as error:
        # These local errors contain no credentials or provider response bodies.
        print(f"App Walk did not start: {error}", file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        print("\nApp Walk cancelled.", file=sys.stderr)
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
