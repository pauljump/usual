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
    assert len(receipt["checks"]) == 10
    assert receipt["live_cloudflare"] is False


@pytest.mark.skipif(shutil.which("node") is None, reason="Node 22+ is needed for Bait's scripted client")
def test_bait_tarpit_client():
    result = subprocess.run(["node", "--no-warnings", str(ROOT / "tests/bait_tarpit_client.mjs")],
                            text=True, capture_output=True, timeout=60)
    assert result.returncode == 0, result.stderr
    receipt = json.loads(result.stdout.strip().splitlines()[-1])
    assert receipt["status"] == "passed"
    assert len(receipt["checks"]) >= 8
    assert receipt["live_cloudflare"] is False


@pytest.mark.skipif(shutil.which("node") is None or shutil.which("git") is None, reason="Node 22+ and Git are needed")
def test_bait_learning_client():
    result = subprocess.run(["node", "--no-warnings", str(ROOT / "tests/bait_learning_client.mjs")],
                            text=True, capture_output=True, timeout=60)
    assert result.returncode == 0, result.stderr
    receipt = json.loads(result.stdout.strip().splitlines()[-1])
    assert receipt["status"] == "passed"
    assert len(receipt["checks"]) >= 8
    assert receipt["live_cloudflare"] is False


@pytest.mark.skipif(shutil.which("node") is None, reason="Node 22+ is needed")
def test_bait_company_client():
    result = subprocess.run(["node", "--no-warnings", str(ROOT / "tests/bait_company_client.mjs")],
                            text=True, capture_output=True, timeout=60)
    assert result.returncode == 0, result.stderr
    receipt = json.loads(result.stdout.strip().splitlines()[-1])
    assert receipt["status"] == "passed"
    assert len(receipt["checks"]) >= 8
    assert receipt["live_cloudflare"] is False


@pytest.mark.skipif(shutil.which("node") is None, reason="Node 22+ is needed")
def test_bait_hosting_client():
    result = subprocess.run(["node", "--no-warnings", str(ROOT / "tests/bait_hosting_client.mjs")],
                            cwd=ROOT, text=True, capture_output=True, timeout=60)
    assert result.returncode == 0, result.stderr
    receipt = json.loads(result.stdout.strip().splitlines()[-1])
    assert receipt["status"] == "passed"
    assert len(receipt["checks"]) >= 9
    assert receipt["live_cloudflare"] is False


@pytest.mark.skipif(shutil.which("node") is None, reason="Node 22+ is needed")
def test_bait_investigation_client():
    result = subprocess.run(["node", "--no-warnings", str(ROOT / "tests/bait_investigation_client.mjs")],
                            cwd=ROOT, text=True, capture_output=True, timeout=60)
    assert result.returncode == 0, result.stderr
    receipt = json.loads(result.stdout.strip().splitlines()[-1])
    assert receipt["status"] == "passed"
    assert len(receipt["checks"]) >= 7
    assert receipt["live_cloudflare"] is False


@pytest.mark.skipif(shutil.which("node") is None, reason="Node 22+ is needed")
def test_bait_quota_deploy_client():
    result = subprocess.run(["node", "--no-warnings", str(ROOT / "tests/bait_quota_deploy_client.mjs")],
                            cwd=ROOT, text=True, capture_output=True, timeout=60)
    assert result.returncode == 0, result.stderr
    receipt = json.loads(result.stdout.strip().splitlines()[-1])
    assert receipt["status"] == "passed"
    assert len(receipt["checks"]) >= 4
    assert receipt["live_cloudflare"] is False


@pytest.mark.skipif(shutil.which("node") is None, reason="Node 22+ is needed")
def test_bait_snapshot_client():
    result = subprocess.run(["node", "--no-warnings", str(ROOT / "tests/bait_snapshot_client.mjs")],
                            cwd=ROOT, text=True, capture_output=True, timeout=60)
    assert result.returncode == 0, result.stderr
    receipt = json.loads(result.stdout.strip().splitlines()[-1])
    assert receipt["status"] == "passed"
    assert len(receipt["checks"]) >= 12
    assert receipt["live_cloudflare"] is False
