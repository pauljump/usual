# Usual Learn: project record

Status as of 2026-09-30: **built and verified locally; seven real assessment items await
Paul.** Command reference: [references/learn.md](../../references/learn.md). Code:
`src/usual/learn.py` (store, review, playbooks, retrieval, metrics), `learn_extract.py`
(deterministic candidates), `learn_server.py` (assessment UI), `learn_cli.py` (commands).
Tests: `tests/test_learn.py` (synthetic only).

## What it is for

Agents should check whether a problem was already solved before solving it again. Learn
captures how Paul decides and which procedures worked, keeps the context, exceptions and
evidence, and lets only Paul turn an inference into a standing procedure that Codex and
Claude Code both retrieve.

## Decisions

- **One private canonical store** at `~/.usual/learning/learning.sqlite3`, next to Recall's
  index. Nothing personal is committed; the home must be outside any Git repository.
- **Reuse over new machinery.** Ingestion is Recall's incremental indexer; repeated-request
  grouping is Vibecheck's; decision episodes come from Choices; the review contract
  (no self-endorsement, `--confirm-user-review`, loopback capability server) is Choices'.
- **Groundwork's assessment UI pattern** was located in
  `dev-sentiment-takehome/dashboard/verify.js` and `swipe.js` and adapted: cited passages
  highlighted inside the surrounding source text, the model's reading plus "why", human
  verdicts with revision checks, append-only history and undo, exact-quote validation on import.
- **The current session model interprets**; Usual runs no model. Interpretations arrive
  through a bounded handoff and are rejected unless every quote is an exact substring of a
  supplied source.
- **Four layers stay separate:** source says, agent infers, Paul confirms, execution verifies.
- **Promotion gates:** a playbook draft needs user-confirmed, corrected or narrowed learnings;
  only approved versions are returned as procedures; drafts can be used only as `--trial`.
- **Shared entrypoints:** the Usual skill is installed identically for Codex
  (`~/.agents/skills/usual`) and Claude Code (`~/.claude/skills/usual`), both using the same
  store. One line in `control-plane/AGENT-CORE.md`, which both clients' global instructions
  resolve to, tells agents to run `playbook find` before re-investigating a familiar problem.
- **Off the public menu.** Adding Learn to tryusual.com is a separate product decision.

## Findings from the real run (2026-09-29)

- Ingested 1,645 files (1,197 transcripts, 448 notes and playbooks, 5.3 GB) in about 35 s;
  re-runs skip unchanged files. 21 Codex files failed on Recall's 4 MiB line limit
  (embedded images); oversized lines are now counted and skipped.
- **3,548 of 14,031 "user" turns were Codex's automatic approval-review prompts**, not Paul.
  Recall's human filter now drops them and other Codex wrappers; this also corrects Recall
  and Vibecheck results. After re-indexing: 1,091 sessions, 9,742 human turns.
- Extraction produced 41 candidates. Interpretation (this Claude session) produced
  **7 assessment items**, skipped 4 with reasons and merged 1 duplicate:
  diverging playbook copies (`_factory/brain/playbooks` vs `kit/playbooks`, while
  AGENT-CORE links the kit copy), orphaned process holding a PM2 port, 502 means the origin
  is not answering, verify live content after deploy, TestFlight account-wide expiry,
  "no dashes, no colons" in writing done in Paul's voice, and not processing data in place on
  the external drive.

## Vertical slice verification

The canonical store holds only what is real: 7 pending items, no reviewed learnings, no
playbooks. Paul's verdicts were not simulated there. The downstream chain was exercised by
`~/.usual/learning/work/run_slice.py` on a **temporary copy** of the real store with a
**scripted reviewer** (removed after the run):

| Step | Result |
| --- | --- |
| Assessment through the UI API | orphan-port learning confirmed (channel `ui`) |
| Draft from the Claude skill entrypoint | v1 draft |
| Codex `find` before approval | 0 playbooks, 1 draft listed as unreviewed |
| Playbook review through the UI API | v1 approved |
| Codex and Claude `find` | both return `orphan-port` v1 |
| `verify --declared` against live `usual-web` | Usual-run: 1 listener on :8230, `/health` 200 |
| Deliberately wrong port and a deviation | failed check recorded; `improve` proposes 1 signal |

## Measurements

Measured on real history: the orphan-port problem appeared in 14 sessions across 5
projects; the median historical investigation ran 4 turns and 10.6 minutes from first
mention to an assistant-reported resolution. Review burden: 7 items asked from 41
candidates (0.17 items per candidate). Held-out replay: 2 of 2 historical human turns
mentioning the triggers retrieved the playbook. That sample is too small to rate retrieval.

Estimated, not measured: turns avoided = uses × median historical turns (8 for the two
slice uses). Answer time per item is measured by the UI once Paul uses it; the slice's 21 s
was scripted.

## Limits and next steps

- Paul has not assessed anything yet: run `usual learn review-ui` (about 7 short items).
  The orphan-port playbook body is drafted at `~/.usual/learning/work/orphan-port-body.json`
  and becomes a real draft only after he confirms that learning.
- Codex use was verified through its installed entrypoint, not a live Codex session; running
  one uses Paul's Codex quota and needs his go-ahead.
- Extraction is lexical. Resolution detection is loose, and decision clustering over Choices
  episodes is weak. Interpretation quality depends on the agent and is checked only for
  provenance.
- Usual never runs playbook scripts; checks are read-only `http`, `port` and `file` probes.
