"""Explicit-source adaptation of Transcript Mine's complete-line SQLite indexer.

Local Codex and Claude JSONL only. No discovery defaults, watcher, API, or sync.
Changed files get a new immutable revision; current search excludes old revisions.
"""
from __future__ import annotations

import hashlib
from pathlib import Path

from .adapters import parse_line
from .database import ensure_source, insert_turn, reset_source_revision, source_state, update_source, upsert_session
from .models import IndexReport, SourceSpec

MAX_SOURCE_BYTES = 256 * 1024 * 1024
MAX_LINE_BYTES = 4 * 1024 * 1024
MAX_FILES = 1000


def provider_for(path: Path) -> str | None:
    with path.open('rb') as handle:
        for _ in range(40):
            raw = handle.readline(MAX_LINE_BYTES + 1)
            if not raw:
                break
            if len(raw) > MAX_LINE_BYTES:
                raise ValueError('JSONL line exceeds the 4 MiB limit')
            import json
            try:
                obj = json.loads(raw)
            except (ValueError, UnicodeDecodeError):
                continue
            if not isinstance(obj, dict):
                continue
            if obj.get('type') in ('session_meta', 'response_item', 'event_msg'):
                return 'codex'
            if obj.get('type') in ('user', 'assistant') and isinstance(obj.get('message'), dict):
                return 'claude'
    return None


def discover_sources(paths, provider='auto') -> tuple[list[SourceSpec], list[dict]]:
    if not paths:
        raise ValueError('Choose at least one explicit --source file or directory')
    found = {}
    excluded = []
    for value in paths:
        root = Path(value).expanduser()
        if root.is_symlink():
            raise ValueError('Choose the original source, not a symlink')
        root = root.resolve()
        if not root.exists():
            raise ValueError(f'Source does not exist: {root}')
        files = [root] if root.is_file() else sorted(root.rglob('*.jsonl'))
        if len(files) + len(found) > MAX_FILES:
            raise ValueError('Choose a smaller scope: at most 1000 JSONL files per pass')
        for path in files:
            if path.is_symlink() or (root.is_dir() and not path.resolve().is_relative_to(root)):
                excluded.append({'path': str(path), 'reason': 'symlink outside selected scope'})
                continue
            if 'subagents' in path.parts or path.name.startswith('agent-'):
                excluded.append({'path': str(path), 'reason': 'subagent history'})
                continue
            if path.suffix != '.jsonl':
                excluded.append({'path': str(path), 'reason': 'only native Codex/Claude JSONL supported'})
                continue
            if path.stat().st_size > MAX_SOURCE_BYTES:
                raise ValueError('Choose a smaller source: per-file limit is 256 MiB')
            name = provider if provider != 'auto' else provider_for(path)
            if name not in ('codex', 'claude'):
                excluded.append({'path': str(path), 'reason': 'unsupported or empty history format'})
                continue
            found[str(path)] = SourceSpec(name, str(path))
    return sorted(found.values(), key=lambda x: x.path), excluded


def index_sources(conn, sources, *, host='local') -> IndexReport:
    report = IndexReport(discovered_files=len(sources))
    for spec in sources:
        report.add(index_file(conn, spec, host=host))
    return report


def index_file(conn, spec, *, host) -> IndexReport:
    path = Path(spec.path)
    stat = path.stat()
    report = IndexReport(source_bytes=stat.st_size)
    digest = hashlib.sha256()
    with path.open('rb') as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b''):
            digest.update(chunk)
    checksum = digest.hexdigest()
    key = 'source_sha256:' + host + ':' + spec.path
    prior = conn.execute('SELECT value FROM metadata WHERE key=?', (key,)).fetchone()
    state = ensure_source(conn, host=host, provider=spec.provider, path=spec.path,
                          device=stat.st_dev, inode=stat.st_ino)
    if prior and prior['value'] == checksum:
        report.unchanged_files = 1
        report.indexed_bytes = state['byte_offset']
        return report
    if prior:
        reset_source_revision(conn, state['id'], stat.st_dev, stat.st_ino)
        state = source_state(conn, host, spec.provider, spec.path)
    report.scanned_files = 1
    offset = line_number = malformed = 0
    session = None
    with path.open('rb') as handle:
        while True:
            start = handle.tell()
            raw = handle.readline(MAX_LINE_BYTES + 1)
            if not raw:
                break
            if len(raw) > MAX_LINE_BYTES:
                raise ValueError('JSONL line exceeds the 4 MiB limit')
            if not raw.endswith(b'\n'):
                break
            offset = handle.tell()
            line_number += 1
            report.complete_lines += 1
            try:
                parsed = parse_line(spec.provider, raw, spec.path)
            except (UnicodeDecodeError, ValueError, TypeError):
                malformed += 1
                continue
            if parsed.session:
                session = parsed.session
                upsert_session(conn, host, state['id'], session)
            if parsed.turn:
                turn = parsed.turn
                if session and spec.provider == 'codex':
                    turn.session_native_id = session.native_id
                    turn.cwd = session.cwd
                turn.metadata['raw_sha256'] = hashlib.sha256(raw).hexdigest()
                inserted = insert_turn(conn, host=host, source_id=state['id'], source_path=spec.path,
                    source_revision=state['revision'], source_line=line_number, byte_start=start,
                    byte_end=offset, turn=turn)
                if inserted:
                    report.inserted_turns += 1
                else:
                    report.duplicate_turns += 1
    report.malformed_lines = malformed
    report.indexed_bytes = offset
    update_source(conn, state['id'], size=stat.st_size, mtime_ns=stat.st_mtime_ns,
                  byte_offset=offset, line_number=line_number, malformed_delta=malformed)
    conn.execute('INSERT OR REPLACE INTO metadata(key,value) VALUES (?,?)', (key, checksum))
    conn.commit()
    return report
