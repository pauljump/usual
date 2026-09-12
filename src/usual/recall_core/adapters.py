from __future__ import annotations

import json
import re
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable

from .models import ParsedRecord, SessionMetadata, Turn


def _text_blocks(content: Any, allowed: Iterable[str] = ("text",)) -> list[str]:
    if isinstance(content, str):
        return [content]
    if not isinstance(content, list):
        return []
    accepted = set(allowed)
    texts: list[str] = []
    for block in content:
        if isinstance(block, str):
            texts.append(block)
        elif isinstance(block, dict) and block.get("type") in accepted:
            value = block.get("text")
            if isinstance(value, str):
                texts.append(value)
    return texts


def _clean_text(parts: Iterable[str]) -> str:
    return "\n\n".join(part.strip() for part in parts if part and part.strip()).strip()


def _session_from_path(path: str) -> str:
    name = Path(path).stem
    if name.startswith("rollout-"):
        possible = name.rsplit("-", 5)
        if len(possible) == 6:
            return "-".join(possible[-5:])
    return name


def parse_claude(obj: dict[str, Any], path: str) -> ParsedRecord:
    record_type = obj.get("type")
    session_id = str(obj.get("sessionId") or _session_from_path(path))
    timestamp = obj.get("timestamp")
    cwd = obj.get("cwd")

    if record_type == "queue-operation" and obj.get("operation") == "enqueue":
        text = obj.get("content")
        if isinstance(text, str) and text.strip():
            return ParsedRecord(turn=Turn(
                provider="claude",
                session_native_id=session_id,
                native_id=obj.get("uuid"),
                role="user",
                text=text.strip(),
                timestamp=timestamp,
                cwd=cwd,
                kind="queued-message",
            ))
        return ParsedRecord()

    if record_type not in ("user", "assistant"):
        if cwd or timestamp:
            return ParsedRecord(session=SessionMetadata(
                provider="claude", native_id=session_id, cwd=cwd, timestamp=timestamp
            ))
        return ParsedRecord()

    message = obj.get("message")
    if not isinstance(message, dict):
        return ParsedRecord()
    role = message.get("role") or record_type
    if role not in ("user", "assistant"):
        return ParsedRecord()
    text = _clean_text(_text_blocks(message.get("content"), ("text",)))
    if not text:
        return ParsedRecord()
    return ParsedRecord(turn=Turn(
        provider="claude",
        session_native_id=session_id,
        native_id=obj.get("uuid"),
        role=role,
        text=text,
        timestamp=timestamp,
        cwd=cwd,
        metadata={"model": message.get("model"), "branch": obj.get("gitBranch")},
    ))


def parse_codex(obj: dict[str, Any], path: str) -> ParsedRecord:
    outer_type = obj.get("type")
    payload = obj.get("payload")
    if not isinstance(payload, dict):
        payload = {}
    timestamp = obj.get("timestamp")
    fallback_id = _session_from_path(path)

    if outer_type == "session_meta":
        session_id = str(payload.get("id") or fallback_id)
        return ParsedRecord(session=SessionMetadata(
            provider="codex",
            native_id=session_id,
            cwd=payload.get("cwd"),
            timestamp=timestamp or payload.get("timestamp"),
        ))

    # event_msg duplicates canonical response_item messages in current Codex rollouts.
    if outer_type != "response_item" or payload.get("type") != "message":
        return ParsedRecord()
    role = payload.get("role")
    if role not in ("user", "assistant"):
        return ParsedRecord()
    text = _clean_text(_text_blocks(
        payload.get("content"), ("input_text", "output_text", "text")
    ))
    if not text:
        return ParsedRecord()
    return ParsedRecord(turn=Turn(
        provider="codex",
        session_native_id=fallback_id,
        native_id=payload.get("id"),
        role=role,
        text=text,
        timestamp=timestamp,
        metadata={"phase": payload.get("phase")},
    ))



def parse_line(provider: str, raw: bytes, path: str) -> ParsedRecord:
    obj = json.loads(raw)
    if not isinstance(obj, dict):
        raise ValueError("JSONL record must be an object")
    if any(obj.get(flag) for flag in ("isMeta", "isSidechain", "isCompactSummary", "isSynthetic")):
        return ParsedRecord()
    if provider == "codex":
        parsed = parse_codex(obj, path)
    elif provider == "claude":
        parsed = parse_claude(obj, path)
    else:
        raise ValueError("Supported providers are codex and claude")
    from ..transcripts import human_text, scrub
    if parsed.session:
        if not isinstance(parsed.session.cwd, (str, type(None))):
            raise ValueError("Session scope must be text")
        if parsed.session.cwd:
            parsed.session.cwd = scrub(parsed.session.cwd)
        parsed.session.timestamp = valid_timestamp(parsed.session.timestamp)
    if parsed.turn:
        turn = parsed.turn
        if turn.role == "user":
            turn.text = filter_human(turn.text)
        turn.text = scrub(turn.text)
        if not turn.text:
            parsed.turn = None
        else:
            turn.timestamp = valid_timestamp(turn.timestamp)
            if not isinstance(turn.native_id, (str, type(None))):
                raise ValueError("Native ID must be text")
            if not isinstance(turn.cwd, (str, type(None))):
                raise ValueError("Turn scope must be text")
            if turn.cwd:
                turn.cwd = scrub(turn.cwd)
            turn.metadata = {key: scrub(value) if isinstance(value, str) else None
                             for key, value in turn.metadata.items()}
    return parsed


def valid_timestamp(value):
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError("Timestamp must be a string")
    try:
        datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError:
        return None
    return value


def filter_human(text):
    from ..transcripts import human_text
    # Additional provider-owned wrappers, including incomplete metadata tails.
    for tag in ("environment_context", "system-reminder", "instructions", "INSTRUCTIONS",
                "recommended_plugins", "skills_instructions", "user_instructions", "collaboration_mode"):
        text = re.sub(rf"<{re.escape(tag)}\b[^>]*>[\s\S]*?(?:</{re.escape(tag)}>|$)", "", text)
    if text.lstrip().startswith(("This session is being continued from a previous conversation",
                                "<task-notification", "<subagent", "<turn_aborted")):
        return ""
    return human_text(text)
