"""Behavior checks for scoped, independently invocable Loops."""
import hashlib
import json
from pathlib import Path

import pytest

from usual import loops


@pytest.fixture
def workspace(tmp_path):
    scope = tmp_path / "project"
    scope.mkdir()
    (scope / "README.md").write_text("# Sample project\n")
    (scope / "package.json").write_text('{"name":"sample"}\n')
    return tmp_path / "private", scope


def test_independent_install_preview_run_and_variable_inputs(workspace):
    home, scope = workspace
    original = {p.name: p.read_bytes() for p in scope.iterdir()}
    installed = loops.create(home, "check", scope)
    assert installed["installed"] and installed["verification"]["status"] == "not-run"
    preview = loops.invoke(home, "check", preview=True)
    assert not preview["executes"]
    assert not (home / "loops" / "receipts").exists()
    first = loops.invoke(home, "check")
    assert first["verification"]["status"] == "passed"
    assert first["checks"][0]["sha256"] == hashlib.sha256(original["README.md"]).hexdigest()
    second = loops.invoke(home, "check", inputs={"required": ["package.json"], "label": "Second input"})
    assert second["verification"]["status"] == "passed"
    assert second["checks"][0]["json_valid"] is True
    assert second["id"] != first["id"]
    assert loops.inspect_routine(home, "check")["verification"]["status"] == "passed"
    assert {p.name: p.read_bytes() for p in scope.iterdir()} == original
    assert json.loads(Path(second["artifacts"]["json"]).read_text())["id"] == second["id"]
    assert "PRIVATE LOCAL RECEIPT" in Path(second["artifacts"]["html"]).read_text()


def test_checks_fail_for_missing_malformed_empty_and_wrong_hash(workspace):
    home, scope = workspace
    (scope / "bad.json").write_text('{"private":"DO NOT QUOTE",}')
    (scope / "empty").write_bytes(b"")
    loops.create(home, "check", scope, required=["bad.json", "empty", "missing", "README.md"],
                 expected_sha256={"README.md": "0" * 64})
    receipt = loops.invoke(home, "check")
    assert receipt["verification"]["status"] == "failed"
    assert all(check["status"] == "failed" for check in receipt["checks"])
    assert "DO NOT QUOTE" not in json.dumps(receipt)
    assert loops.inspect_routine(home, "check")["verification"]["status"] == "failed"


@pytest.mark.parametrize("name", ["../secret", "/etc/passwd", "sub/../../secret", "sub//file", ".", "./README.md", "sub\\file", "\x00"])
def test_reject_scope_escapes_before_reading(workspace, name):
    home, scope = workspace
    with pytest.raises(ValueError):
        loops.create(home, "check", scope, required=[name])
    assert not (home / "loops" / "check.json").exists()


def test_symlink_inputs_and_replaced_scope_cannot_redirect_reads(workspace, tmp_path):
    home, scope = workspace
    secret = tmp_path / "secret"
    secret.write_text("SECRET_CONTENT")
    (scope / "link").symlink_to(secret)
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "file").write_text("SECRET_CONTENT")
    (scope / "directory").symlink_to(outside, target_is_directory=True)
    loops.create(home, "check", scope, required=["link", "directory/file"])
    receipt = loops.invoke(home, "check")
    assert receipt["verification"]["status"] == "failed"
    assert all("sha256" not in c for c in receipt["checks"])
    assert "SECRET_CONTENT" not in json.dumps(receipt)
    scope.rename(tmp_path / "old-project")
    scope.mkdir()
    with pytest.raises(ValueError, match="replaced"):
        loops.invoke(home, "check")


def test_large_and_special_files_are_bounded(workspace):
    home, scope = workspace
    with (scope / "large").open("wb") as stream:
        stream.truncate(loops.MAX_FILE_BYTES + 1)
    (scope / "folder").mkdir()
    loops.create(home, "check", scope, required=["large", "folder"])
    result = loops.invoke(home, "check")
    assert result["verification"]["status"] == "failed"
    assert "10 MiB" in result["checks"][0]["detail"]
    assert "regular file" in result["checks"][1]["detail"]


def test_install_conflict_edit_correction_disable_and_removal_preserve_customizations(workspace):
    home, scope = workspace
    first = loops.create(home, "check", scope)
    path = Path(first["path"])
    document = json.loads(path.read_text())
    document["x-personal-comment"] = "Keep this local customization"
    path.write_text(json.dumps(document))
    again = loops.create(home, "check", scope)
    assert again["routine"]["x-personal-comment"] == document["x-personal-comment"]
    before = path.read_bytes()
    with pytest.raises(ValueError, match="different configuration"):
        loops.create(home, "check", scope, required=["package.json"])
    assert path.read_bytes() == before
    loops.invoke(home, "check")
    changed = loops.edit_routine(home, "check", required=["package.json"], correction="Also validate the JSON manifest.")
    assert changed["routine"]["revision"] == 2
    assert changed["routine"]["corrections"][0]["text"] == "Also validate the JSON manifest."
    assert changed["verification"]["status"] == "changed-since-run"
    assert changed["routine"]["x-personal-comment"] == document["x-personal-comment"]
    old = json.loads(next((home / "loops" / "revisions").glob("*.json")).read_text())
    assert old["inputs"]["required"] == ["README.md"]
    loops.disable(home, "check")
    with pytest.raises(ValueError, match="disabled"):
        loops.invoke(home, "check")
    removed = loops.remove(home, "check")
    assert not removed["installed"] and path.exists()
    assert removed["routine"]["x-personal-comment"] == document["x-personal-comment"]


def test_manual_method_changes_never_execute(workspace):
    home, scope = workspace
    result = loops.create(home, "check", scope)
    path = Path(result["path"])
    doc = json.loads(path.read_text())
    doc["steps"] = ["echo unauthorized"]
    path.write_text(json.dumps(doc))
    with pytest.raises(ValueError, match="built-in method"):
        loops.invoke(home, "check")


def test_storage_outside_scope_and_private_receipt_html(workspace):
    home, scope = workspace
    with pytest.raises(ValueError, match="outside"):
        loops.create(scope / ".usual", "check", scope)
    loops.create(home, "check", scope)
    receipt = loops.invoke(home, "check", inputs={"label": "<script>alert('private')</script>"})
    rendered = Path(receipt["artifacts"]["html"]).read_text()
    assert "<script>alert" not in rendered
    assert "&lt;script&gt;" in rendered
    assert Path(receipt["artifacts"]["json"]).stat().st_mode & 0o077 == 0


def test_cli_uses_isolated_home_and_returns_failure(workspace, capsys):
    home, scope = workspace
    assert loops.main(["create", "check", "--scope", str(scope)], home=home) == 0
    capsys.readouterr()
    assert loops.main(["again", "check", "--file", "missing"], home=home) == 1
    result = json.loads(capsys.readouterr().out)
    assert result["verification"]["status"] == "failed"
    assert loops.main(["disable", "check"], home=home) == 0
    capsys.readouterr()
    assert loops.main(["run", "check"], home=home) == 2
    assert "disabled" in capsys.readouterr().err


def test_extremely_nested_json_produces_failed_receipt(workspace):
    import sys
    home, scope = workspace
    depth = sys.getrecursionlimit() + 100
    (scope / "deep.json").write_text("[" * depth + "0" + "]" * depth)
    loops.create(home, "check", scope, required=["deep.json"])
    result = loops.invoke(home, "check")
    assert result["verification"]["status"] == "failed"
    assert "JSON nesting" in result["checks"][0]["detail"]


def test_private_loop_storage_cannot_be_in_another_repository(workspace, tmp_path):
    _, scope = workspace
    other = tmp_path / "another-repository"
    other.mkdir()
    (other / ".git").mkdir()
    with pytest.raises(ValueError, match="outside source repositories"):
        loops.create(other / "data", "check", scope)
    assert not (other / "data").exists()
