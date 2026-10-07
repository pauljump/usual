"""Shipping boundaries: public/free vs delivery/full, and disabled launch routes."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import zipfile
import threading
import http.client

import pytest

from usual.bait_lab_public import asset

ROOT = Path(__file__).resolve().parents[1] / "products/bait-lab"
spec = importlib.util.spec_from_file_location("bait_lab_build", ROOT / "build.py")
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


def test_release_layout_and_bundled_sample(tmp_path):
    out = tmp_path / "release"
    builder.build(out)
    assert sorted(p.name for p in (out / "public").iterdir()) == ["bait-lab-sample.zip", "index.html", "sample-manifest.json"]
    assert "data-checkout-disabled disabled" in (out / "public/index.html").read_text()
    for folder, filename, expected in [("public", "bait-lab-sample.zip", 3), ("delivery", "bait-lab-0.1.zip", 12)]:
        with zipfile.ZipFile(out / folder / filename) as z:
            assert len(json.loads(z.read("bait-lab/cases.json"))) == expected
            assert set(z.namelist()) == {"bait-lab/" + f for f in builder.FILES + ["cases.json"]}
            dest = tmp_path / folder
            z.extractall(dest)
        r = subprocess.run([sys.executable, "lab.py", "demo"], cwd=dest / "bait-lab", capture_output=True, text=True)
        assert r.returncode == 0, r.stderr
        report = json.loads(r.stdout)
        assert report["reference"]["passed"] == expected
        assert report["naive"]["falseAcceptance"] > 0


def test_checkout_url_and_overwrite_protection(tmp_path):
    for i, bad in enumerate(["http://shop.gumroad.com/l/bait", "https://gumroad.com.evil.invalid/l/bait", "javascript:alert(1)", "https://user@gumroad.com/l/bait"]):
        with pytest.raises(ValueError):
            builder.build(tmp_path / str(i), bad)
    out = tmp_path / "good"
    builder.build(out, "https://example.gumroad.com/l/bait")
    page = (out / "public/index.html").read_text()
    assert "data-checkout-disabled" not in page
    assert "Secure checkout" in page
    assert "example.gumroad.com" in page
    with pytest.raises(ValueError):
        builder.build(out)


def test_public_assets_off_by_default_and_allowlisted(tmp_path, monkeypatch):
    monkeypatch.delenv("USUAL_BAIT_LAB_PUBLIC_DIR", raising=False)
    assert asset("/bait/lab/") is None
    builder.build(tmp_path / "release")
    public = tmp_path / "release/public"
    monkeypatch.setenv("USUAL_BAIT_LAB_PUBLIC_DIR", str(public))
    assert asset("/bait/lab/")[1].startswith("text/html")
    assert asset("/bait/lab/bait-lab-sample.zip")[1] == "application/zip"
    assert asset("/bait/lab/../delivery/bait-lab-0.1.zip") is None
    assert asset("/bait/lab/bait-lab-0.1.zip") is None
    assert asset("/bait/live/stats.json") is None


def test_public_asset_symlink_is_refused(tmp_path, monkeypatch):
    private = tmp_path / "private.txt"
    private.write_text("private")
    public = tmp_path / "public"
    public.mkdir()
    (public / "index.html").symlink_to(private)
    monkeypatch.setenv("USUAL_BAIT_LAB_PUBLIC_DIR", str(public))
    with pytest.raises(OSError):
        asset("/bait/lab/")


def test_existing_public_server_launch_gate(tmp_path, monkeypatch):
    from usual.server import PublicAutopilotHandler, ThreadingHTTPServer
    monkeypatch.delenv("USUAL_BAIT_LAB_PUBLIC_DIR", raising=False)
    server = ThreadingHTTPServer(("127.0.0.1", 0), PublicAutopilotHandler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    def get(path, method="GET"):
        conn = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=3)
        conn.request(method, path)
        r = conn.getresponse()
        result = r.status, r.read(), dict(r.getheaders())
        conn.close()
        return result
    try:
        assert get("/bait/lab/")[0] == 404
        builder.build(tmp_path / "release")
        monkeypatch.setenv("USUAL_BAIT_LAB_PUBLIC_DIR", str(tmp_path / "release/public"))
        assert get("/bait/lab/")[0] == 200
        assert get("/bait/lab/", "HEAD")[1] == b""
        assert get("/bait/lab/bait-lab-sample.zip")[1].startswith(b"PK")
        assert get("/bait/lab/bait-lab-0.1.zip")[0] == 404
        assert get("/bait/lab/../delivery/bait-lab-0.1.zip")[0] == 404
        assert get("/health")[0] == 200
    finally:
        server.shutdown()
        server.server_close()
