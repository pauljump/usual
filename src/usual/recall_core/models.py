from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(slots=True)
class Turn:
    provider: str
    session_native_id: str
    role: str
    text: str
    timestamp: str | None = None
    native_id: str | None = None
    cwd: str | None = None
    kind: str = "message"
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class SessionMetadata:
    provider: str
    native_id: str
    cwd: str | None = None
    timestamp: str | None = None
    title: str | None = None


@dataclass(slots=True)
class ParsedRecord:
    turn: Turn | None = None
    session: SessionMetadata | None = None


@dataclass(slots=True)
class SourceSpec:
    provider: str
    path: str


@dataclass(slots=True)
class IndexReport:
    discovered_files: int = 0
    scanned_files: int = 0
    unchanged_files: int = 0
    complete_lines: int = 0
    malformed_lines: int = 0
    inserted_turns: int = 0
    duplicate_turns: int = 0
    source_bytes: int = 0
    indexed_bytes: int = 0

    def add(self, other: "IndexReport") -> None:
        for name in self.__dataclass_fields__:
            setattr(self, name, getattr(self, name) + getattr(other, name))

