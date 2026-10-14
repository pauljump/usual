"""Where reads synthetic Claude Code and Codex transcripts without changing them."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "src/usual/where.py"


def load(tmp_path, monkeypatch):
    monkeypatch.setenv("CLAUDE_CONFIG_DIR", str(tmp_path / "claude"))
    monkeypatch.setenv("CODEX_HOME", str(tmp_path / "codex"))
    monkeypatch.setenv("USUAL_WHERE_HOME", str(tmp_path / "state"))
    spec = importlib.util.spec_from_file_location("where_under_test", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def write_jsonl(path, records):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(r) + "\n" for r in records))


def claude_fixture(tmp_path, ending="question"):
    project = tmp_path / "work" / "billing-api"
    project.mkdir(parents=True)
    sid = "11111111-2222-3333-4444-555555555555"
    base = {"cwd": str(project), "gitBranch": "fix/retries", "sessionId": sid}
    records = [
        {**base, "type": "user", "timestamp": "2026-10-01T10:00:00Z",
         "message": {"role": "user", "content": "<command-name>/clear</command-name>"}},
        {**base, "type": "user", "timestamp": "2026-10-01T10:00:01Z",
         "message": {"role": "user", "content": "Stripe webhooks retry forever after a 500"}},
        {**base, "type": "assistant", "timestamp": "2026-10-01T10:00:05Z",
         "message": {"role": "assistant", "content": [
             {"type": "tool_use", "name": "Edit", "input": {"file_path": str(project / "webhooks.py")}}]}},
        {**base, "type": "user", "timestamp": "2026-10-01T10:00:06Z",
         "message": {"role": "user", "content": [{"type": "tool_result", "content": "ok"}]}},
        {**base, "type": "user", "isSidechain": True, "timestamp": "2026-10-01T10:00:07Z",
         "message": {"role": "user", "content": "subagent prompt, not a human"}},
        {**base, "type": "assistant", "timestamp": "2026-10-01T10:00:09Z",
         "message": {"role": "assistant", "content": [{"type": "text", "text":
             "Fixed the handler.\n\nWant me to replay the 212 failed events, or only today's?" if ending == "question"
             else "Fixed the handler. All tests pass."}]}},
        {"type": "ai-title", "aiTitle": "Webhook retries", "sessionId": sid},
    ]
    path = tmp_path / "claude/projects/-work-billing-api" / f"{sid}.jsonl"
    write_jsonl(path, records)
    return sid, path


def codex_fixture(tmp_path):
    sid = "019f0000-aaaa-7bbb-8ccc-000000000001"
    records = [
        {"timestamp": "2026-10-02T09:00:00Z", "type": "session_meta",
         "payload": {"id": sid, "cwd": str(tmp_path), "thread_source": "user", "git": {"branch": "passkeys"}}},
        {"timestamp": "2026-10-02T09:00:01Z", "type": "response_item", "payload": {"type": "message", "role": "user",
         "content": [{"type": "input_text", "text": "# AGENTS.md instructions for /x\n\nrules"}]}},
        {"timestamp": "2026-10-02T09:00:02Z", "type": "response_item", "payload": {"type": "message", "role": "user",
         "content": [{"type": "input_text", "text": "Move login to passkeys"}]}},
        {"timestamp": "2026-10-02T09:00:03Z", "type": "response_item", "payload": {"type": "custom_tool_call",
         "name": "apply_patch", "input": "*** Begin Patch\n*** Update File: src/auth.ts\n*** End Patch"}},
        {"timestamp": "2026-10-02T09:00:04Z", "type": "response_item", "payload": {"type": "message", "role": "assistant",
         "content": [{"type": "output_text", "text": "Done.\n- Next step: run the e2e suite against staging."}]}},
    ]
    path = tmp_path / "codex/sessions/2026/10/02" / f"rollout-2026-10-02T09-00-00-{sid}.jsonl"
    write_jsonl(path, records)
    (tmp_path / "codex").mkdir(exist_ok=True)
    (tmp_path / "codex/session_index.jsonl").write_text(json.dumps({"id": sid, "thread_name": "Passkeys"}) + "\n")
    return sid, path


def test_reads_both_harnesses_and_finds_open_loops(tmp_path, monkeypatch):
    where = load(tmp_path, monkeypatch)
    csid, cpath = claude_fixture(tmp_path)
    xsid, xpath = codex_fixture(tmp_path)
    before = {p: p.read_bytes() for p in (cpath, xpath)}
    sessions = where.enrich(where.load_sessions(days=0))
    by_id = {s["id"]: s for s in sessions}
    claude, codex = by_id[csid], by_id[xsid]
    assert claude["title"] == "Webhook retries"
    assert claude["first_ask"] == "Stripe webhooks retry forever after a 500"
    assert claude["asks"] == 1  # harness, tool result and sidechain turns are not human asks
    assert claude["loop"]["kind"] == "question" and "212 failed events" in claude["loop"]["text"]
    assert claude["files"] == [str(tmp_path / "work/billing-api/webhooks.py")]
    assert claude["resume"].endswith(f"claude --resume {csid}") and claude["resume"].startswith("cd ")
    assert codex["title"] == "Passkeys" and codex["asks"] == 1
    assert codex["loop"]["kind"] == "next" and codex["files"] == ["src/auth.ts"]
    assert codex["resume"].endswith(f"codex resume {xsid}")
    assert {p: p.read_bytes() for p in (cpath, xpath)} == before


def test_deletion_countdown_follows_the_retention_setting(tmp_path, monkeypatch):
    where = load(tmp_path, monkeypatch)
    _, path = claude_fixture(tmp_path, ending="done")
    old = path.stat().st_mtime - 27 * 86400
    os.utime(path, (old, old))
    [s] = where.enrich(where.load_sessions(days=0))
    assert s["deletes_in"] in (2, 3) and s["loop"]["kind"] == "done"
    (tmp_path / "claude/settings.json").write_text(json.dumps({"cleanupPeriodDays": 36500}))
    [s] = where.enrich(where.load_sessions(days=0))
    assert s["deletes_in"] is None


def test_keep_changes_only_retention_after_apply_and_backs_up(tmp_path, monkeypatch, capsys):
    where = load(tmp_path, monkeypatch)
    claude_fixture(tmp_path)
    settings = tmp_path / "claude/settings.json"
    settings.write_text(json.dumps({"model": "opus", "cleanupPeriodDays": 30}))
    where.keep(apply=False, archive=None)
    assert json.loads(settings.read_text())["cleanupPeriodDays"] == 30
    where.keep(apply=True, archive=tmp_path / "archive")
    assert json.loads(settings.read_text()) == {"model": "opus", "cleanupPeriodDays": 36500}
    assert list(settings.parent.glob("settings.json.bak-where-*"))
    assert list((tmp_path / "archive/claude").rglob("*.jsonl.gz"))


def test_brief_and_board_carry_no_token_or_script_injection(tmp_path, monkeypatch):
    where = load(tmp_path, monkeypatch)
    sid, _ = claude_fixture(tmp_path)
    [s] = where.enrich(where.load_sessions(days=0))
    note = where.brief(s)
    assert "Stripe webhooks retry forever" in note and "Waiting on me" in note and sid in note
    s["display_title"] = "</script><script>alert(1)</script>"
    page = where.render_board([s], 30)
    assert "</script><script>alert(1)" not in page
    demo = where.render_board(where.demo_sessions(), 30, demo=True)
    assert "made-up sessions" in demo and str(Path.home()) not in demo


def test_standalone_script_and_usual_command(tmp_path):
    env = {**os.environ, "CLAUDE_CONFIG_DIR": str(tmp_path / "c"), "CODEX_HOME": str(tmp_path / "x"),
           "USUAL_WHERE_HOME": str(tmp_path / "s")}
    out = subprocess.run([sys.executable, "-I", str(SCRIPT), "--json"], env=env, capture_output=True, text=True, check=True)
    assert json.loads(out.stdout) == []
    out = subprocess.run([sys.executable, str(ROOT / "scripts/usual.py"), "where", "install", "--home", str(tmp_path / "h")],
                         env=env, capture_output=True, text=True, check=True)
    skill = (tmp_path / "h/skills/where/SKILL.md").read_text()
    assert "name: where" in skill and str(tmp_path / "h/skills/where/where.py") in skill
