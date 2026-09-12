# Recall and Vibecheck

Usual: <https://github.com/pauljump/usual>. Your AI, how you like it.

Recall finds previous text with citations. Choices uses evidence about a
historical choice to reason about a current decision. Recall works without
Choices, an account, or importing your entire history.

Run the portable `scripts/usual.py` with Python 3.11+. Put the same explicit
`--home` before each command. Choose a private location outside repositories and
outside the history source directory. The examples below use a placeholder
`/private/usual` that you should replace with your chosen location.

```sh
python3 scripts/usual.py --home /private/usual recall index --source /chosen/history
python3 scripts/usual.py --home /private/usual recall search 'release manifest' --role user
python3 scripts/usual.py --home /private/usual recall show turn_CITATION_ID
python3 scripts/usual.py --home /private/usual recall stats
```

Only native Claude Code and Codex JSONL are supported. A source may be one file
or a directory; repeat `--source` for multiple selections. Source symlinks,
subagent files, injected metadata, and malformed records are excluded or
reported. Nothing searches account-global transcript directories by default.
Source file paths and original bytes stay unchanged. The derived SQLite index
lives under the chosen home's `recall/` directory. Re-index to incorporate
changes; no watcher or external synchronization runs.

Search accepts `--since YYYY-MM-DD`, `--until YYYY-MM-DD`, `--role`, `--limit`,
and optional `--source` to search only already-indexed records from that scope.
Dates are inclusive; undated records are excluded from a date-limited search.
Search is lexical, with all query terms required. No results means no lexical
match in the selected index, not proof the event never happened. `show` checks
the cited byte hash against the current file and labels missing/changed sources.

Vibecheck runs the same local index and makes up to three candidate observations:

```sh
python3 scripts/usual.py --home /private/usual vibecheck scan --source /chosen/history --since 2026-09-01
python3 scripts/usual.py --home /private/usual vibecheck inspect vibe_REPORT_ID
python3 scripts/usual.py --home /private/usual vibecheck handoff vibe_REPORT_ID
```

The output identifies selected sources, dates, evidence quotes and adjacent
context, possible exceptions, coverage limits, uncertainty, and an existing
item to inspect. It reports repeated human requests, not a grade or an
endorsed general preference. Similar requests in at least two independent
sessions can support a candidate. Short approvals, assistant suggestions,
passing tests, silence, and duplicated forks cannot. A small or conflicting
scope may have no useful finding; that is an honest result.

The scan saves private JSON and a private Markdown handoff under
`vibecheck/reports/`. Open the handoff with your current coding agent to interpret
the bounded packet. This is a manual bridge: the public website cannot inspect
local files or connect to your agent. The CLI starts no second model or hidden
inference service. Save the current agent's JSON response locally and import it:

```sh
python3 scripts/usual.py --home /private/usual vibecheck import vibe_REPORT_ID --file /private/agent-report.json
python3 scripts/usual.py --home /private/usual vibecheck correct vibe_REPORT_ID finding_ID --text 'Only use this for release reviews.'
python3 scripts/usual.py --home /private/usual vibecheck dismiss vibe_REPORT_ID finding_ID --reason 'These examples are obsolete.'
```

Import checks the report schema and citations, rebuilding scope/date details
from the scan. It does not prove an interpretation is true. Corrections and
dismissals are append-only in the private report. Selecting a suggested tool or
building a Loops routine is a separate action. Historical approvals do not
authorize execution, spending, publication, or permission changes.

A reproducible public synthetic example lives in
`demo/fixtures/sample-flagship-{a,b,exception}.jsonl`. Its release-check request
supports checking `README.md` and `manifest.json` for nonempty content, valid
JSON, and SHA256 hashes. Its browser-link request supports inspecting Pop. Each
has an explicit context-specific exception to discuss before making a routine
or preference. These examples are fabricated fixtures, not anyone's history.

Local parsing/storage does not mean an active hosted agent sees nothing:
evidence you provide to your coding agent follows that provider's normal
processing and usage rules. Deterministic redaction cannot detect every private
detail. These reports contain local paths and quotes; use My Usual's sanitized
setup export for sharing. The CLI has no telemetry. Website analytics, if any,
are a separate public-site behavior.

See [source and adaptation details](history-provenance.md).
