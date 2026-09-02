"""Locked entry point for regenerating the canonical route projection."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

from admin_curation import OwnerMutationBusyError, owner_mutation_lock


def main() -> int:
    root = Path(__file__).resolve().parent
    try:
        with owner_mutation_lock(root):
            completed = subprocess.run(
                [sys.executable, str(root / "build.py")],
                cwd=root,
                check=False,
            )
    except OwnerMutationBusyError:
        print("Another catalogue mutation is in progress.", file=sys.stderr)
        return 2
    return completed.returncode


if __name__ == "__main__":
    raise SystemExit(main())
