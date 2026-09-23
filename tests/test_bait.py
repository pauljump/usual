"""Usual Bait: scripted-client checks of bait, trips, the leaderboard store and dashboard."""
import json
from pathlib import Path
import shutil
import subprocess

import pytest

ROOT = Path(__file__).resolve().parents[1]


@pytest.mark.skipif(shutil.which("node") is None, reason="Node 22+ is needed for Bait's scripted client")
def test_bait_scripted_client():
    result = subprocess.run(["node", "--no-warnings", str(ROOT / "tests/bait_scripted_client.mjs")],
                            text=True, capture_output=True, timeout=60)
    assert result.returncode == 0, result.stderr
    receipt = json.loads(result.stdout.strip().splitlines()[-1])
    assert receipt["status"] == "passed"
    assert len(receipt["checks"]) == 9
    assert receipt["live_cloudflare"] is False
