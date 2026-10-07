"""Explicit, disabled-by-default public assets for the Bait Lab launch."""
import os
from pathlib import Path

ASSETS = {
    "/bait/lab/": ("index.html", "text/html; charset=utf-8"),
    "/bait/lab/bait-lab-sample.zip": ("bait-lab-sample.zip", "application/zip"),
    "/bait/lab/sample-manifest.json": ("sample-manifest.json", "application/json"),
}


def asset(path):
    root = os.environ.get("USUAL_BAIT_LAB_PUBLIC_DIR")
    if not root or path not in ASSETS:
        return None
    name, mime = ASSETS[path]
    directory = Path(root).resolve()
    target = directory / name
    # Only these three fixed names may be served, never delivery files or paths
    # supplied by visitors. Misconfigured/missing files fail closed.
    if target.is_symlink() or target.resolve().parent != directory:
        raise OSError("Invalid public asset")
    if target.stat().st_size > 2 * 1024 * 1024:
        raise OSError("Public asset too large")
    return target.read_bytes(), mime
