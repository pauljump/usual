"""Inspectable local routines. This release executes one fixed, read-only method.

A routine is data, never a shell program. Its explicit scope is fixed until edited;
the file list, expected digests, and report label can vary on each invocation.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import html
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import sys
import tempfile
import uuid

METHOD = "file-check-v1"
VERSION = "0.1.0"
MAX_FILES = 32
MAX_FILE_BYTES = 10 * 1024 * 1024
METHOD_STEPS = [
    "Validate the explicit directory and relative file inputs; reject symlinks and scope escapes.",
    "Read each named regular file, at most 10 MiB each, without modifying the source.",
    "Check nonempty content, compute SHA-256, parse .json files, and compare supplied expected digests.",
    "Record each passing or failing check in a private JSON and HTML receipt outside the source directory.",
]
LIMITS = [
    "Checks only the named files and the conditions shown; passing is not application or release correctness.",
    "No project commands, tests, hooks, network calls, publication, or background work are executed.",
    "A historical receipt describes that invocation; files can change afterward.",
]


def _now():
    return datetime.now(timezone.utc).isoformat()


def _digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def _id(value):
    if not isinstance(value, str) or not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,63}", value):
        raise ValueError("Routine ID must be 1–64 lowercase letters, digits, hyphens, or underscores.")
    return value


def _private_dir(path):
    if path.is_symlink():
        raise ValueError("Private routine storage cannot be a symlink.")
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    return path


def _root(home):
    home = Path(home).expanduser().resolve()
    if any((parent / ".git").exists() for parent in [home, *home.parents]):
        raise ValueError("Private routines and receipts must live outside source repositories.")
    return _private_dir(home / "loops")


def _path(home, routine_id):
    return _root(home) / (_id(routine_id) + ".json")


def _write(path, value, *, exclusive=False):
    if path.is_symlink():
        raise ValueError("Refusing to replace a symlink in routine storage.")
    payload = (json.dumps(value, indent=2, ensure_ascii=False) + "\n").encode()
    if exclusive:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "wb") as stream:
            stream.write(payload)
        return
    fd, name = tempfile.mkstemp(prefix=".usual-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(payload)
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def _relative(value):
    if (not isinstance(value, str) or not value or len(value) > 512
            or "\\" in value or "\x00" in value):
        raise ValueError("Files must be explicit relative paths using forward slashes.")
    p = PurePosixPath(value)
    if p.is_absolute() or any(part in ("", ".", "..") for part in value.split("/")):
        raise ValueError("Files must remain inside the routine scope; no absolute or parent paths.")
    return str(p)


def _inputs(required, expected_sha256=None, label="File check"):
    if not isinstance(required, list) or not 1 <= len(required) <= MAX_FILES:
        raise ValueError(f"Choose 1–{MAX_FILES} explicit files.")
    required = list(dict.fromkeys(_relative(x) for x in required))
    if not isinstance(expected_sha256 or {}, dict):
        raise ValueError("expected_sha256 must map relative paths to SHA-256 digests.")
    expected = {}
    for name, digest in (expected_sha256 or {}).items():
        name = _relative(name)
        if name not in required or not isinstance(digest, str) or not re.fullmatch(r"[0-9a-fA-F]{64}", digest):
            raise ValueError("Expected SHA-256 entries must name a selected file and contain 64 hex digits.")
        expected[name] = digest.lower()
    if not isinstance(label, str) or not 1 <= len(label) <= 200:
        raise ValueError("Use a report label of 1–200 characters.")
    return {"required": required, "expected_sha256": expected, "label": label}


def _scope(home, scope):
    p = Path(scope).expanduser()
    if not p.is_absolute():
        raise ValueError("Scope must be an explicit absolute directory path.")
    if p.is_symlink():
        raise ValueError("Scope cannot be a symlink; select its actual directory explicitly.")
    p = p.resolve(strict=True)
    if not p.is_dir():
        raise ValueError("Scope must be an existing directory.")
    private = Path(home).expanduser().resolve()
    if private == p or private.is_relative_to(p):
        raise ValueError("Usual home must be outside the routine's source directory.")
    s = p.stat()
    return {"path": str(p), "device": s.st_dev, "inode": s.st_ino,
            "access": "read-only; explicit files; no symlinks", "max_files": MAX_FILES,
            "max_file_bytes": MAX_FILE_BYTES}


def _load(home, routine_id):
    path = _path(home, routine_id)
    if path.is_symlink():
        raise ValueError("Routine files cannot be symlinks.")
    try:
        data = json.loads(path.read_text())
    except FileNotFoundError:
        raise ValueError(f"Unknown routine: {routine_id}") from None
    if (not isinstance(data, dict) or data.get("schema_version") != 1
            or data.get("id") != routine_id or data.get("method") != METHOD
            or data.get("version") != VERSION):
        raise ValueError("Unsupported routine format or method. Inspect the routine; no code was executed.")
    if data.get("steps") != METHOD_STEPS:
        raise ValueError("The built-in method cannot be edited. Edit inputs or notes; unsupported steps were not executed.")
    if not isinstance(data.get("scope"), dict) or not isinstance(data.get("inputs"), dict):
        raise ValueError("Routine scope and inputs must be objects.")
    _inputs(**data["inputs"])
    if not isinstance(data.get("enabled"), bool) or not isinstance(data.get("revision"), int):
        raise ValueError("Routine must have a boolean enabled state and an integer revision.")
    return data


def create(home, routine_id, scope, *, required=None, expected_sha256=None, title="Check selected files"):
    """Install one explicit built-in method without executing it or replacing edits."""
    routine_id = _id(routine_id)
    data = {"schema_version": 1, "id": routine_id, "item_id": "loops", "version": VERSION,
            "method": METHOD, "title": title, "revision": 1, "enabled": True,
            "scope": _scope(home, scope), "inputs": _inputs(required or ["README.md"], expected_sha256),
            "steps": METHOD_STEPS, "notes": "", "corrections": [], "created_at": _now(),
            "source": "https://github.com/pauljump/usual", "limits": LIMITS}
    path = _path(home, routine_id)
    if path.exists():
        current = _load(home, routine_id)
        compare = ("scope", "inputs", "title", "method", "version")
        if any(current.get(key) != data[key] for key in compare):
            raise ValueError("Routine already exists with different configuration. Inspect or edit it; nothing was overwritten.")
        return inspect_routine(home, routine_id)
    _write(path, data, exclusive=True)
    return inspect_routine(home, routine_id)


def inspect_routine(home, routine_id):
    data = _load(home, routine_id)
    fingerprint = _digest(data)
    result = {"routine": data, "path": str(_path(home, routine_id)), "installed": not data.get("removed", False),
              "enabled": data["enabled"], "fingerprint": fingerprint,
              "verification": {"status": "not-run", "kind": "deterministic-local-routine", "limits": LIMITS}}
    state_path = _root(home) / "state" / (routine_id + ".json")
    if state_path.exists() and not state_path.is_symlink():
        state = json.loads(state_path.read_text())
        if state.get("fingerprint") == fingerprint:
            result["verification"] = state["verification"]
            result["last_receipt"] = state["receipt"]
        else:
            result["verification"]["status"] = "changed-since-run"
    return result


def list_routines(home):
    return [inspect_routine(home, path.stem) for path in sorted(_root(home).glob("*.json"))]


def edit_routine(home, routine_id, *, required=None, expected_sha256=None, scope=None,
                 title=None, note=None, correction=None, enabled=None, removed=None):
    """An explicit revision retains the old document and all unrelated user metadata."""
    data = _load(home, routine_id)
    original = json.loads(json.dumps(data))
    if scope is not None:
        data["scope"] = _scope(home, scope)
    current = data["inputs"]
    if required is not None or expected_sha256 is not None:
        data["inputs"] = _inputs(required if required is not None else current["required"],
                                 expected_sha256 if expected_sha256 is not None else current["expected_sha256"],
                                 current["label"])
    if title is not None:
        if not isinstance(title, str) or not 1 <= len(title) <= 200:
            raise ValueError("Use a title of 1–200 characters.")
        data["title"] = title
    if note is not None:
        data["notes"] = str(note)[:4000]
    if correction is not None:
        if not correction.strip():
            raise ValueError("A correction must explain what changed.")
        data["corrections"].append({"at": _now(), "text": correction[:4000]})
    if enabled is not None:
        data["enabled"] = bool(enabled)
    if removed is not None:
        data["removed"] = bool(removed)
    if data == original:
        return inspect_routine(home, routine_id)
    archive = _private_dir(_root(home) / "revisions")
    _write(archive / (routine_id + "-" + uuid.uuid4().hex + ".json"), original, exclusive=True)
    data["revision"] += 1
    data["updated_at"] = _now()
    _write(_path(home, routine_id), data)
    return inspect_routine(home, routine_id)


def disable(home, routine_id):
    return edit_routine(home, routine_id, enabled=False)


disable_routine = disable


def remove(home, routine_id):
    # Preserve the document, revisions, and receipts so removal never discards edits.
    return edit_routine(home, routine_id, enabled=False, removed=True)


def _read_scoped(scope, relative):
    """Traverse through directory descriptors; no symlink can redirect a read."""
    nofollow = getattr(os, "O_NOFOLLOW", None)
    if nofollow is None or os.open not in os.supports_dir_fd:
        raise ValueError("This method requires POSIX directory-descriptor and O_NOFOLLOW support.")
    directory = os.open(scope["path"], os.O_RDONLY | os.O_DIRECTORY | nofollow)
    try:
        info = os.fstat(directory)
        if (info.st_dev, info.st_ino) != (scope["device"], scope["inode"]):
            raise ValueError("Scope directory was replaced. Inspect and explicitly edit the scope before running.")
        parts = PurePosixPath(relative).parts
        for part in parts[:-1]:
            next_dir = os.open(part, os.O_RDONLY | os.O_DIRECTORY | nofollow, dir_fd=directory)
            os.close(directory)
            directory = next_dir
        fd = os.open(parts[-1], os.O_RDONLY | nofollow | os.O_NONBLOCK, dir_fd=directory)
        try:
            before = os.fstat(fd)
            if not stat.S_ISREG(before.st_mode):
                raise ValueError("Selected input is not a regular file.")
            if before.st_size > MAX_FILE_BYTES:
                raise ValueError("File exceeds the 10 MiB per-file read limit.")
            chunks, remaining = [], MAX_FILE_BYTES + 1
            while remaining:
                chunk = os.read(fd, min(65536, remaining))
                if not chunk:
                    break
                chunks.append(chunk)
                remaining -= len(chunk)
            content = b"".join(chunks)
            after = os.fstat(fd)
        finally:
            os.close(fd)
        if len(content) > MAX_FILE_BYTES:
            raise ValueError("File exceeded the read limit while reading.")
        if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
            raise ValueError("File changed during the read; rerun against a stable file.")
        return content
    finally:
        os.close(directory)


def _receipt_html(receipt):
    esc = lambda x: html.escape(str(x))
    rows = "".join("<tr><td>" + esc(c["file"]) + "</td><td>" + esc(c["status"]) + "</td><td>"
                   + esc(c.get("detail", c.get("sha256", ""))) + "</td></tr>" for c in receipt["checks"])
    return ("<!doctype html><html lang='en'><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>"
            "<title>Usual · private Loop receipt</title><style>body{max-width:860px;margin:3rem auto;padding:0 1.2rem;background:#f8f4ec;"
            "color:#242820;font:17px/1.6 system-ui}table{border-collapse:collapse;width:100%}td,th{text-align:left;padding:.6rem;border-bottom:1px dotted #999;"
            "overflow-wrap:anywhere}pre{white-space:pre-wrap;overflow-wrap:anywhere}a{color:#376442}</style><body><p>PRIVATE LOCAL RECEIPT · LOOPS</p><h1>"
            + esc(receipt["inputs"]["label"]) + "</h1><p>" + esc(receipt["verification"]["status"]) + " · " + esc(receipt["created_at"])
            + "</p><table><thead><tr><th>File</th><th>Result</th><th>Observed evidence</th></tr></thead><tbody>" + rows
            + "</tbody></table><p>Checks only the named files. This is not application or release verification.</p><details><summary>Inspect complete receipt</summary><pre>"
            + esc(json.dumps(receipt, indent=2, ensure_ascii=False)) + "</pre></details><p>Contains local paths; keep private. Share a sanitized My Usual recipe instead.</p>"
            "<a href='https://github.com/pauljump/usual'>Usual source</a></body></html>")


def _check_json(content):
    text = content.decode("utf-8")
    depth, quoted, escaped = 0, False, False
    for char in text:
        if quoted:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                quoted = False
        elif char == '"':
            quoted = True
        elif char in "[{":
            depth += 1
            if depth > 128:
                raise ValueError("JSON nesting exceeds the supported 128 levels.")
        elif char in "]}":
            depth -= 1
    def reject_constant(_):
        raise ValueError("Non-finite numbers are not valid JSON.")
    json.loads(text, parse_constant=reject_constant)


def invoke(home, routine_id, *, inputs=None, preview=False):
    data = _load(home, routine_id)
    if not data["enabled"] or data.get("removed"):
        raise ValueError("Routine is disabled or removed. Explicitly enable it before invoking.")
    current_scope = _scope(home, data["scope"]["path"])
    if any(current_scope[k] != data["scope"].get(k) for k in ("path", "device", "inode")):
        raise ValueError("Scope directory was replaced. Inspect and explicitly edit its scope before invoking.")
    given = dict(data["inputs"])
    if inputs:
        if set(inputs) - {"required", "expected_sha256", "label"}:
            raise ValueError("Variable inputs are required files, expected_sha256, and label only.")
        given.update(inputs)
    given = _inputs(**given)
    if preview:
        return {"item_id": "loops", "action": "preview", "routine_id": routine_id,
                "scope": data["scope"], "inputs": given, "steps": METHOD_STEPS,
                "executes": False, "network": False, "writes": "Only a later run writes a receipt under Usual home.",
                "verification": {"status": "not-run", "limits": LIMITS}}
    checks = []
    for relative in given["required"]:
        check = {"file": relative, "status": "passed"}
        try:
            content = _read_scoped(data["scope"], relative)
            check.update(bytes=len(content), sha256=hashlib.sha256(content).hexdigest())
            if not content:
                raise ValueError("File is empty.")
            if relative.lower().endswith(".json"):
                _check_json(content)
                check["json_valid"] = True
            if relative in given["expected_sha256"]:
                matches = check["sha256"] == given["expected_sha256"][relative]
                check["expected_sha256_matches"] = matches
                if not matches:
                    raise ValueError("SHA-256 does not match the supplied expected digest.")
        except (OSError, ValueError, UnicodeError, RecursionError) as exc:
            check["status"] = "failed"
            # The error is private, but do not quote source file contents from parser errors.
            check["detail"] = "Invalid or excessively nested JSON, or invalid UTF-8 content." if isinstance(exc, (json.JSONDecodeError, UnicodeError, RecursionError)) else str(exc)
        checks.append(check)
    passed = all(c["status"] == "passed" for c in checks)
    verification = {"status": "passed" if passed else "failed", "kind": "deterministic-local-routine",
                    "method": METHOD, "checked_inputs": given, "limits": LIMITS}
    receipt = {"schema_version": 1, "id": uuid.uuid4().hex, "item_id": "loops", "action": "run",
               "routine_id": routine_id, "routine_revision": data["revision"], "fingerprint": _digest(data),
               "created_at": _now(), "scope": data["scope"], "inputs": given,
               "checks": checks, "verification": verification, "network": False,
               "source_modified": False, "source": "https://github.com/pauljump/usual"}
    receipts = _private_dir(_root(home) / "receipts")
    json_path = receipts / (receipt["id"] + ".json")
    html_path = receipts / (receipt["id"] + ".html")
    receipt["artifacts"] = {"json": str(json_path), "html": str(html_path)}
    _write(json_path, receipt, exclusive=True)
    fd = os.open(html_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as stream:
        stream.write(_receipt_html(receipt))
    state = _private_dir(_root(home) / "state")
    _write(state / (routine_id + ".json"), {"fingerprint": receipt["fingerprint"], "verification": verification,
                                          "receipt": str(json_path)})
    return receipt


def _expect(values):
    result = {}
    for value in values or []:
        if "=" not in value:
            raise ValueError("Use --expect relative/file=64-character-sha256.")
        name, digest = value.rsplit("=", 1)
        if name in result and result[name] != digest:
            raise ValueError("Conflicting expected digests for one file.")
        result[name] = digest
    return result


def main(argv=None, home=None):
    parser = argparse.ArgumentParser(prog="usual loops", description="Create and invoke scoped, inspectable local routines.")
    commands = parser.add_subparsers(dest="action", required=True)
    commands.add_parser("list")
    for action in ("create", "inspect", "edit", "run", "again", "preview", "disable", "enable", "remove"):
        p = commands.add_parser(action)
        p.add_argument("id")
        if action in ("create", "edit"):
            p.add_argument("--scope", required=action == "create")
            p.add_argument("--title")
        if action in ("create", "edit", "run", "again", "preview"):
            p.add_argument("--file", "--require", action="append", dest="files", help="Explicit relative file; repeat for more files")
            p.add_argument("--expect", action="append", help="relative/file=sha256")
        if action in ("run", "again", "preview"):
            p.add_argument("--label")
        if action == "edit":
            p.add_argument("--note")
            p.add_argument("--correction")
            p.add_argument("--clear-expect", action="store_true")
    args = parser.parse_args(argv)
    home = Path(home) if home is not None else Path.home() / ".usual"
    try:
        if args.action == "list":
            result = list_routines(home)
        elif args.action == "create":
            result = create(home, args.id, args.scope, required=args.files, expected_sha256=_expect(args.expect),
                            title=args.title or "Check selected files")
        elif args.action == "inspect":
            result = inspect_routine(home, args.id)
        elif args.action == "edit":
            result = edit_routine(home, args.id, required=args.files, scope=args.scope, title=args.title,
                                  expected_sha256={} if args.clear_expect else (_expect(args.expect) if args.expect else None),
                                  note=args.note, correction=args.correction)
        elif args.action in ("run", "again", "preview"):
            inputs = {}
            if args.files is not None:
                inputs["required"] = args.files
            if args.expect is not None:
                inputs["expected_sha256"] = _expect(args.expect)
            if args.label is not None:
                inputs["label"] = args.label
            result = invoke(home, args.id, inputs=inputs, preview=args.action == "preview")
        elif args.action == "disable":
            result = disable(home, args.id)
        elif args.action == "enable":
            result = edit_routine(home, args.id, enabled=True, removed=False)
        else:
            result = remove(home, args.id)
        print(json.dumps(result, indent=2, ensure_ascii=False))
        return 1 if isinstance(result, dict) and result.get("verification", {}).get("status") == "failed" else 0
    except (OSError, ValueError, TypeError, KeyError) as exc:
        print(json.dumps({"error": str(exc), "item_id": "loops"}), file=sys.stderr)
        return 2
