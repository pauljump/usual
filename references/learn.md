# Learn and playbooks

Learn turns selected local work into reviewed, reusable procedures shared by Codex and
Claude Code:

**local evidence → extracted candidates → agent interpretation → your assessment →
reviewed learning → drafted playbook → separate playbook review → retrieval and use →
recorded verification → proposed revision.**

Everything lives in one private store, `<home>/learning/learning.sqlite3` (default home
`~/.usual`), next to Recall's index at `<home>/recall/index.sqlite3`. The home must be
outside Git repositories. The CLI makes no model or network calls, except an `http` check
you explicitly run. Evidence you hand to your coding agent is processed under that
provider's normal handling and usage.

## Four layers, kept apart

| Layer | Where | Meaning |
| --- | --- | --- |
| What the source says | `sources`: exact passages with path, line, byte range, SHA-256, date, author (`human`, `assistant`, `assistant_note`, `document`) | Observed text. An assistant turn is a suggestion or a reported outcome. |
| What the agent infers | `learnings`: statement, scope, exceptions, rationale, confidence, which agent | A hypothesis. Never used as a procedure. |
| What you confirm | `reviews`: append-only, revisioned, undoable | Intent and applicability. Not proof a procedure works. |
| What execution verifies | `verifications`: `usual_executed` checks Usual ran, or `agent_reported` claims | Evidence about a specific use of a specific version. |

Repetition is never proof, silence and passing tests are never approval, and historical
approval never grants permission to spend, publish, delete, share or change credentials.

## 1. Ingest (incremental, resumable)

```sh
usual learn ingest --provider both \
  --docs 'memory=~/.claude/projects/*/memory/*.md' --docs handoff=~/.walkie/handoffs \
  --docs playbook=/path/to/playbooks --docs 'contract=/path/to/projects/*/AGENTS.md'
usual learn ingest                       # later: reuses the saved selection
usual learn ingest --max-files 50        # bounded pass; the next run resumes
usual learn ingest --force               # re-parse after a parser change
```

Choose the history explicitly the first time; the selection is saved in
`learning/sources.json`. Each file is a checkpoint. Unchanged size and mtime are skipped
without reading. Transcripts go through Recall's indexer (new file revisions supersede old
ones; lines over 4 MiB, such as embedded images, are counted and skipped). Provider-injected
"user" text such as Codex's automatic approval-review prompts is not treated as human.

## 2. Extract candidates (deterministic)

```sh
usual learn extract            # reads ~/.usual/judgment.sqlite3 episodes when present
usual learn candidates
```

Kinds: `recurring_problem` (an error signature across sessions and projects, with
assistant-reported resolutions and related notes), `failed_then_worked` (a human reports
the problem still failing, then working), `correction` (human corrections sharing a term
that is rare in ordinary requests), `decision` (Choices question/answer episodes),
`procedure` (Vibecheck's repeated-request grouping) and `conflict` (diverging copies of
the same procedure document). Candidates are observations with stable IDs; re-running is
idempotent. Stats record sessions, projects, dates and the turns each historical
investigation took.

## 3. Interpret with the current agent

```sh
usual learn handoff --limit 8 --out ~/.usual/learning/work/handoff.json
# optionally --candidate cand_ID (repeatable) to choose which to interpret
usual learn interpret --file ~/.usual/learning/work/interpretation.json --agent claude|codex
```

The handoff is a bounded packet (at most 25 candidates, 8 sources each). The agent writes
one learning per candidate or skips it with `{"candidate": ID, "skip": "reason"}`; new
evidence reopens a skipped candidate. `"also": [ID]` merges candidates that are one
mechanism. Import is atomic and enforces: citations come from the supplied sources, every
quote is an exact substring of its source, at least one citation supports the reading,
and decisions and corrections cite a human-authored passage. Each learning becomes one
assessment item whose priority weighs projects, sessions, recency, contrary evidence and
the agent's uncertainty.

## 4. Assess

```sh
usual learn review-ui          # loopback link with an in-memory capability
usual learn queue
```

The Assess view follows Groundwork's Verify pattern: each cited passage is highlighted in
its surrounding source text (yellow supports, salmon contradicts, blue is context), the
agent's reading and "why" sit beside it, and you pick an option, correct it, limit its
scope, mark it outdated, say there is not enough evidence, decline it, or skip. Answers
save immediately with a revision check, so onboarding can stop and resume at any time.
Undo appends a reversal. When you answer in conversation instead, an agent may record it
with `usual learn answer ITEM --verdict ... --confirm-user-review`; agents must never
answer for you.

## 5. Playbooks

```sh
usual playbook template --learning LEARN_ID            # skeleton from reviewed learnings
usual playbook draft SLUG --file body.json --learning LEARN_ID
usual learn review-ui                                  # Playbooks tab: approve, narrow, edit, reject
usual playbook review VERSION --verdict approve|reject|narrow|edit|edit-and-approve --confirm-user-review
usual playbook show SLUG ; usual playbook diff VERSION ; usual playbook list
```

A draft is accepted only from learnings you confirmed, corrected or narrowed, and cites
only their sources. The body specifies problem, when to use and not use, inputs,
prerequisites, scope, steps, optional scripts (marked read-only or state-changing), expected
outputs, verification criteria with optional declared checks (`http`, `port`, `file`),
exceptions, failure handling, when fresh judgment is needed, actions needing current
permission, and triggers. A draft is never returned as a standing procedure. Approval makes
it a default within its scope; current instructions and exceptions still win.

Edits and narrowing create a new version with a diff. Revisions (`playbook revise`) are
drafts until reviewed; approving one supersedes the previous version. `playbook retire`
and `playbook rollback --to N` need `--confirm-user-review` and keep every earlier version.

## 6. Retrieve and use (both agents)

```sh
usual playbook find "service crash-loops with EADDRINUSE" --project "$PWD" --agent codex|claude [--history]
usual playbook use SLUG --agent codex|claude --task "..." --project "$PWD"   # --trial for a draft
usual playbook verify USE_ID --declared --input port=5001   # or --check http:URL=200 | port:N | file:PATH
usual playbook verify USE_ID --reported "pytest: 12 passed" --passed
usual playbook finish USE_ID --outcome followed|deviated|failed|abandoned --deviation "..."
usual playbook improve SLUG
```

`find` is bounded (up to 3 approved playbooks, 5 reviewed learnings, 3 unreviewed document
snippets) and reports applicability (`global`, `in_scope`, `out_of_scope`,
`unknown_project`), exceptions, actions needing permission now, recent failures and
deviations, and supporting learnings you later marked outdated. Usual never runs a
playbook's scripts; checks are read-only probes.

## 7. Measure

```sh
usual learn metrics
```

`measured` reports extraction and review volume, seconds per answer (from the UI), retrievals
and uses per agent, check results, historical recurrence of each approved playbook's
problem, and a held-out replay: historical human turns that mention a playbook's triggers,
excluding cited sources, and whether `find` returns it. `estimated` reports turns avoided
(uses × median historical investigation turns) and says so.
