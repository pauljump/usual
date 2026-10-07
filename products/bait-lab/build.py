#!/usr/bin/env python3
"""Build isolated public sample and paid delivery bundles; never publishes."""
import argparse
import hashlib
import json
import zipfile
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent
FILES = ["lab.py", "examples/validator.py", "README.md", "FIELD-NOTES.md", "LICENSE", "tests/test_lab.py"]
SAMPLE_IDS = {"git-remote-untrusted", "valid-principal-control", "invalid-control"}


def bundle(path, cases):
    entries = {f: (ROOT / f).read_bytes() for f in FILES}
    entries["cases.json"] = (json.dumps(cases, indent=2) + "\n").encode()
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as z:
        for name, data in sorted(entries.items()):
            info = zipfile.ZipInfo("bait-lab/" + name, (2026, 10, 6, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            z.writestr(info, data)
    return {"file": path.name, "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            "bytes": path.stat().st_size, "cases": len(cases),
            "files": {k: hashlib.sha256(v).hexdigest() for k, v in entries.items()}}


def build(out, checkout=None):
    if out.exists() and any(out.iterdir()):
        raise ValueError("Use a new empty output directory; existing artifacts are never overwritten")
    if checkout:
        u = urlsplit(checkout)
        if u.scheme != "https" or not u.hostname or not (u.hostname == "gumroad.com" or u.hostname.endswith(".gumroad.com")) or u.username or u.password or u.fragment:
            raise ValueError("Checkout must be an inspected HTTPS Gumroad product URL")
    public, delivery = out / "public", out / "delivery"
    public.mkdir(parents=True)
    delivery.mkdir()
    items = json.loads((ROOT / "cases.json").read_text())
    sample = bundle(public / "bait-lab-sample.zip", [c for c in items if c["id"] in SAMPLE_IDS])
    full = bundle(delivery / "bait-lab-0.1.zip", items)
    import html
    page = (ROOT / "launch/index.html").read_text()
    if checkout:
        page = page.replace('data-checkout-disabled disabled', '')
        page = page.replace('onclick="return false"', 'onclick="location.href=' + html.escape(json.dumps(checkout), quote=True) + '"')
        page = page.replace("Checkout not connected in this preview", "Secure checkout and instant download on Gumroad")
        page = page.replace("Private launch preview · not accepting payments", "Bait Lab · release 0.1")
        page = page.replace("Proposed launch terms:", "Refund policy:")
    (public / "index.html").write_text(page)
    (public / "sample-manifest.json").write_text(json.dumps(sample, indent=2) + "\n")
    (out / "release.json").write_text(json.dumps({"version":"0.1", "published":False,
         "checkoutConfigured":bool(checkout), "public":sample, "delivery":full}, indent=2) + "\n")
    return {"directory": str(out), "sample":sample["sha256"], "full":full["sha256"],
            "checkoutConfigured":bool(checkout), "published":False}


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--out", type=Path, required=True)
    p.add_argument("--checkout", help="Approved real Gumroad product URL; omit for a disabled checkout preview")
    a = p.parse_args()
    print(json.dumps(build(a.out, a.checkout), indent=2))
