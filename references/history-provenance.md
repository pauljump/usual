# Recall and Vibecheck provenance

Recall's local core is a Usual-owned adaptation of Transcript Mine, copyright
2026 Paul Jump, MIT. The selected snapshot is pinned by SHA256 in
[history-source-hashes.json](history-source-hashes.json). Its complete license is
retained at `src/usual/recall_core/LICENSE` and must accompany distributions.

The source project was inspected under its project contract. `models.py` and
`database.py` retain the original record/schema and FTS5 foundations. The local
Claude/Codex normalization in `adapters.py` and complete-line ingestion in
`indexer.py` are adapted from that same source snapshot. The original adapter and
index test suite passed without source edits. The original dependency-free
zipapp builder informed distribution; Usual's existing release builder remains
the chosen implementation.

This is one implementation inside the Usual runtime, with no installed
Transcript Mine dependency. Upstream remains independently owned; it was not
moved or retired. There is no runtime upstream download or automatic update.
Future updates should compare the pinned source hashes and port relevant fixes
with the adapter, citation, scope, rewrite, and fork tests. Do not replace the
adaptation wholesale: source selection and normalization differ deliberately.

Adaptations in this release:

- Native Claude and Codex JSONL only, with explicit source paths; no default
  discovery of account history, exported social data, watcher, daemon, API sync,
  or provider calls. Limits: 1000 selected JSONL files per pass, 256 MiB per
  source, 4 MiB per line, 5000 analyzed turns, 120 packet turns.
- Existing Usual human-text filtering and deterministic secret redaction are
  shared with Choices. Human/assistant roles and adjacent context remain
  distinct. Metadata and sidechain records are excluded.
- Current search uses per-source immutable revisions and source occurrences;
  same-size rewrites do not leave old evidence posing as current file contents.
  Saved reports retain the earlier quoted snapshot and exact byte hash.
- Native message IDs deduplicate copied fork history. Without IDs, matching
  provider/role/timestamp/content does so conservatively. Missing timestamp and
  ID retain session identity; such data cannot reliably establish cross-fork
  independence. Complete trailing newlines are required during indexing.
- Every citation includes the original path, line, byte interval, raw-line
  SHA256, source revision, timestamp, role, and session. A duplicate's citation
  is chosen within the user's selected source scope.
- Derived databases and reports are refused inside Git repositories or the
  selected source directory. Source files are opened read-only. No source is
  overwritten, normalized in place, or uploaded.

Vibecheck's product approach adapts the inspected Vibes field-guide contract:
inspect local context, choose one useful mission, perform scoped work, return
proof. The original `public/profile.py`, field guides, and site were reviewed.
No scoring, archetype, grade, percentile, board, sharing endpoint, or network
code was copied. The new evidence-first report is Usual-owned code under the
repository MIT license. Earlier Vibecheck guides remain source references, not
claims that Usual ships every guide as a maintained tool.

Current deterministic findings describe near-duplicate human requests, capped
at three. They do not establish engineering quality or endorsed preferences.
An explicit current-agent handoff may supply richer interpretation; import
validates source membership, substantive human support across sessions, schema,
and safe item references, not the truth of an interpretation. Reports with
conflicts identify the matching source exceptions. Qualitative uncertainty is
mandatory, and the user can correct or dismiss a finding without erasing its
original evidence. Historical permission never becomes current authority.

Verification: synthetic native-record tests and the original Transcript Mine
adapter/index suite. No real account was configured and no live provider or
client behavior was validated. Cursor databases, other client exports, and
semantic discovery beyond an explicit host-agent handoff remain unsupported.
