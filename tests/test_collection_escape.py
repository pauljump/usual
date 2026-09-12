"""Pin/provenance integrity and deterministic script-client behavior, not devices."""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess

import pytest

ROOT = Path(__file__).resolve().parents[1]
VENDOR = ROOT / "src/usual/vendor/escape_webview"


def test_escape_pin_license_and_minimal_patch_are_reproducible():
    manifest = json.loads((VENDOR / "source.json").read_text())
    assert manifest["commit"] == "8ded426d530638ea334bfd137345114973f3d602"
    for filename, expected in manifest["files"].items():
        assert hashlib.sha256((VENDOR / filename).read_bytes()).hexdigest() == expected
    upstream = (VENDOR / "escape-webview.upstream.js").read_bytes()
    assert upstream.count(b"GUIDE.menu.trigger") == 1
    assert (VENDOR / "escape-webview.js").read_bytes() == upstream.replace(b"GUIDE.menu.trigger", b"GUIDE.menu.tap")
    assert "Copyright (c) 2026 escape-webview contributors" in (VENDOR / "LICENSE").read_text()
    assert "https://github.com/pauljump/escape-webview" in upstream.decode()


@pytest.mark.skipif(shutil.which("node") is None, reason="Node is needed only for scripted-client verification")
def test_escape_scripted_client():
    result = subprocess.run(["node", str(ROOT / "tests/escape_scripted_client.cjs"), str(VENDOR / "escape-webview.js")],
                            text=True, capture_output=True, timeout=10)
    assert result.returncode == 0, result.stderr
    receipt = json.loads(result.stdout)
    assert receipt["status"] == "passed"
    assert receipt["kind"] == "scripted-client" and receipt["device_verified"] is False
