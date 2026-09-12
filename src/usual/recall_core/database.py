from __future__ import annotations

import hashlib
import json
import re
import sqlite3
from pathlib import Path
from typing import Any

from .models import SessionMetadata, Turn


SCHEMA_VERSION = 2


def connect(path: str) -> sqlite3.Connection:
    db_path = Path(path).expanduser()
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA busy_timeout=5000")
    initialize(conn)
    return conn


def initialize(conn: sqlite3.Connection) -> None:
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS metadata (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS sources (
            id INTEGER PRIMARY KEY,
            host TEXT NOT NULL,
            provider TEXT NOT NULL,
            path TEXT NOT NULL,
            device INTEGER,
            inode INTEGER,
            revision INTEGER NOT NULL DEFAULT 1,
            size INTEGER NOT NULL DEFAULT 0,
            mtime_ns INTEGER NOT NULL DEFAULT 0,
            byte_offset INTEGER NOT NULL DEFAULT 0,
            line_number INTEGER NOT NULL DEFAULT 0,
            malformed_lines INTEGER NOT NULL DEFAULT 0,
            last_error TEXT,
            indexed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(host, provider, path)
        );

        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            host TEXT NOT NULL,
            provider TEXT NOT NULL,
            native_id TEXT NOT NULL,
            cwd TEXT,
            title TEXT,
            started_at TEXT,
            ended_at TEXT,
            first_source_id INTEGER REFERENCES sources(id),
            UNIQUE(host, provider, native_id)
        );

        CREATE TABLE IF NOT EXISTS turns (
            rowid INTEGER PRIMARY KEY,
            id TEXT NOT NULL UNIQUE,
            session_id TEXT NOT NULL REFERENCES sessions(id),
            host TEXT NOT NULL,
            provider TEXT NOT NULL,
            native_id TEXT,
            role TEXT NOT NULL,
            kind TEXT NOT NULL,
            text TEXT NOT NULL,
            timestamp TEXT,
            cwd TEXT,
            source_id INTEGER NOT NULL REFERENCES sources(id),
            source_path TEXT NOT NULL,
            source_revision INTEGER NOT NULL,
            source_line INTEGER NOT NULL,
            byte_start INTEGER NOT NULL,
            byte_end INTEGER NOT NULL,
            content_sha256 TEXT NOT NULL,
            metadata_json TEXT NOT NULL DEFAULT '{}',
            indexed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS turn_sources (
            turn_id TEXT NOT NULL REFERENCES turns(id),
            source_id INTEGER NOT NULL REFERENCES sources(id),
            source_revision INTEGER NOT NULL,
            source_line INTEGER NOT NULL,
            byte_start INTEGER NOT NULL,
            byte_end INTEGER NOT NULL,
            raw_sha256 TEXT NOT NULL,
            session_id TEXT NOT NULL,
            cwd TEXT,
            PRIMARY KEY(source_id, source_revision, source_line)
        );

        CREATE INDEX IF NOT EXISTS turns_session_idx ON turns(session_id);
        CREATE INDEX IF NOT EXISTS turns_time_idx ON turns(timestamp);
        CREATE INDEX IF NOT EXISTS turns_source_idx ON turns(source_id, source_line);
        CREATE INDEX IF NOT EXISTS turns_filter_idx ON turns(host, provider, role);

        CREATE VIRTUAL TABLE IF NOT EXISTS turns_fts USING fts5(
            text,
            content='turns',
            content_rowid='rowid',
            tokenize='porter unicode61 remove_diacritics 2'
        );

        CREATE TRIGGER IF NOT EXISTS turns_ai AFTER INSERT ON turns BEGIN
            INSERT INTO turns_fts(rowid, text) VALUES (new.rowid, new.text);
        END;
        CREATE TRIGGER IF NOT EXISTS turns_ad AFTER DELETE ON turns BEGIN
            INSERT INTO turns_fts(turns_fts, rowid, text)
            VALUES ('delete', old.rowid, old.text);
        END;
        CREATE TRIGGER IF NOT EXISTS turns_au AFTER UPDATE ON turns BEGIN
            INSERT INTO turns_fts(turns_fts, rowid, text)
            VALUES ('delete', old.rowid, old.text);
            INSERT INTO turns_fts(rowid, text) VALUES (new.rowid, new.text);
        END;
    """)
    conn.execute(
        "INSERT OR REPLACE INTO metadata(key, value) VALUES ('schema_version', ?)",
        (str(SCHEMA_VERSION),),
    )
    conn.commit()


def source_state(conn: sqlite3.Connection, host: str, provider: str, path: str) -> sqlite3.Row | None:
    return conn.execute(
        "SELECT * FROM sources WHERE host=? AND provider=? AND path=?",
        (host, provider, path),
    ).fetchone()


def ensure_source(
    conn: sqlite3.Connection,
    *,
    host: str,
    provider: str,
    path: str,
    device: int,
    inode: int,
) -> sqlite3.Row:
    conn.execute(
        """INSERT OR IGNORE INTO sources(host, provider, path, device, inode)
           VALUES (?, ?, ?, ?, ?)""",
        (host, provider, path, device, inode),
    )
    return source_state(conn, host, provider, path)  # type: ignore[return-value]


def reset_source_revision(conn: sqlite3.Connection, source_id: int, device: int, inode: int) -> None:
    conn.execute(
        """UPDATE sources SET revision=revision+1, device=?, inode=?, size=0,
           mtime_ns=0, byte_offset=0, line_number=0, malformed_lines=0, last_error=NULL WHERE id=?""",
        (device, inode, source_id),
    )


def update_source(
    conn: sqlite3.Connection,
    source_id: int,
    *,
    size: int,
    mtime_ns: int,
    byte_offset: int,
    line_number: int,
    malformed_delta: int,
    error: str | None = None,
) -> None:
    conn.execute(
        """UPDATE sources SET size=?, mtime_ns=?, byte_offset=?, line_number=?,
           malformed_lines=malformed_lines+?, last_error=?, indexed_at=CURRENT_TIMESTAMP
           WHERE id=?""",
        (size, mtime_ns, byte_offset, line_number, malformed_delta, error, source_id),
    )


def session_key(host: str, provider: str, native_id: str) -> str:
    return hashlib.sha256(f"{host}\0{provider}\0{native_id}".encode()).hexdigest()


def upsert_session(
    conn: sqlite3.Connection,
    host: str,
    source_id: int,
    meta: SessionMetadata,
) -> str:
    key = session_key(host, meta.provider, meta.native_id)
    conn.execute(
        """INSERT INTO sessions(
               id, host, provider, native_id, cwd, title, started_at, ended_at, first_source_id
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
               cwd=COALESCE(excluded.cwd, sessions.cwd),
               title=COALESCE(excluded.title, sessions.title),
               started_at=CASE
                   WHEN sessions.started_at IS NULL THEN excluded.started_at
                   WHEN excluded.started_at IS NULL THEN sessions.started_at
                   ELSE MIN(sessions.started_at, excluded.started_at)
               END,
               ended_at=CASE
                   WHEN sessions.ended_at IS NULL THEN excluded.ended_at
                   WHEN excluded.ended_at IS NULL THEN sessions.ended_at
                   ELSE MAX(sessions.ended_at, excluded.ended_at)
               END""",
        (
            key, host, meta.provider, meta.native_id, meta.cwd, meta.title,
            meta.timestamp, meta.timestamp, source_id,
        ),
    )
    return key


def insert_turn(
    conn: sqlite3.Connection,
    *,
    host: str,
    source_id: int,
    source_path: str,
    source_revision: int,
    source_line: int,
    byte_start: int,
    byte_end: int,
    turn: Turn,
) -> bool:
    session_id = upsert_session(
        conn,
        host,
        source_id,
        SessionMetadata(
            provider=turn.provider,
            native_id=turn.session_native_id,
            cwd=turn.cwd,
            timestamp=turn.timestamp,
        ),
    )
    content_hash = hashlib.sha256(turn.text.encode("utf-8")).hexdigest()
    # Native message IDs or identical timestamp/content identify copied fork history.
    # Without either, keep source/session identity: repetition alone is not duplication.
    identity = "\0".join((host, turn.provider, turn.role, content_hash,
        str(turn.native_id) if turn.native_id else (turn.timestamp or turn.session_native_id)))
    turn_id = hashlib.sha256(identity.encode()).hexdigest()
    cursor = conn.execute(
        """INSERT OR IGNORE INTO turns(
               id, session_id, host, provider, native_id, role, kind, text,
               timestamp, cwd, source_id, source_path, source_revision,
               source_line, byte_start, byte_end, content_sha256, metadata_json
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            turn_id, session_id, host, turn.provider, turn.native_id, turn.role,
            turn.kind, turn.text, turn.timestamp, turn.cwd, source_id, source_path,
            source_revision, source_line, byte_start, byte_end, content_hash,
            json.dumps(turn.metadata, separators=(",", ":"), sort_keys=True),
        ),
    )
    conn.execute(
        """INSERT OR IGNORE INTO turn_sources(
            turn_id, source_id, source_revision, source_line, byte_start, byte_end,
            raw_sha256, session_id, cwd) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (turn_id, source_id, source_revision, source_line, byte_start, byte_end,
         turn.metadata.get("raw_sha256", ""), session_id, turn.cwd),
    )
    return cursor.rowcount == 1


def build_fts_query(query: str, match: str = "all") -> str:
    tokens = re.findall(r"[\w@./:+-]+", query, flags=re.UNICODE)
    cleaned = [token.replace('"', '""') for token in tokens if len(token) > 1]
    if not cleaned:
        raise ValueError("Search query contains no searchable terms")
    if match == "phrase":
        return '"' + " ".join(cleaned) + '"'
    operator = " OR " if match == "any" else " AND "
    return operator.join(f'"{token}"' for token in cleaned)


def search(
    conn: sqlite3.Connection,
    query: str,
    *,
    limit: int = 20,
    role: str | None = None,
    provider: str | None = None,
    host: str | None = None,
    since: str | None = None,
    match: str = "all",
) -> list[dict[str, Any]]:
    clauses = ["turns_fts MATCH ?"]
    params: list[Any] = [build_fts_query(query, match)]
    for column, value in (("t.role", role), ("t.provider", provider), ("t.host", host)):
        if value:
            clauses.append(f"{column} = ?")
            params.append(value)
    if since:
        clauses.append("t.timestamp >= ?")
        params.append(since)
    params.append(limit)
    rows = conn.execute(
        f"""SELECT t.*, s.native_id AS session_native_id,
                   snippet(turns_fts, 0, '[', ']', ' ... ', 28) AS snippet,
                   bm25(turns_fts) AS rank
            FROM turns_fts
            JOIN turns t ON t.rowid = turns_fts.rowid
            JOIN sessions s ON s.id = t.session_id
            WHERE {' AND '.join(clauses)}
            ORDER BY rank, COALESCE(t.timestamp, '') DESC
            LIMIT ?""",
        params,
    ).fetchall()
    return [dict(row) for row in rows]


def stats(conn: sqlite3.Connection) -> dict[str, Any]:
    totals = dict(conn.execute("""
        SELECT
          (SELECT COUNT(*) FROM sources) AS sources,
          (SELECT COUNT(*) FROM sessions) AS sessions,
          (SELECT COUNT(*) FROM turns) AS turns,
          (SELECT COUNT(*) FROM turns WHERE role='user') AS user_turns,
          (SELECT COUNT(*) FROM turns WHERE role='assistant') AS assistant_turns,
          (SELECT COUNT(*) FROM turns WHERE role='signal') AS signal_turns,
          (SELECT COALESCE(SUM(size), 0) FROM sources) AS source_bytes,
          (SELECT COALESCE(SUM(byte_offset), 0) FROM sources) AS indexed_bytes,
          (SELECT COALESCE(SUM(malformed_lines), 0) FROM sources) AS malformed_lines
    """).fetchone())
    totals["coverage_percent"] = round(
        100 * totals["indexed_bytes"] / totals["source_bytes"], 2
    ) if totals["source_bytes"] else 100.0
    totals["by_provider"] = {
        row["provider"]: row["count"]
        for row in conn.execute("SELECT provider, COUNT(*) count FROM turns GROUP BY provider")
    }
    totals["by_host"] = {
        row["host"]: row["count"]
        for row in conn.execute("SELECT host, COUNT(*) count FROM turns GROUP BY host")
    }
    return totals
